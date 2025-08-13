import fs from 'fs';
import path from 'path';
import { loadJobConfig, loadTriggerConfig } from './job-loader.js';

/**
 * Get all available job directories
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} [currentDir] - If provided, only return jobs under this directory
 * @returns {Array<string>} List of job directory paths relative to jobs/ (e.g., 'hello-world', 'order/fetch')
 */
export const getAvailableJobDirs = (cliDirname, currentDir = null) => {
  const jobDirs = new Set(); // Use Set to avoid duplicates

  // Helper function to recursively find directories with config.json
  const findJobDirs = (dir, relativePath = '') => {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir);

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const entryRelativePath = relativePath ? path.join(relativePath, entry) : entry;

      if (fs.statSync(fullPath).isDirectory()) {
        // Check if this directory contains a config.json file
        if (fs.existsSync(path.join(fullPath, 'config.json'))) {
          jobDirs.add(entryRelativePath);
        }

        // Recursively search subdirectories
        findJobDirs(fullPath, entryRelativePath);
      }
    }
  };

  // Search in both local and core job directories (local first for priority)
  const localJobsDir = path.join(cliDirname, 'local', 'jobs');
  const coreJobsDir = path.join(cliDirname, 'core', 'jobs');

  findJobDirs(localJobsDir, 'local/jobs');
  findJobDirs(coreJobsDir, 'core/jobs');

  const jobDirsArray = Array.from(jobDirs);

  // If currentDir is provided, filter the results to only include jobs under that directory
  if (currentDir) {
    const relativeToCoreDir = path.relative(coreJobsDir, currentDir);
    const relativeToLocalDir = path.relative(localJobsDir, currentDir);

    // Determine which relative path to use for filtering
    let relativeDir = null;
    if (!relativeToCoreDir.startsWith('..') && relativeToCoreDir !== '') {
      relativeDir = relativeToCoreDir;
    } else if (!relativeToLocalDir.startsWith('..') && relativeToLocalDir !== '') {
      relativeDir = relativeToLocalDir;
    }

    if (relativeDir) {
      return jobDirsArray.filter(jobDir =>
        jobDir === relativeDir ||
        jobDir.startsWith(relativeDir + path.sep)
      );
    }
  }

  return jobDirsArray;
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
 * @returns {string|null} The job name or path (e.g., 'hello-world', 'order/fetch') or null if not determined
 */
export function detectJobDirectory(cliDirname, specifiedDir) {
  if (specifiedDir) return specifiedDir;
  const initCwd = process.env.INIT_CWD || process.cwd();
  const currentDir = process.cwd();
  const dirsToCheck = [initCwd, currentDir];
  const coreJobsDir = path.join(cliDirname, 'core', 'jobs');
  const localJobsDir = path.join(cliDirname, 'local', 'jobs');
  const validJobDirs = getAvailableJobDirs(cliDirname);

  for (const dir of dirsToCheck) {
    // Check if we're in a local job directory first (higher priority)
    const relPathLocal = path.relative(localJobsDir, dir);
    if (!relPathLocal.startsWith('..') && relPathLocal !== '') {
      // Find the closest parent directory that contains a config.json
      let currentRelPath = relPathLocal;
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

    // Check if we're in a core job directory
    const relPathCore = path.relative(coreJobsDir, dir);
    if (!relPathCore.startsWith('..') && relPathCore !== '') {
      // Find the closest parent directory that contains a config.json
      let currentRelPath = relPathCore;
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
