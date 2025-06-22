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
 * Process a collection of items with automatic batching in worker environments
 *
 * @param {Object} options - Processing options
 * @param {Array} options.items - Array of items to process
 * @param {Function} options.onBatchItem - Function to process each item: async (item, index, ctx) => result
 * @param {number} [options.batchSize=200] - Size of each batch in worker environment
 * @param {Object} options.ctx - Context object containing: { shopify, jobConfig, env, shopConfig }
 * @param {Object} [options.durableObjectState] - Durable object state for worker batching
 * @param {Function} [options.onProgress] - Progress callback: (completed, total, results) => void
 * @param {Function} [options.onBatchComplete] - Batch completion callback: (batchResults, batchNumber, totalBatches) => void
 * @returns {Promise<Array>} Array of processing results
 */
export async function iterateInBatches({
  items,
  onBatchItem,
  batchSize = 200,
  ctx,
  durableObjectState = null,
  onProgress = null,
  onBatchComplete = null,
}) {
  if (!items || !Array.isArray(items)) {
    throw new Error("Items must be an array");
  }

  if (typeof onBatchItem !== "function") {
    throw new Error("onBatchItem must be a function");
  }

  if (!ctx || typeof ctx !== "object") {
    throw new Error("Context (ctx) must be provided as an object");
  }

  const totalItems = items.length;

  if (totalItems === 0) {
    console.log("No items to process");
    return [];
  }

  // Determine processing strategy based on environment
  const isWorker = ctx.env ? isWorkerEnvironment(ctx.env) : false;

  if (isWorker) {
    if (!durableObjectState) {
      throw new Error("Durable object state is required for worker environment");
    }

    console.log(`🔄 Worker environment detected with ${totalItems} items. Starting batch processing with batch size ${batchSize}.`);
    return await startBatchProcessing({
      items,
      onBatchItem,
      batchSize,
      ctx,
      durableObjectState,
      onProgress,
      onBatchComplete,
    });
  }

  console.log(`📋 Processing ${totalItems} items sequentially`);
  return await processSequentially({
    items,
    onBatchItem,
    ctx,
    onProgress,
    onBatchComplete,
  });
}

/**
 * Process items sequentially (CLI mode or small batches)
 */
async function processSequentially({ items, onBatchItem, ctx, onProgress, onBatchComplete }) {
  const results = [];
  const totalItems = items.length;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemIndex = i + 1;

    console.log(chalk.cyan(`${itemIndex}/${totalItems} Processing item ${i}`));

    try {
      const result = await onBatchItem(item, i, ctx);
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
async function startBatchProcessing({ items, onBatchItem, batchSize, ctx, durableObjectState, onProgress, onBatchComplete }) {
  const totalItems = items.length;
  const totalBatches = Math.ceil(totalItems / batchSize);

  console.log(`📦 Starting batch processing: ${totalItems} items in batches of ${batchSize}`);

  // Store items array in R2 for retrieval during continuation
  const itemsKey = `batch-items-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const itemsData = JSON.stringify(items);

  if (ctx.env && ctx.env.R2_BUCKET) {
    console.log(`📦 Storing ${totalItems} items in R2 with key: ${itemsKey}`);
    await ctx.env.R2_BUCKET.put(itemsKey, itemsData, {
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

  // Store iteration state in durable object (tracks overall progress across all batches)
  const iterationState = {
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
    processorName: onBatchItem.name || "anonymous",
    hasOnProgress: onProgress !== null,
    hasOnBatchComplete: onBatchComplete !== null,
  };

  await durableObjectState.storage.put("batch:processor:state", iterationState);

  // Process first batch immediately
  return await processBatch({
    iterationState,
    items, // Pass items separately for first batch
    onBatchItem,
    ctx,
    durableObjectState,
    onProgress,
    onBatchComplete,
  });
}

/**
 * Handle empty batch completion - clean up and mark as done
 */
async function handleEmptyBatch(iterationState, ctx, durableObjectState, cursor) {
  console.log(`⚠️ Empty batch detected at cursor ${cursor}. Marking batch processing as complete.`);

  // Mark as completed
  await durableObjectState.storage.put("batch:processor:state", {
    ...iterationState,
    status: "completed",
    completedAt: new Date().toISOString(),
  });

  // Clean up R2 items
  if (iterationState.itemsKey && ctx.env && ctx.env.R2_BUCKET) {
    try {
      console.log(`🗑️ Cleaning up items from R2: ${iterationState.itemsKey}`);
      await ctx.env.R2_BUCKET.delete(iterationState.itemsKey);
    } catch (error) {
      console.error(`⚠️ Failed to clean up R2 items: ${error.message}`);
    }
  }

  // Clean up alarm
  await durableObjectState.deleteAlarm();

  return [];
}

/**
 * Process a single batch
 */
export async function processBatch({ iterationState, items, onBatchItem, ctx, durableObjectState, onProgress, onBatchComplete }) {
  const { cursor, batchSize } = iterationState;
  const currentBatch = items.slice(cursor, cursor + batchSize);
  const batchNum = Math.floor(cursor / batchSize) + 1;
  const totalBatches = Math.ceil(iterationState.totalItems / batchSize);

  // Check for empty batch to prevent infinite loops
  if (currentBatch.length === 0) {
    return await handleEmptyBatch(iterationState, ctx, durableObjectState, cursor);
  }

  console.log(`📋 Batch ${batchNum}/${totalBatches}: processing ${currentBatch.length} items`);

  const batchResults = [];
  let itemCounter = iterationState.processedCount;

  // Process each item in the current batch
  for (let i = 0; i < currentBatch.length; i++) {
    const item = currentBatch[i];
    const globalIndex = cursor + i;
    itemCounter++;

    console.log(chalk.cyan(`  ${itemCounter}/${iterationState.totalItems} Processing item ${globalIndex}`));

    try {
      const result = await onBatchItem(item, globalIndex, ctx);
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

  // Update iteration state
  const newCursor = cursor + currentBatch.length;
  const successCount = batchResults.filter((r) => r && r.status !== "error").length;
  const errorCount = batchResults.filter((r) => r && r.status === "error").length;

  const updatedIterationState = {
    ...iterationState,
    cursor: newCursor,
    processedCount: iterationState.processedCount + currentBatch.length,
    resultCounts: {
      success: iterationState.resultCounts.success + successCount,
      error: iterationState.resultCounts.error + errorCount,
    },
    updatedAt: new Date().toISOString(),
  };

  await durableObjectState.storage.put("batch:processor:state", updatedIterationState);

  // Call progress callback
  if (onProgress) {
    onProgress(updatedIterationState.processedCount, iterationState.totalItems, batchResults);
  }

  // Call batch complete callback
  if (onBatchComplete) {
    onBatchComplete(batchResults, batchNum, totalBatches);
  }

  // Check if we're done
  if (newCursor >= iterationState.totalItems) {
    console.log(`✅ Batch processing complete: ${updatedIterationState.processedCount}/${iterationState.totalItems} items processed`);

    // Clean up R2 items
    if (iterationState.itemsKey && ctx.env && ctx.env.R2_BUCKET) {
      try {
        console.log(`🗑️ Cleaning up items from R2: ${iterationState.itemsKey}`);
        await ctx.env.R2_BUCKET.delete(iterationState.itemsKey);
      } catch (error) {
        console.error(`⚠️ Failed to clean up R2 items: ${error.message}`);
      }
    }

    // Mark as completed
    await durableObjectState.storage.put("batch:processor:state", {
      ...updatedIterationState,
      status: "completed",
      completedAt: new Date().toISOString(),
    });

    // Clean up alarm
    await durableObjectState.deleteAlarm();

    return batchResults;
  } else {
    // Schedule next batch processing
    const nextAlarmTime = new Date(Date.now() + 1000);
    console.log(`⏰ Scheduling next batch. Remaining: ${iterationState.totalItems - newCursor} items`);
    await durableObjectState.setAlarm(nextAlarmTime);

    // Return current results (more will be processed via alarm)
    return batchResults;
  }
}

/**
 * Continue batch processing from stored state (called by alarm)
 * This function retrieves items from R2 and continues processing
 */
export async function continueBatchProcessing({ onBatchItem, ctx, durableObjectState, onProgress = null, onBatchComplete = null }) {
  console.log("🔄 Continuing batch processing from alarm");

  const iterationState = await durableObjectState.storage.get("batch:processor:state");
  if (!iterationState) {
    throw new Error("No batch processor state found");
  }

  console.log(`📊 Resuming batch processing from cursor ${iterationState.cursor}`);

  try {
    // Retrieve items from R2 using stored key
    if (!iterationState.itemsKey || !ctx.env || !ctx.env.R2_BUCKET) {
      throw new Error("Missing items key or R2 bucket for batch continuation");
    }

    console.log(`📦 Retrieving items from R2 with key: ${iterationState.itemsKey}`);
    const itemsObject = await ctx.env.R2_BUCKET.get(iterationState.itemsKey);

    if (!itemsObject) {
      throw new Error(`Items not found in R2 with key: ${iterationState.itemsKey}`);
    }

    const itemsData = await itemsObject.text();
    const items = JSON.parse(itemsData);

    console.log(`📦 Retrieved ${items.length} items from R2`);

    // Continue batch processing with retrieved items
    return await processBatch({
      iterationState,
      items,
      onBatchItem,
      ctx,
      durableObjectState,
      onProgress,
      onBatchComplete,
    });
  } catch (error) {
    console.error("❌ Batch processing error:", error);

    // Update iteration state with error
    await durableObjectState.storage.put("batch:processor:state", {
      ...iterationState,
      status: "failed",
      error: error.message,
      updatedAt: new Date().toISOString(),
    });

    throw error;
  }
}
