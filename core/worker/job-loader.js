/**
 * Worker-specific job loading utilities
 * These functions use statically imported jobs for Cloudflare Workers compatibility
 */

import { getJobModule, getJobConfig } from './job-loader-generated.js';

/**
 * Load job configuration in the worker environment
 * @param {string} jobPath - The job path (e.g., 'hello-world', 'order/fetch')
 * @returns {Promise<Object>} The job configuration
 */
export async function loadJobConfig(jobPath) {
  try {
    return getJobConfig(jobPath);
  } catch (error) {
    throw new Error(`Job not found: ${jobPath}`);
  }
}

/**
 * Load job module in the worker environment
 * @param {string} jobPath - The job path (e.g., 'hello-world', 'order/fetch')
 * @returns {Promise<Object>} The job module
 */
export async function loadJobModule(jobPath) {
  try {
    const jobModule = getJobModule(jobPath);
    
    if (!jobModule.process) {
      throw new Error(`Job ${jobPath} does not export a process function`);
    }
    
    return jobModule;
  } catch (error) {
    throw new Error(`Job not found: ${jobPath}`);
  }
}