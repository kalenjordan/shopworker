/**
 * Worker-specific job loading utilities
 * These functions handle dynamic imports using the pre-generated job manifest
 */

import manifest from '../../job-manifest.json';

/**
 * Load job configuration in the worker environment
 * @param {string} jobPath - The job path (e.g., 'hello-world', 'order/fetch')
 * @returns {Promise<Object>} The job configuration
 */
export async function loadJobConfig(jobPath) {
  const jobInfo = manifest.jobs[jobPath];
  
  if (!jobInfo) {
    throw new Error(`Job not found in manifest: ${jobPath}`);
  }
  
  // Use the config from the manifest directly
  return jobInfo.config;
}

/**
 * Load job module in the worker environment
 * @param {string} jobPath - The job path (e.g., 'hello-world', 'order/fetch')
 * @returns {Promise<Object>} The job module
 */
export async function loadJobModule(jobPath) {
  const jobInfo = manifest.jobs[jobPath];
  
  if (!jobInfo) {
    throw new Error(`Job not found in manifest: ${jobPath}`);
  }
  
  // Use the exact import path from the manifest
  const jobModule = await import(jobInfo.jobPath);
  
  if (!jobModule.process) {
    throw new Error(`Job ${jobPath} does not export a process function`);
  }
  
  return jobModule;
}