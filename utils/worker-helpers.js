/**
 * Utility functions for use in the Cloudflare Worker environment
 */

/**
 * Check if the code is running in a Cloudflare Worker environment
 * @param {Object} [env] - Environment variables, if available
 * @returns {boolean} True if running in a Cloudflare Worker, false if running in CLI
 */
export function isCloudflareWorker(env) {
  // If env is provided and has PATH (a typical Node.js/CLI environment variable), we're in CLI
  if (env && typeof env.PATH === 'string') {
    return false;
  }

  return true;
}

/**
 * Simple worker-only logging function
 * @param {...any} args - Arguments to pass to console.log
 * @param {Object} [env] - Environment variables, if available
 */
export function logToWorker(env, ...args) {
  if (isCloudflareWorker(env)) {
    console.log(...args);
  }
}

export function logToCli(env, ...args) {
  if (!isCloudflareWorker(env)) {
    console.log(...args);
  }
}
