/**
 * Batch Processing Utility
 *
 * Provides a unified interface for processing large datasets that works transparently
 * in both CLI (sequential) and Worker (batched with durable objects) environments.
 */

import { isWorkerEnvironment } from './env.js';
import chalk from 'chalk';

/**
 * Serialize metadata to make it safe for durable object storage
 * Removes non-serializable objects like functions and complex objects
 */
function serializeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return metadata;
  }
  
  const serialized = {};
  
  for (const [key, value] of Object.entries(metadata)) {
    if (key === 'ctx') {
      // Extract only serializable parts of the context
      serialized[key] = {
        jobConfig: value.jobConfig,
        shopConfig: value.shopConfig,
        // Don't store shopify client or env - they're not serializable
      };
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      serialized[key] = value;
    } else if (Array.isArray(value)) {
      serialized[key] = value;
    } else if (typeof value === 'object' && value !== null) {
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
  env = null
}) {
  if (!items || !Array.isArray(items)) {
    throw new Error('Items must be an array');
  }

  if (typeof processor !== 'function') {
    throw new Error('Processor must be a function');
  }

  const totalItems = items.length;

  if (totalItems === 0) {
    console.log('No items to process');
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
      onBatchComplete
    });
  } else {
    console.log(`📋 Processing ${totalItems} items sequentially`);
    return await processSequentially({
      items,
      processor,
      metadata,
      onProgress,
      onBatchComplete
    });
  }
}

/**
 * Process items sequentially (CLI mode or small batches)
 */
async function processSequentially({
  items,
  processor,
  metadata,
  onProgress,
  onBatchComplete
}) {
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
        status: 'error',
        index: i,
        error: error.message
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
async function startBatchProcessing({
  items,
  processor,
  batchSize,
  metadata,
  durableObjectState,
  onProgress,
  onBatchComplete
}) {
  const totalItems = items.length;
  const totalBatches = Math.ceil(totalItems / batchSize);

  console.log(`📦 Starting batch processing: ${totalItems} items in batches of ${batchSize}`);

  // Store batch state in durable object (only serializable data)
  // Don't store items array - it will be retrieved from R2 when continuing
  const batchState = {
    metadata: serializeMetadata(metadata),
    cursor: 0,
    batchSize: batchSize,
    totalItems: totalItems,
    processedCount: 0,
    resultCounts: { success: 0, error: 0 },
    status: 'processing',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    // Store processor info for debugging (but not the actual function)
    processorName: processor.name || 'anonymous',
    hasOnProgress: onProgress !== null,
    hasOnBatchComplete: onBatchComplete !== null
  };

  await durableObjectState.storage.put('batch:processor:state', batchState);

  // Process first batch immediately
  return await processBatchChunk({
    batchState,
    items, // Pass items separately for first batch
    processor,
    durableObjectState,
    onProgress,
    onBatchComplete
  });
}

/**
 * Process a single batch chunk
 */
export async function processBatchChunk({
  batchState,
  items,
  processor,
  durableObjectState,
  onProgress,
  onBatchComplete
}) {
  const { cursor, batchSize, metadata } = batchState;
  const currentBatch = items.slice(cursor, cursor + batchSize);
  const batchNum = Math.floor(cursor / batchSize) + 1;
  const totalBatches = Math.ceil(batchState.totalItems / batchSize);

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
        status: 'error',
        index: globalIndex,
        error: error.message
      });
    }
  }

  // Update batch state
  const newCursor = cursor + currentBatch.length;
  const successCount = batchResults.filter(r => r && r.status !== 'error').length;
  const errorCount = batchResults.filter(r => r && r.status === 'error').length;
  
  const updatedBatchState = {
    ...batchState,
    cursor: newCursor,
    processedCount: batchState.processedCount + currentBatch.length,
    resultCounts: {
      success: batchState.resultCounts.success + successCount,
      error: batchState.resultCounts.error + errorCount
    },
    updatedAt: new Date().toISOString()
  };

  await durableObjectState.storage.put('batch:processor:state', updatedBatchState);

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

    // Mark as completed
    await durableObjectState.storage.put('batch:processor:state', {
      ...updatedBatchState,
      status: 'completed',
      completedAt: new Date().toISOString()
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
 * This function should be called by the job's continueBatch export
 */
export async function continueBatchProcessing({
  processor,
  durableObjectState,
  onProgress = null,
  onBatchComplete = null
}) {
  console.log('🔄 Continuing batch processing from alarm');

  const batchState = await durableObjectState.storage.get('batch:processor:state');
  if (!batchState) {
    throw new Error('No batch processor state found');
  }

  console.log(`📊 Resuming batch processing from cursor ${batchState.cursor}`);

  try {
    // Items are not stored in state - they need to be retrieved from the original job
    // For now, we'll throw an error indicating this needs to be handled by the job-specific continueBatch
    throw new Error('continueBatchProcessing requires job-specific implementation to retrieve items from R2');
  } catch (error) {
    console.error('❌ Batch processing error:', error);

    // Update batch state with error
    await durableObjectState.storage.put('batch:processor:state', {
      ...batchState,
      status: 'failed',
      error: error.message,
      updatedAt: new Date().toISOString()
    });

    throw error;
  }
}

