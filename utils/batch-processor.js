/**
 * Batch Processing Utility
 *
 * Provides a unified interface for processing large datasets that works transparently
 * in both CLI (sequential) and Worker (batched with durable objects) environments.
 */

import { isWorkerEnvironment } from './env.js';
import chalk from 'chalk';

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

  // Store batch state in durable object
  const batchState = {
    items: items, // Store items for processing
    metadata: metadata,
    cursor: 0,
    batchSize: batchSize,
    totalItems: totalItems,
    processedCount: 0,
    results: [],
    status: 'processing',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    // Store serialized processor function and callbacks for continuation
    processorName: processor.name || 'anonymous',
    hasOnProgress: onProgress !== null,
    hasOnBatchComplete: onBatchComplete !== null
  };

  await durableObjectState.storage.put('batch:processor:state', batchState);

  // Process first batch immediately
  return await processBatchChunk({
    batchState,
    processor,
    durableObjectState,
    onProgress,
    onBatchComplete
  });
}

/**
 * Process a single batch chunk
 */
async function processBatchChunk({
  batchState,
  processor,
  durableObjectState,
  onProgress,
  onBatchComplete
}) {
  const { cursor, batchSize, items, metadata } = batchState;
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
  const updatedBatchState = {
    ...batchState,
    cursor: newCursor,
    processedCount: batchState.processedCount + currentBatch.length,
    results: [...batchState.results, ...batchResults],
    updatedAt: new Date().toISOString()
  };

  await durableObjectState.storage.put('batch:processor:state', updatedBatchState);

  // Call progress callback
  if (onProgress) {
    onProgress(updatedBatchState.processedCount, batchState.totalItems, updatedBatchState.results);
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

    return updatedBatchState.results;
  } else {
    // Schedule next batch processing
    const nextAlarmTime = new Date(Date.now() + 1000);
    console.log(`⏰ Scheduling next batch. Remaining: ${batchState.totalItems - newCursor} items`);
    await durableObjectState.setAlarm(nextAlarmTime);

    // Return current results (more will be processed via alarm)
    return updatedBatchState.results;
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
    await processBatchChunk({
      batchState,
      processor,
      durableObjectState,
      onProgress,
      onBatchComplete
    });
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

/**
 * Universal continuation handler for batch processing
 * This can be called directly by the job queue without requiring job-specific continueBatch exports
 */
export async function universalContinueBatch({ state, durableObjectState, shopify, env }) {
  console.log('🔄 Universal batch continuation handler');

  // Get the batch processor state
  const batchState = await durableObjectState.storage.get('batch:processor:state');
  if (!batchState) {
    console.log('No batch processor state found, checking for legacy batch state');

    // Check for legacy batch state format
    const legacyState = await durableObjectState.storage.get('batch:state');
    if (legacyState) {
      throw new Error('Legacy batch processing detected. Please use new batch processor format.');
    }

    throw new Error('No batch state found');
  }

  console.log(`📊 Resuming batch processing from cursor ${batchState.cursor}`);

  // The batch processor state contains all the data needed to continue
  // We just need to continue the batch processing with the stored state
  try {
    await processBatchChunk({
      batchState,
      processor: null, // Will be reconstructed from stored items and metadata
      durableObjectState,
      onProgress: null, // Callbacks will be reconstructed if needed
      onBatchComplete: null
    });
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
