/**
 * Utility functions for use in the Cloudflare Worker environment
 */

/**
 * Check if the code is running in a Cloudflare Worker environment
 * @returns {boolean} True if running in a Cloudflare Worker
 */
export function isCloudflareWorker() {
  return typeof WebSocketPair !== 'undefined' && typeof navigator === 'undefined';
}

/**
 * Simple worker-only logging function
 * @param {...any} args - Arguments to pass to console.log
 */
export function workerLog(...args) {
  if (isCloudflareWorker()) {
    console.log(...args);
  }
}
