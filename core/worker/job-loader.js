/**
 * Worker-specific job loading utilities
 * These functions use statically imported jobs for Cloudflare Workers compatibility
 */

import { getJobModule, getJobConfig, getJobPathFromName } from '../../job-manifest.js';

/**
 * Load job configuration in the worker environment
 * @param {string} jobPath - The job path (e.g., 'hello-world', 'order/fetch', 'local/jobs/hello-world')
 * @returns {Promise<Object>} The job configuration
 */
export async function loadJobConfig(jobPath) {
  try {
    // Strip the "local/jobs/" or "core/jobs/" prefix if present
    // to match how jobs are registered in job-loader-generated.js
    const cleanPath = jobPath.replace(/^(local|core)\/jobs\//, '');
    console.log(`Loading job config for path: ${jobPath}, cleaned: ${cleanPath}`);
    return getJobConfig(cleanPath);
  } catch (error) {
    // If not found with clean path, try the original path as fallback
    try {
      return getJobConfig(jobPath);
    } catch {
      throw new Error(`Job not found: ${jobPath}`);
    }
  }
}

/**
 * Resolve job name to full job path
 * @param {string} jobName - The job name (e.g., 'quiz-get')
 * @returns {string} The full job path
 */
export function resolveJobPath(jobName) {
  return getJobPathFromName(jobName);
}

/**
 * Load job module in the worker environment
 * @param {string} jobPath - The job path (e.g., 'hello-world', 'order/fetch', 'local/jobs/hello-world')
 * @returns {Promise<Object>} The job module
 */
export async function loadJobModule(jobPath) {
  try {
    // Strip the "local/jobs/" or "core/jobs/" prefix if present
    // to match how jobs are registered in job-loader-generated.js
    const cleanPath = jobPath.replace(/^(local|core)\/jobs\//, '');
    console.log(`Loading job module for path: ${jobPath}, cleaned: ${cleanPath}`);
    const jobModule = getJobModule(cleanPath);
    
    if (!jobModule.process) {
      throw new Error(`Job ${jobPath} does not export a process function`);
    }
    
    return jobModule;
  } catch (error) {
    // If not found with clean path, try the original path as fallback
    try {
      const jobModule = getJobModule(jobPath);
      if (!jobModule.process) {
        throw new Error(`Job ${jobPath} does not export a process function`);
      }
      return jobModule;
    } catch {
      throw new Error(`Job not found: ${jobPath}`);
    }
  }
}