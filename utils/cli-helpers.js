import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import chalk from 'chalk';
import { loadJobConfig, loadTriggerConfig } from './job-loader.js';
import { initShopify } from './shopify.js';
import { hmacSha256 } from './crypto.js';
import { logToCli } from './log.js';

// Re-export logToCli to maintain compatibility
export { logToCli };

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

/**
 * Get shop configuration from .shopworker.json
 * @param {string} cliDirname - The directory where cli.js is located
 * @param {string} shopName - The shop name from job config
 * @returns {Object} The shop configuration
 */
export function getShopConfig(cliDirname, shopName) {
  const shopworkerFilePath = path.join(cliDirname, '.shopworker.json');
  if (!fs.existsSync(shopworkerFilePath)) {
    throw new Error('.shopworker.json file not found. Please create one.');
  }

  const shopworkerFileContent = fs.readFileSync(shopworkerFilePath, 'utf8');
  const shopworkerData = JSON.parse(shopworkerFileContent);

  if (!shopworkerData.shops || !Array.isArray(shopworkerData.shops)) {
    throw new Error('Invalid .shopworker.json format: "shops" array is missing or not an array.');
  }

  const shopConfig = shopworkerData.shops.find(s => s.name === shopName);
  if (!shopConfig) {
    throw new Error(`Shop configuration for '${shopName}' not found in .shopworker.json.`);
  }

  return shopConfig;
}

/**
 * Get shop domain from shopworker.json
 * @param {string} cliDirname - The directory where cli.js is located
 * @param {string} shopName - The shop name from job config
 * @returns {string} The shop domain or a default value
 */
export function getShopDomain(cliDirname, shopName) {
  try {
    const shopworkerPath = path.join(cliDirname, '.shopworker.json');
    const shopworkerContent = fs.readFileSync(shopworkerPath, 'utf8');
    const shopworkerData = JSON.parse(shopworkerContent);
    const shopConfig = shopworkerData.shops.find(s => s.name === shopName);

    if (shopConfig && shopConfig.shopify_domain) {
      return shopConfig.shopify_domain;
    }
  } catch (error) {
    console.warn(`Warning: Could not read shop domain from config: ${error.message}`);
  }

  return 'unknown-shop.myshopify.com'; // Default fallback
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

  if (triggerConfig.test && triggerConfig.test.skipQuery) {
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

  // Log shop domain in purple using chalk
  console.log(chalk.magenta(`Processing for shop: ${shopConfig.shopify_domain}`));

  // Use path.resolve with pathToFileURL to ensure proper module resolution
  const jobModulePath = pathToFileURL(path.resolve(cliDirname, `jobs/${jobPath}/job.js`)).href;
  const jobModule = await import(jobModulePath);

  // Pass process.env as env and shopConfig as shopConfig for consistency with worker environment
  await jobModule.process({
    record,
    shopify: shopify,
    env: process.env,   // Pass Node.js process.env as env
    shopConfig: shopConfig,  // Pass shopConfig separately
    jobConfig: jobConfig  // Pass the job config to the process function
  });
  console.log('Processing complete!');
}

/**
 * Run a remote test against the worker for a specific job
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} jobPath - The job path relative to jobs/
 * @param {Object} options - Command options including workerUrl, recordId, and queryParam
 * @returns {Promise<void>}
 */
export async function runJobRemoteTest(cliDirname, jobPath, options) {
  // Get worker URL
  const workerUrl = options.worker;
  if (!workerUrl) {
    throw new Error("Worker URL is required for remote testing. Please provide with -w or set cloudflare_worker_url in .shopworker.json.");
  }

  // Load job and trigger configs
  const jobConfig = loadJobConfig(jobPath);
  if (!jobConfig) {
    throw new Error(`Could not load configuration for job: ${jobPath}`);
  }

  const triggerConfig = jobConfig.trigger ? loadTriggerConfig(jobConfig.trigger) : null;
  const webhookTopic = triggerConfig?.webhook?.topic || 'products/create'; // Default if not found

  // Get shop domain
  const shopDomain = options.shop || getShopDomain(cliDirname, jobConfig.shop);

  // Get shop configuration to retrieve API secret
  const shopworkerFilePath = path.join(cliDirname, '.shopworker.json');
  const shopworkerContent = fs.readFileSync(shopworkerFilePath, 'utf8');
  const shopworkerData = JSON.parse(shopworkerContent);
  const shopConfig = shopworkerData.shops.find(s => s.name === jobConfig.shop);

  if (!shopConfig || !shopConfig.shopify_api_secret_key) {
    throw new Error(`API secret not found for shop '${jobConfig.shop}'. Make sure shopify_api_secret_key is defined in .shopworker.json.`);
  }

  const apiSecret = shopConfig.shopify_api_secret_key;

  // Get record ID or find sample record
  let recordId = options.id;
  if (!recordId) {
    console.log("No record ID provided. Finding a sample record...");
    const { record } = await findSampleRecordForJob(cliDirname, jobPath, options.query, options.shop);
    recordId = record.id;
    if (!recordId) {
      throw new Error("Could not extract ID from the sample record.");
    }
    console.log(`Found sample record with ID: ${recordId}`);
  }

  // Format webhook URL
  const webhookUrl = new URL(workerUrl);
  webhookUrl.searchParams.set('job', jobPath);
  const webhookAddress = webhookUrl.toString();

  // Prepare webhook payload
  const payload = {
    id: recordId,
    admin_graphql_api_id: recordId
  };

  // Add shop_domain field for worker to identify the shop
  payload.shop_domain = shopDomain;

  // Convert payload to string
  const payloadString = JSON.stringify(payload);

  // Send test webhook
  console.log(chalk.blue(`Sending test webhook to: ${webhookAddress}`));
  console.log(chalk.dim(`Payload: ${payloadString.substring(0, 100)}${payloadString.length > 100 ? '...' : ''}`));

  // Import fetch for Node.js environment
  const fetch = (await import('node-fetch')).default;

  try {
    // We need to generate a proper HMAC signature for the worker to verify
    const hmacSignature = await hmacSha256(apiSecret, payloadString);

    const response = await fetch(webhookAddress, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Topic': webhookTopic,
        'X-Shopify-Hmac-Sha256': hmacSignature,
        'X-Shopify-Shop-Domain': shopDomain,
        'X-Shopify-Test': 'true'
      },
      body: payloadString
    });

    if (response.ok) {
      console.log(chalk.green(`Successfully sent test webhook and received response ${response.status}`));
      const responseText = await response.text();
      if (responseText) {
        console.log(chalk.dim(`Response: ${responseText}`));
      }
    } else {
      console.error(chalk.red(`Failed to send test webhook. Status: ${response.status}`));
      const responseText = await response.text();
      console.error(chalk.red(`Response: ${responseText}`));
    }
  } catch (error) {
    console.error(chalk.red(`Error sending test webhook: ${error.message}`));
    if (error.stack) {
      console.error(chalk.dim(error.stack));
    }
  }
}

/**
 * Handle Cloudflare deployment logic
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @returns {Promise<boolean>} Whether the deployment was successful
 */
export async function handleCloudflareDeployment(cliDirname) {
  try {
    const { execSync } = await import('child_process');
    const gitStatus = execSync('git status --porcelain', { encoding: 'utf8' });
    if (gitStatus.trim() !== '') {
      console.error('Warning: There are uncommitted changes in your Git repository. Please commit or stash them before deploying.');
      console.error('Uncommitted changes:\n' + gitStatus);
      // return false;
    }
  } catch (error) {
    console.error('Error checking Git status:', error.message);
    console.warn('Warning: Could not verify Git status. Proceeding, but this might lead to deploying uncommitted code.');
  }

  const shopworkerFilePath = path.join(cliDirname, '.shopworker.json');
  let lastDeployedCommit = null;
  if (fs.existsSync(shopworkerFilePath)) {
    try {
      const shopworkerData = JSON.parse(fs.readFileSync(shopworkerFilePath, 'utf8'));
      lastDeployedCommit = shopworkerData?.lastDeployedCommit;
    } catch (error) {
      console.warn('Warning: Could not read or parse .shopworker file. Will proceed as if no previous deployment was made.', error.message);
    }
  }

  let currentCommit = null;
  try {
    const { execSync } = await import('child_process');
    currentCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch (error) {
    console.error('Error getting current Git commit:', error.message);
    console.error('Cannot proceed without knowing the current commit. Please ensure you are in a Git repository.');
    return false;
  }

  if (currentCommit !== lastDeployedCommit) {
    console.log(`Current commit (${currentCommit}) differs from last deployed commit (${lastDeployedCommit || 'None'}).`);
    console.log('Deploying to Cloudflare via Wrangler...');
    try {
      const { execSync } = await import('child_process');
      execSync('npx wrangler deploy', { stdio: 'inherit', encoding: 'utf8' });
      console.log('Successfully deployed to Cloudflare.');

      // Preserve existing content in .shopworker.json when updating the lastDeployedCommit
      const newShopworkerData = fs.existsSync(shopworkerFilePath)
        ? { ...JSON.parse(fs.readFileSync(shopworkerFilePath, 'utf8')), lastDeployedCommit: currentCommit }
        : { lastDeployedCommit: currentCommit };

      fs.writeFileSync(shopworkerFilePath, JSON.stringify(newShopworkerData, null, 2), 'utf8');
      console.log(`Updated .shopworker with new deployed commit: ${currentCommit}`);
    } catch (error) {
      console.error('Error deploying to Cloudflare with Wrangler:', error.message);
      console.error('Aborting deployment.');
      return false;
    }
  } else {
    console.log(`Current commit (${currentCommit}) matches last deployed commit. No new deployment needed.`);
  }
  return true;
}
