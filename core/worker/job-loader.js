/**
 * Worker-specific job loading utilities
 * These functions handle dynamic imports in the Cloudflare Worker environment
 */

/**
 * Load job configuration in the worker environment
 * @param {string} jobPath - The job path (e.g., 'hello-world', 'order/fetch')
 * @returns {Promise<Object>} The job configuration
 */
export async function loadJobConfig(jobPath) {
  // First try to load from local jobs directory
  try {
    const configModule = await import(`../../local/jobs/${jobPath}/config.json`);
    return configModule.default;
  } catch (localError) {
    // If not found in local, try core jobs directory
    try {
      const configModule = await import(`../jobs/${jobPath}/config.json`);
      return configModule.default;
    } catch (coreError) {
      console.error(`Failed to load job config for ${jobPath} from both local and core directories`);
      throw new Error(`Job config not found for: ${jobPath}`);
    }
  }
}

/**
 * Load job module in the worker environment
 * @param {string} jobPath - The job path (e.g., 'hello-world', 'order/fetch')
 * @returns {Promise<Object>} The job module
 */
export async function loadJobModule(jobPath) {
  let jobModule;
  
  // Try to load from local jobs directory first
  try {
    jobModule = await import(`../../local/jobs/${jobPath}/job.js`);
  } catch (localError) {
    // If not found in local, try core jobs directory
    try {
      jobModule = await import(`../jobs/${jobPath}/job.js`);
    } catch (coreError) {
      throw new Error(`Job module not found for ${jobPath} in either local or core directories`);
    }
  }
  
  if (!jobModule.process) {
    throw new Error(`Job ${jobPath} does not export a process function`);
  }
  
  return jobModule;
}