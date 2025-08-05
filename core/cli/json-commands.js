import { getAvailableJobDirs, ensureAndResolveJobName, detectJobDirectory } from './job-management.js';
import { getAllJobDisplayInfo } from './webhook-cli.js';
import { getShopDomain } from '../shared/config-helpers.js';

/**
 * Main handler for json-status command
 * @param {string} projectRoot - The project root directory
 * @param {string} jobNameArg - Optional job name argument
 * @param {object} options - Command options
 */
export async function handleJsonStatusCommand(projectRoot, jobNameArg, options) {
  // Determine the actual working directory
  const actualWorkingDir = process.env.INIT_CWD || process.cwd();

  // If a specific job is specified, use that
  if (jobNameArg) {
    await handleSingleJobStatusJSON(projectRoot, jobNameArg);
    return;
  }

  // If directory option is specified, use that
  if (options.dir) {
    const resolved = await ensureAndResolveJobName(projectRoot, null, options.dir, false);
    if (resolved) {
      await handleSingleJobStatusJSON(projectRoot, resolved);
      return;
    }
  }

  // Otherwise, try to auto-detect current directory context
  const jobName = detectJobDirectory(projectRoot, null);
  if (jobName && !options.all) {
    // We detected a specific job directory
    await handleSingleJobStatusJSON(projectRoot, jobName);
  } else {
    // We're not in a specific job directory, show filtered or all jobs
    const filterByCurrentDir = !options.all;

    // When filtering by current dir, explicitly pass the actual working directory
    if (filterByCurrentDir) {
      await handleAllJobsStatusJSON(projectRoot, actualWorkingDir);
    } else {
      await handleAllJobsStatusJSON(projectRoot, false);
    }
  }
}

/**
 * Handle JSON status output for all jobs
 * @param {string} projectRoot - The project root directory
 * @param {string|boolean} filterByCurrentDir - Current directory to filter by, or false for all
 */
export async function handleAllJobsStatusJSON(projectRoot, filterByCurrentDir = false) {
  try {
    // Convert boolean to directory path if needed
    const currentDir = typeof filterByCurrentDir === 'string' ? filterByCurrentDir :
                        filterByCurrentDir === true ? process.cwd() : null;
    
    // Get all job directories
    const jobDirs = getAvailableJobDirs(projectRoot, currentDir);
    
    if (jobDirs.length === 0) {
      console.log(JSON.stringify({ 
        jobs: [], 
        shop: null,
        message: currentDir ? 'No jobs found in the current directory.' : 'No jobs found.'
      }, null, 2));
      return;
    }
    
    // Get shop domain
    let shopDomain;
    try {
      shopDomain = getShopDomain(projectRoot, null);
    } catch (error) {
      shopDomain = null;
    }
    
    // Get all job information
    const jobInfos = await getAllJobDisplayInfo(projectRoot, jobDirs);
    
    // Format the output as JSON
    const jsonOutput = {
      shop: shopDomain,
      totalJobs: jobInfos.length,
      jobs: jobInfos.map(job => ({
        path: job.jobPath,
        name: job.displayName,
        status: job.statusMsg,
        webhookTopic: job.displayTopic,
        webhookId: job.webhookIdSuffix,
        shop: job.shop,
        includeFields: job.includeFields || null
      }))
    };
    
    console.log(JSON.stringify(jsonOutput, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ 
      error: error.message,
      stack: process.env.DEBUG ? error.stack : undefined
    }, null, 2));
    process.exit(1);
  }
}

/**
 * Handle JSON status output for a single job
 * @param {string} projectRoot - The project root directory
 * @param {string} jobPath - The job path
 */
export async function handleSingleJobStatusJSON(projectRoot, jobPath) {
  try {
    const { getJobDisplayInfo } = await import('./webhook-cli.js');
    
    // Get shop domain
    let shopDomain;
    try {
      shopDomain = getShopDomain(projectRoot, jobPath);
    } catch (error) {
      shopDomain = null;
    }
    
    // Get job information
    const jobInfo = await getJobDisplayInfo(projectRoot, jobPath);
    
    // Format the output as JSON
    const jsonOutput = {
      shop: shopDomain,
      job: {
        path: jobInfo.jobPath,
        name: jobInfo.displayName,
        status: jobInfo.statusMsg,
        webhookTopic: jobInfo.displayTopic,
        webhookId: jobInfo.webhookIdSuffix,
        shop: jobInfo.shop,
        includeFields: jobInfo.includeFields || null
      }
    };
    
    console.log(JSON.stringify(jsonOutput, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ 
      error: error.message,
      stack: process.env.DEBUG ? error.stack : undefined
    }, null, 2));
    process.exit(1);
  }
}