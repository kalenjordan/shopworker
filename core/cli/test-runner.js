import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import chalk from 'chalk';
import { loadJobConfig, loadTriggerConfig } from './job-discovery.js';
import { initShopify } from '../shared/shopify.js';
import { getShopConfig, loadSecrets } from '../shared/config-helpers.js';

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

  // Check if this is a webhook job and validate required test configuration
  if (jobConfig.trigger === 'webhook') {
    if (!jobConfig.test) {
      throw new Error(`Job ${jobPath} has trigger 'webhook' but is missing 'test' configuration in config.json`);
    }
    if (!jobConfig.test.webhookPayload || typeof jobConfig.test.webhookPayload !== 'string') {
      throw new Error(`Job ${jobPath} has trigger 'webhook' but is missing 'test.webhookPayload' file path in config.json`);
    }
  }

  // Check if this is a webhook payload test
  if (jobConfig.trigger === 'webhook' && jobConfig.test && jobConfig.test.webhookPayload) {
    console.log("Loading webhook payload from fixtures...");
    // Use the path specified in jobConfig.test.webhookPayload
    const payloadPath = path.resolve(cliDirname, jobConfig.test.webhookPayload);
    if (!fs.existsSync(payloadPath)) {
      throw new Error(`Webhook payload file not found: ${payloadPath}. Please ensure the file exists at the path specified in config.json.`);
    }
    console.log(`Using webhook payload from: ${jobConfig.test.webhookPayload}`);
    try {
      const payloadContent = fs.readFileSync(payloadPath, 'utf8');
      const record = JSON.parse(payloadContent);
      const recordName = `webhook-payload-${path.basename(payloadPath)}`;
      return {
        record,
        recordName,
        shopify,
        triggerConfig,
        jobConfig: configToUse
      };
    } catch (error) {
      throw new Error(`Failed to load webhook payload from ${payloadPath}: ${error.message}`);
    }
  }

  if (!triggerConfig.test || !triggerConfig.test.query) {
    throw new Error(`Trigger ${jobConfig.trigger} doesn't have a test query defined`);
  }

  const queryModulePath = pathToFileURL(path.resolve(cliDirname, `core/graphql/${triggerConfig.test.query}.js`)).href;
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
 * @param {Object} options - CLI options object containing query, shop, limit, dryRun, etc.
 */
export async function runJobTest(cliDirname, jobPath, options) {
  const { record, recordName, shopify, topLevelKey, jobConfig } = await findSampleRecordForJob(cliDirname, jobPath, options.query, options.shop);

  // Start with the base job config
  let configToUse = jobConfig;

  // Override the limit in job config if provided
  if (options.limit && options.limit >= 1) {
    configToUse = {
      ...configToUse,
      test: {
        ...configToUse.test,
        limit: options.limit
      }
    };
    console.log(chalk.yellow(`Overriding job config limit with: ${options.limit}`));
  }

  // Override the dryRun in job config if provided
  if (options.dryRun !== undefined) {
    configToUse = {
      ...configToUse,
      test: {
        ...configToUse.test,
        dryRun: options.dryRun
      }
    };
    console.log(chalk.yellow(`Overriding job config dryRun with: ${options.dryRun}`));
  }

  // Get shop configuration from .shopworker.json
  const shopConfig = getShopConfig(cliDirname, configToUse.shop);

  // Load secrets from .secrets directory
  const secrets = loadSecrets(cliDirname);

  // Log shop domain in purple using chalk
  console.log(chalk.magenta(`Processing for shop: ${shopConfig.shopify_domain}`));

  // Use path.resolve with pathToFileURL to ensure proper module resolution
  // Clean the job path (remove local/jobs or core/jobs prefix if present)
  const cleanJobPath = jobPath.replace(/^(local|core)\/jobs\//, '');
  
  // First try local jobs directory
  let jobModulePath = path.resolve(cliDirname, 'local', 'jobs', cleanJobPath, 'job.js');

  if (!fs.existsSync(jobModulePath)) {
    // If not found in local, try core jobs directory
    jobModulePath = path.resolve(cliDirname, 'core', 'jobs', cleanJobPath, 'job.js');
  }
  
  // If still not found, maybe the path already includes local/jobs or core/jobs
  if (!fs.existsSync(jobModulePath)) {
    jobModulePath = path.resolve(cliDirname, jobPath, 'job.js');
  }

  const jobModule = await import(pathToFileURL(jobModulePath).href);

  // Create a mock step object for CLI execution
  const step = {
    do: async (name, callback) => {
      console.log(chalk.blue(`→ Step: ${name}`));
      try {
        const result = await callback();
        console.log(chalk.green(`✓ Step completed: ${name}`));
        return result;
      } catch (error) {
        console.log(chalk.red(`✗ Step failed: ${name}`));
        throw error;
      }
    }
  };

  // Pass process.env as env, shopConfig as shopConfig, and secrets for consistency with worker environment
  await jobModule.process({
    payload: record,
    shopify: shopify,
    env: process.env,   // Pass Node.js process.env as env
    shopConfig: shopConfig,  // Pass shopConfig separately
    jobConfig: configToUse,  // Pass the job config (with potential overrides) to the process function
    secrets: secrets,    // Pass secrets to the process function
    step: step          // Pass the mock step object
  });

  console.log('Processing complete!');
}
