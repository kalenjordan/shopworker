/**
 * Batch Processing Utility
 *
 * Provides a unified interface for processing large datasets that works transparently
 * in both CLI (sequential) and Worker (batched with durable objects) environments.
 *
 * In worker environments, the items array is stored in R2 for retrieval during
 * batch continuation, eliminating the need for job-specific continueBatch methods.
 */

import { isWorkerEnvironment } from "./env.js";
import chalk from "chalk";

/**
 * Serialize metadata to make it safe for durable object storage
 * Removes non-serializable objects like functions and complex objects
 */
function serializeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return metadata;
  }

  const serialized = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (key === "ctx") {
      // Extract only serializable parts of the context
      serialized[key] = {
        jobConfig: value.jobConfig,
        shopConfig: value.shopConfig,
        // Don't store shopify client or env - they're not serializable
      };
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      serialized[key] = value;
    } else if (Array.isArray(value)) {
      serialized[key] = value;
    } else if (typeof value === "object" && value !== null) {
      // Try to serialize object, but skip if it contains functions
      try {
        JSON.stringify(value);
        serialized[key] = value;
      } catch (error) {
        console.log(`Skipping non-serializable metadata key: ${key}`);
      }
    }
  }

  return serialized;
}

/**
 * Process a collection of items with automatic batching in worker environments
 *
 * @param {Object} options - Processing options
 * @param {Array} options.items - Array of items to process
 * @param {Function} options.processor - Function to process each item: async (item, index, metadata) => result
 * @param {number} [options.batchSize=200] - Size of each batch in worker environment
 * @param {Object} [options.metadata={}] - Additional data passed to processor function
 * @param {Object} [options.durableObjectState] - Durable object state for worker batching
 * @param {Function} [options.onProgress] - Progress callback: (completed, total, results) => void
 * @param {Function} [options.onBatchComplete] - Batch completion callback: (batchResults, batchNumber, totalBatches) => void
 * @param {Object} [options.env] - Environment object for worker detection
 * @returns {Promise<Array>} Array of processing results
 */
export async function processBatch({
  items,
  processor,
  batchSize,
  metadata = {},
  durableObjectState = null,
  onProgress = null,
  onBatchComplete = null,
  env = null,
}) {
  if (!items || !Array.isArray(items)) {
    throw new Error("Items must be an array");
  }

  if (typeof processor !== "function") {
    throw new Error("Processor must be a function");
  }

  const totalItems = items.length;

  if (totalItems === 0) {
    console.log("No items to process");
    return [];
  }

  // Determine processing strategy based on environment
  const isWorker = env ? isWorkerEnvironment(env) : false;
  const shouldBatch = isWorker && durableObjectState && totalItems > 10;

  if (shouldBatch) {
    console.log(`🔄 Worker environment detected with ${totalItems} items. Starting batch processing with batch size ${batchSize}.`);
    return await startBatchProcessing({
      items,
      processor,
      batchSize,
      metadata,
      durableObjectState,
      onProgress,
      onBatchComplete,
      env,
    });
  } else {
    console.log(`📋 Processing ${totalItems} items sequentially`);
    return await processSequentially({
      items,
      processor,
      metadata,
      onProgress,
      onBatchComplete,
    });
  }
}

/**
 * Process items sequentially (CLI mode or small batches)
 */
async function processSequentially({ items, processor, metadata, onProgress, onBatchComplete }) {
  const results = [];
  const totalItems = items.length;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemIndex = i + 1;

    console.log(chalk.cyan(`${itemIndex}/${totalItems} Processing item ${i}`));

    try {
      const result = await processor(item, i, metadata);
      results.push(result);
      console.log(chalk.green(`  ✓ Item ${itemIndex} completed`));
    } catch (error) {
      console.error(chalk.red(`  ✗ Item ${itemIndex} failed: ${error.message}`));
      results.push({
        status: "error",
        index: i,
        error: error.message,
      });
    }

    // Call progress callback
    if (onProgress) {
      onProgress(itemIndex, totalItems, results);
    }
  }

  // Call batch complete callback for the entire set
  if (onBatchComplete) {
    onBatchComplete(results, 1, 1);
  }

  console.log(`\nCompleted processing ${totalItems} items`);
  return results;
}

/**
 * Start batch processing in worker environment
 */
async function startBatchProcessing({ items, processor, batchSize, metadata, durableObjectState, onProgress, onBatchComplete, env }) {
  const totalItems = items.length;
  const totalBatches = Math.ceil(totalItems / batchSize);

  console.log(`📦 Starting batch processing: ${totalItems} items in batches of ${batchSize}`);

  // Store items array in R2 for retrieval during continuation
  const itemsKey = `batch-items-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const itemsData = JSON.stringify(items);

  if (env && env.R2_BUCKET) {
    console.log(`📦 Storing ${totalItems} items in R2 with key: ${itemsKey}`);
    await env.R2_BUCKET.put(itemsKey, itemsData, {
      httpMetadata: {
        contentType: "application/json",
      },
      customMetadata: {
        timestamp: new Date().toISOString(),
        totalItems: totalItems.toString(),
        batchSize: batchSize.toString(),
      },
    });
  }

  // Store batch state in durable object (only serializable data)
  const batchState = {
    metadata: serializeMetadata(metadata),
    cursor: 0,
    batchSize: batchSize,
    totalItems: totalItems,
    processedCount: 0,
    resultCounts: { success: 0, error: 0 },
    status: "processing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    itemsKey: itemsKey, // Store R2 key for items retrieval
    // Store processor info for debugging (but not the actual function)
    processorName: processor.name || "anonymous",
    hasOnProgress: onProgress !== null,
    hasOnBatchComplete: onBatchComplete !== null,
    // Store serializable processor configuration for reconstruction
    processorConfig: {
      // This can be used by jobs to store configuration needed to reconstruct processor
      // For now, just store basic info - jobs can extend this via metadata
      type: "generic",
    },
  };

  await durableObjectState.storage.put("batch:processor:state", batchState);

  // Process first batch immediately
  return await processBatchChunk({
    batchState,
    items, // Pass items separately for first batch
    processor,
    durableObjectState,
    onProgress,
    onBatchComplete,
    env,
  });
}

/**
 * Process a single batch chunk
 */
export async function processBatchChunk({ batchState, items, processor, durableObjectState, onProgress, onBatchComplete, env }) {
  const { cursor, batchSize, metadata } = batchState;
  const currentBatch = items.slice(cursor, cursor + batchSize);
  const batchNum = Math.floor(cursor / batchSize) + 1;
  const totalBatches = Math.ceil(batchState.totalItems / batchSize);

  // Check for empty batch to prevent infinite loops
  if (currentBatch.length === 0) {
    console.log(`⚠️ Empty batch detected at cursor ${cursor}. Marking batch processing as complete.`);

    // Mark as completed
    await durableObjectState.storage.put("batch:processor:state", {
      ...batchState,
      status: "completed",
      completedAt: new Date().toISOString(),
    });

    // Clean up R2 items
    if (batchState.itemsKey && env && env.R2_BUCKET) {
      try {
        console.log(`🗑️ Cleaning up items from R2: ${batchState.itemsKey}`);
        await env.R2_BUCKET.delete(batchState.itemsKey);
      } catch (error) {
        console.error(`⚠️ Failed to clean up R2 items: ${error.message}`);
      }
    }

    // Clean up alarm
    await durableObjectState.deleteAlarm();

    return [];
  }

  console.log(`📋 Batch ${batchNum}/${totalBatches}: processing ${currentBatch.length} items`);

  const batchResults = [];
  let itemCounter = batchState.processedCount;

  // Process each item in the current batch
  for (let i = 0; i < currentBatch.length; i++) {
    const item = currentBatch[i];
    const globalIndex = cursor + i;
    itemCounter++;

    console.log(chalk.cyan(`  ${itemCounter}/${batchState.totalItems} Processing item ${globalIndex}`));

    try {
      const result = await processor(item, globalIndex, metadata);
      batchResults.push(result);
      console.log(chalk.green(`  ✓ Item ${itemCounter} completed`));
    } catch (error) {
      console.error(chalk.red(`  ✗ Item ${itemCounter} failed: ${error.message}`));
      batchResults.push({
        status: "error",
        index: globalIndex,
        error: error.message,
      });
    }
  }

  // Update batch state
  const newCursor = cursor + currentBatch.length;
  const successCount = batchResults.filter((r) => r && r.status !== "error").length;
  const errorCount = batchResults.filter((r) => r && r.status === "error").length;

  const updatedBatchState = {
    ...batchState,
    cursor: newCursor,
    processedCount: batchState.processedCount + currentBatch.length,
    resultCounts: {
      success: batchState.resultCounts.success + successCount,
      error: batchState.resultCounts.error + errorCount,
    },
    updatedAt: new Date().toISOString(),
  };

  await durableObjectState.storage.put("batch:processor:state", updatedBatchState);

  // Call progress callback
  if (onProgress) {
    onProgress(updatedBatchState.processedCount, batchState.totalItems, batchResults);
  }

  // Call batch complete callback
  if (onBatchComplete) {
    onBatchComplete(batchResults, batchNum, totalBatches);
  }

  // Check if we're done
  if (newCursor >= batchState.totalItems) {
    console.log(`✅ Batch processing complete: ${updatedBatchState.processedCount}/${batchState.totalItems} items processed`);

    // Clean up R2 items
    if (batchState.itemsKey && env && env.R2_BUCKET) {
      try {
        console.log(`🗑️ Cleaning up items from R2: ${batchState.itemsKey}`);
        await env.R2_BUCKET.delete(batchState.itemsKey);
      } catch (error) {
        console.error(`⚠️ Failed to clean up R2 items: ${error.message}`);
      }
    }

    // Mark as completed
    await durableObjectState.storage.put("batch:processor:state", {
      ...updatedBatchState,
      status: "completed",
      completedAt: new Date().toISOString(),
    });

    // Clean up alarm
    await durableObjectState.deleteAlarm();

    return batchResults;
  } else {
    // Schedule next batch processing
    const nextAlarmTime = new Date(Date.now() + 1000);
    console.log(`⏰ Scheduling next batch. Remaining: ${batchState.totalItems - newCursor} items`);
    await durableObjectState.setAlarm(nextAlarmTime);

    // Return current results (more will be processed via alarm)
    return batchResults;
  }
}

/**
 * Continue batch processing from stored state (called by alarm)
 * This function retrieves items from R2 and continues processing
 */
export async function continueBatchProcessing({ processor, durableObjectState, onProgress = null, onBatchComplete = null, env }) {
  console.log("🔄 Continuing batch processing from alarm");

  const batchState = await durableObjectState.storage.get("batch:processor:state");
  if (!batchState) {
    throw new Error("No batch processor state found");
  }

  console.log(`📊 Resuming batch processing from cursor ${batchState.cursor}`);

  try {
    // Retrieve items from R2 using stored key
    if (!batchState.itemsKey || !env || !env.R2_BUCKET) {
      throw new Error("Missing items key or R2 bucket for batch continuation");
    }

    console.log(`📦 Retrieving items from R2 with key: ${batchState.itemsKey}`);
    const itemsObject = await env.R2_BUCKET.get(batchState.itemsKey);

    if (!itemsObject) {
      throw new Error(`Items not found in R2 with key: ${batchState.itemsKey}`);
    }

    const itemsData = await itemsObject.text();
    const items = JSON.parse(itemsData);

    console.log(`📦 Retrieved ${items.length} items from R2`);

    // Continue batch processing with retrieved items
    return await processBatchChunk({
      batchState,
      items,
      processor,
      durableObjectState,
      onProgress,
      onBatchComplete,
      env,
    });
  } catch (error) {
    console.error("❌ Batch processing error:", error);

    // Update batch state with error
    await durableObjectState.storage.put("batch:processor:state", {
      ...batchState,
      status: "failed",
      error: error.message,
      updatedAt: new Date().toISOString(),
    });

    throw error;
  }
}
