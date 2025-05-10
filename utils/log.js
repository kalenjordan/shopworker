/**
 * Shared logging utilities for both CLI and Worker environments
 */

/**
 * Log to CLI environment (Node.js) only
 * Will only print if running in Node.js (detects process.env.PATH)
 * @param {Object} env - Environment variables
 * @param {...any} args - Arguments to pass to console.log
 */
export function logToCli(env, ...args) {
  // Check if we're running in Node environment (has PATH variable)
  if (env && typeof env.PATH === 'string') {
    console.log(...args);
  }
}

/**
 * Log to Worker environment only
 * Will only print if running in Cloudflare Worker (no process.env.PATH)
 * @param {Object} env - Environment variables
 * @param {...any} args - Arguments to pass to console.log
 */
export function logToWorker(env, ...args) {
  // If we don't see the PATH environment variable (a Node.js env var),
  // we're likely in a Worker environment
  if (!env || typeof env.PATH !== 'string') {
    console.log(...args);
  }
}
