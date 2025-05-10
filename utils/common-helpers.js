import fs from 'fs';
import path from 'path';
import { loadJobConfig, loadTriggerConfig } from './job-loader.js';

/**
 * Get all job directories in the jobs folder
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @returns {Array<string>} List of job directory paths relative to jobs/
 */
export const getAvailableJobDirs = (cliDirname) => {
  const jobsDir = path.join(cliDirname, 'jobs');
  if (!fs.existsSync(jobsDir)) return [];

  const jobDirs = [];

  // Helper function to recursively find directories with config.json
  const findJobDirs = (dir, relativePath = '') => {
    const entries = fs.readdirSync(dir);

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const entryRelativePath = relativePath ? path.join(relativePath, entry) : entry;

      if (fs.statSync(fullPath).isDirectory()) {
        // Check if this directory contains a config.json file
        if (fs.existsSync(path.join(fullPath, 'config.json'))) {
          jobDirs.push(entryRelativePath);
        }

        // Recursively search subdirectories
        findJobDirs(fullPath, entryRelativePath);
      }
    }
  };

  findJobDirs(jobsDir);
  return jobDirs;
};

/**
 * Print a list of available jobs
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} messagePrefix - The message to display before the list
 */
export function listAvailableJobs(cliDirname, messagePrefix = 'Could not detect job directory.') {
  console.error(messagePrefix);
  const jobDirs = getAvailableJobDirs(cliDirname);
  if (jobDirs.length > 0) {
    console.error('Available jobs:');
    jobDirs.forEach(dir => console.error(`  ${dir}`));
  } else {
    console.error('No jobs found in the jobs/ directory.');
  }
}

/**
 * Detect the job directory from various possible locations
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} [specifiedDir] - An explicitly specified directory
 * @returns {string|null} The job name or path or null if not determined
 */
export function detectJobDirectory(cliDirname, specifiedDir) {
  if (specifiedDir) return specifiedDir;
  const initCwd = process.env.INIT_CWD || process.cwd();
  const currentDir = process.cwd();
  const dirsToCheck = [initCwd, currentDir];
  const jobsDir = path.join(cliDirname, 'jobs');
  if (!fs.existsSync(jobsDir)) return null;
  const validJobDirs = getAvailableJobDirs(cliDirname);

  for (const dir of dirsToCheck) {
    // Check if we're in a job directory
    const relPath = path.relative(jobsDir, dir);
    if (!relPath.startsWith('..') && relPath !== '') {
      // Find the closest parent directory that contains a config.json
      let currentRelPath = relPath;
      let pathParts = currentRelPath.split(path.sep);

      while (pathParts.length > 0) {
        const potentialJobPath = pathParts.join(path.sep);
        if (validJobDirs.includes(potentialJobPath)) {
          return potentialJobPath;
        }
        // Remove the last segment and try again
        pathParts.pop();
      }
    }
  }

  return null;
}

/**
 * Ensure that a job name can be resolved from the provided arguments or context
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} jobNameArg - The job name specified as an argument
 * @param {string} dirOption - The directory option specified
 * @param {boolean} autoSelectSingleIfOneJob - Whether to auto-select if only one job is available
 * @returns {Promise<string|null>} The resolved job name or null if not resolved
 */
export async function ensureAndResolveJobName(cliDirname, jobNameArg, dirOption, autoSelectSingleIfOneJob = false) {
  let resolvedJobName = jobNameArg || detectJobDirectory(cliDirname, dirOption);

  if (!resolvedJobName && autoSelectSingleIfOneJob) {
    const jobDirs = getAvailableJobDirs(cliDirname);
    if (jobDirs.length === 1) {
      resolvedJobName = jobDirs[0];
      console.log(`Only one job available, using: ${resolvedJobName}`);
    }
  }

  if (!resolvedJobName) {
    listAvailableJobs(cliDirname);
    console.error('Please specify the job name (e.g., my-job), use the -d <jobDirectory> option, or run from within the job directory.');
    return null;
  }
  return resolvedJobName;
}

/**
 * Get the Cloudflare worker URL from options or .shopworker.json file
 * @param {Object} options - The command options
 * @param {string} [cliDirname] - Optional directory where cli.js is located (project root)
 * @returns {string|null} The worker URL or null if not found
 */
export function getWorkerUrl(options, cliDirname = process.cwd()) {
  // First check if URL is provided in command options
  if (options.worker) {
    return options.worker;
  }

  // Otherwise, try to load from .shopworker.json
  const shopworkerPath = path.join(cliDirname, '.shopworker.json');
  if (fs.existsSync(shopworkerPath)) {
    try {
      const shopworkerConfig = JSON.parse(fs.readFileSync(shopworkerPath, 'utf8'));
      if (shopworkerConfig.cloudflare_worker_url) {
        return shopworkerConfig.cloudflare_worker_url;
      }
    } catch (error) {
      console.error(`Error reading .shopworker.json: ${error.message}`);
    }
  }

  console.error('Cloudflare worker URL is required. Please set cloudflare_worker_url in your .shopworker.json file or use the -w <workerUrl> option.');
  return null;
}

/**
 * Load and validate job and trigger configurations for webhook operations
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} jobPath - The job path relative to jobs/
 * @returns {Object|null} The job and trigger configurations or null if invalid
 */
export function loadAndValidateWebhookConfigs(cliDirname, jobPath) {
  try {
    const jobConfig = loadJobConfig(jobPath); // Can throw
    if (!jobConfig.trigger) {
      console.error(`Job ${jobPath} doesn't have a trigger defined. Cannot manage webhooks.`);
      return null;
    }
    const triggerConfig = loadTriggerConfig(jobConfig.trigger); // Can throw
    if (!triggerConfig.webhook || !triggerConfig.webhook.topic) {
      console.error(`Trigger ${jobConfig.trigger} for job ${jobPath} doesn't have a webhook topic defined. Cannot manage webhooks.`);
      return null;
    }
    return { jobConfig, triggerConfig };
  } catch (error) {
    console.error(`Error loading configuration for job ${jobPath}: ${error.message}`);
    return null;
  }
}
