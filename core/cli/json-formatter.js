import { getAvailableJobDirs, ensureAndResolveJobName, detectJobDirectory } from './job-discovery.js';
import { getAllJobDisplayInfo } from './webhook-manager.js';
import { getShopDomain } from '../shared/config-helpers.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Extract description from config.json or JSDoc comment above the process function
 * @param {string} projectRoot - The project root directory 
 * @param {string} jobPath - The job path (e.g., "local/jobs/hello-world")
 * @returns {string|null} The description or null if not found
 */
export function extractJobDescription(projectRoot, jobPath) {
  try {
    // First try to get description from config.json
    const configPath = join(projectRoot, jobPath, 'config.json');
    if (existsSync(configPath)) {
      try {
        const configContent = readFileSync(configPath, 'utf-8');
        const config = JSON.parse(configContent);
        if (config.description) {
          return config.description;
        }
      } catch (e) {
        // If config.json exists but can't be parsed, continue to JSDoc
      }
    }
    
    // Fall back to JSDoc in job.js
    const jobFilePath = join(projectRoot, jobPath, 'job.js');
    const fileContent = readFileSync(jobFilePath, 'utf-8');
    
    // Look for JSDoc comment followed by export async function process
    const jsdocPattern = /\/\*\*[\s\S]*?\*\/[\s]*export\s+async\s+function\s+process/;
    const match = fileContent.match(jsdocPattern);
    
    if (!match) {
      return null;
    }
    
    // Extract just the JSDoc block
    const jsdocBlock = match[0].substring(0, match[0].indexOf('export'));
    
    // Parse the JSDoc content - look for the description (first non-empty line after /**)
    const lines = jsdocBlock.split('\n');
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      
      // Skip opening /**
      if (line === '/**' || line === '/*') {
        continue;
      }
      
      // Skip closing */ 
      if (line === '*/' || line === '*/') {
        break;
      }
      
      // Remove leading * and whitespace
      if (line.startsWith('*')) {
        line = line.substring(1).trim();
      }
      
      // Skip @param, @returns, etc.
      if (line.startsWith('@')) {
        break;
      }
      
      // If we have a non-empty line, this is our description
      if (line.length > 0) {
        return line;
      }
    }
    
    return null;
  } catch (error) {
    // If file doesn't exist or can't be read, return null
    return null;
  }
}

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
        id: job.jobId,
        path: job.fullPath,
        name: job.displayName,
        description: extractJobDescription(projectRoot, job.fullPath),
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
        id: jobInfo.jobId,
        path: jobInfo.fullPath,
        name: jobInfo.displayName,
        description: extractJobDescription(projectRoot, jobPath),
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