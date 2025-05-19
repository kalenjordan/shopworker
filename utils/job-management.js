import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import chalk from 'chalk';
import { loadJobConfig, loadTriggerConfig } from './job-loader.js';
import { initShopify } from './shopify.js';
import { getShopConfig, loadSecrets } from './config-helpers.js';

/**
 * Get all available job directories
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} [currentDir] - If provided, only return jobs under this directory
 * @returns {Array<string>} List of job directory paths relative to jobs/
 */
export const getAvailableJobDirs = (cliDirname, currentDir = null) => {
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

  // If currentDir is provided, filter the results to only include jobs under that directory
  if (currentDir) {
    const relativeCurrentDir = path.relative(jobsDir, currentDir);

    // Only filter if the current directory is a subdirectory of jobsDir
    if (!relativeCurrentDir.startsWith('..') && relativeCurrentDir !== '') {
      return jobDirs.filter(jobDir =>
        // Include the job if it's directly in the current directory or in a subdirectory
        jobDir === relativeCurrentDir ||
        jobDir.startsWith(relativeCurrentDir + path.sep)
      );
    }
  }

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
 * Find a sample record for testing a job
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} jobPath - The job path relative to jobs/
 * @param {string} queryParam - Optional query parameter for filtering results
 * @param {string} shopParam - Optional shop domain to override the one in job config
 * @returns {Promise<{record: Object, recordName: string, shopify: Object, triggerConfig: Object, jobConfig: Object}>}
 * The sample record and related configuration
 */
export async function findSampleRecordForJob(cliDirname, jobPath, queryParam, shopParam) {
  const jobConfig = loadJobConfig(jobPath);
  if (!jobConfig.trigger) {
    throw new Error(`Job ${jobPath} doesn't have a trigger defined`);
  }

  const triggerConfig = loadTriggerConfig(jobConfig.trigger);

  // If shopParam is provided, create a copy of jobConfig with the shop override
  let configToUse = jobConfig;
  if (shopParam) {
    // Find shop by domain in shopworker.json
    const shopworkerFilePath = path.join(cliDirname, '.shopworker.json');
    const shopworkerData = JSON.parse(fs.readFileSync(shopworkerFilePath, 'utf8'));
    const shopConfig = shopworkerData.shops.find(s => s.shopify_domain === shopParam || s.name === shopParam);

    if (!shopConfig) {
      throw new Error(`Shop with domain or name '${shopParam}' not found in .shopworker.json.`);
    }

    // Create a copy of jobConfig with overridden shop
    configToUse = { ...jobConfig, shop: shopConfig.name };
    console.log(chalk.yellow(`Overriding shop with: ${shopConfig.name} (${shopConfig.shopify_domain})`));
  }

  const shopify = initShopify(cliDirname, jobPath, shopParam);

  if (jobConfig.trigger === 'manual') {
    return {
      record: {},
      recordName: 'manual-trigger',
      shopify,
      triggerConfig,
      jobConfig: configToUse
    };
  }

  if (!triggerConfig.test || !triggerConfig.test.query) {
    throw new Error(`Trigger ${jobConfig.trigger} doesn't have a test query defined`);
  }

  const queryModulePath = pathToFileURL(path.resolve(cliDirname, `graphql/${triggerConfig.test.query}.js`)).href;
  const queryModule = await import(queryModulePath);
  const query = queryModule.default;

  console.log("Populating sample record into job from CLI...");
  const variables = { first: 1 };
  if (queryParam) {
    console.log(`Using query filter: ${queryParam}`);
    variables.query = queryParam;
  }

  const response = await shopify.graphql(query, variables);
  const topLevelKey = Object.keys(response).find(key =>
    response[key] && typeof response[key] === 'object' && response[key].edges
  );

  if (!topLevelKey || !response[topLevelKey].edges || response[topLevelKey].edges.length === 0) {
    throw new Error(`No ${topLevelKey || 'data'} found in response for job ${jobPath}. Query: ${triggerConfig.test.query}`);
  }

  const record = response[topLevelKey].edges[0].node;
  const recordName = record.name || record.title || record.id;

  return {
    record,
    recordName,
    shopify,
    topLevelKey,
    triggerConfig,
    jobConfig: configToUse
  };
}

/**
 * Run a test for a specific job
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} jobPath - The job path relative to jobs/
 * @param {string} queryParam - Optional query parameter for filtering results
 * @param {string} shopParam - Optional shop domain to override the one in job config
 */
export async function runJobTest(cliDirname, jobPath, queryParam, shopParam) {
  const { record, recordName, shopify, topLevelKey, jobConfig } = await findSampleRecordForJob(cliDirname, jobPath, queryParam, shopParam);

  // Get shop configuration from .shopworker.json
  const shopConfig = getShopConfig(cliDirname, jobConfig.shop);

  // Load secrets from .secrets directory
  const secrets = loadSecrets(cliDirname);

  // Log shop domain in purple using chalk
  console.log(chalk.magenta(`Processing for shop: ${shopConfig.shopify_domain}`));

  // Use path.resolve with pathToFileURL to ensure proper module resolution
  const jobModulePath = pathToFileURL(path.resolve(cliDirname, `jobs/${jobPath}/job.js`)).href;
  const jobModule = await import(jobModulePath);

  // Pass process.env as env, shopConfig as shopConfig, and secrets for consistency with worker environment
  await jobModule.process({
    record,
    shopify: shopify,
    env: process.env,   // Pass Node.js process.env as env
    shopConfig: shopConfig,  // Pass shopConfig separately
    jobConfig: jobConfig,  // Pass the job config to the process function
    secrets: secrets    // Pass secrets to the process function
  });
  console.log('Processing complete!');
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
