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
 * Get the Cloudflare worker URL from options or environment variables
 * @param {Object} options - The command options
 * @returns {string|null} The worker URL or null if not found
 */
export function getWorkerUrl(options) {
  const url = options.worker || process.env.CLOUDFLARE_WORKER_URL;
  if (!url) {
    console.error('Cloudflare worker URL is required. Please set CLOUDFLARE_WORKER_URL in your .env file or use the -w <workerUrl> option.');
    return null;
  }
  return url;
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
