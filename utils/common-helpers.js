import fs from 'fs';
import path from 'path';
import { loadJobConfig, loadTriggerConfig } from './job-loader.js';

/**
 * Get all job directories in the jobs folder
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @returns {Array<string>} List of job directory names
 */
export const getAvailableJobDirs = (cliDirname) => {
  const jobsDir = path.join(cliDirname, 'jobs');
  if (!fs.existsSync(jobsDir)) return [];
  return fs.readdirSync(jobsDir)
    .filter(dir => fs.statSync(path.join(jobsDir, dir)).isDirectory());
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
 * @returns {string|null} The job name or null if not determined
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
    const dirName = path.basename(dir);
    if (validJobDirs.includes(dirName)) return dirName;
    const relPath = path.relative(jobsDir, dir);
    if (!relPath.startsWith('..') && relPath !== '') {
      const jobName = relPath.split(path.sep)[0];
      if (validJobDirs.includes(jobName)) return jobName;
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
 * Detect whether the code is running in CLI or Cloudflare Worker environment
 * @returns {'cli'|'worker'} The current environment
 */
export function getEnvironment() {
  // Check for Node.js specific globals
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    return 'cli';
  }

  // Check for Cloudflare Worker specific globals
  if (typeof globalThis !== 'undefined' &&
      typeof globalThis.caches !== 'undefined' &&
      typeof globalThis.addEventListener === 'function') {
    return 'worker';
  }

  // Fallback
  return 'cli';
}

/**
 * Simple worker-only logging function
 * @param {...any} args - Arguments to pass to console.log
 */
export function workerLog(...args) {
  if (getEnvironment() === 'worker') {
    console.log(...args);
  }
}

/**
 * Load and validate job and trigger configurations for webhook operations
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} jobName - The job name
 * @returns {Object|null} The job and trigger configurations or null if invalid
 */
export function loadAndValidateWebhookConfigs(cliDirname, jobName) {
  try {
    const jobConfig = loadJobConfig(jobName); // Can throw
    if (!jobConfig.trigger) {
      console.error(`Job ${jobName} doesn't have a trigger defined. Cannot manage webhooks.`);
      return null;
    }
    const triggerConfig = loadTriggerConfig(jobConfig.trigger); // Can throw
    if (!triggerConfig.webhook || !triggerConfig.webhook.topic) {
      console.error(`Trigger ${jobConfig.trigger} for job ${jobName} doesn't have a webhook topic defined. Cannot manage webhooks.`);
      return null;
    }
    return { jobConfig, triggerConfig };
  } catch (error) {
    console.error(`Error loading configuration for job ${jobName}: ${error.message}`);
    return null;
  }
}
