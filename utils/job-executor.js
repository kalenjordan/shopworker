import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import chalk from 'chalk';
import { loadJobConfig, loadTriggerConfig } from './job-loader.js';
import { initShopify } from './shopify-api-helpers.js';

// Add crypto import for Node.js environment
import crypto from 'crypto';

/**
 * Get shop configuration from .shopworker.json
 * @param {string} cliDirname - The directory where cli.js is located
 * @param {string} shopName - The shop name from job config
 * @returns {Object} The shop configuration
 */
function getShopConfig(cliDirname, shopName) {
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

  // Disable for now so cli logs match the worker logs
  // if (topLevelKey) {
  //   console.log(`Processing ${topLevelKey.replace(/s$/, '')} ${recordName} for job ${jobPath}...`);
  // } else {
  //   console.log(`Processing manual trigger for job ${jobPath}...`);
  // }

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
 * Get shop domain from shopworker.json
 * @param {string} cliDirname - The directory where cli.js is located
 * @param {string} shopName - The shop name from job config
 * @returns {string} The shop domain or a default value
 */
function getShopDomain(cliDirname, shopName) {
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
 * Node.js implementation of the same function in worker-utils.js
 * Generate HMAC signature for webhook payload
 * @param {string} secret - The webhook secret
 * @param {string} body - The request body as string
 * @returns {Promise<string>} The base64 encoded signature
 */
export async function generateHmacSignature(secret, body) {
  // Use Node.js crypto module to generate the signature
  return crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('base64');
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

  let data = {
    id: recordId
  };

  // Convert data to JSON string - we need this for signature generation
  const jsonData = JSON.stringify(data);

  // Generate HMAC signature using our shared function
  const hmacSignature = await generateHmacSignature(apiSecret, jsonData);

  console.log(`Sending test request to worker for job: ${jobPath}: ${webhookAddress}`);
  console.log(`Topic: ${webhookTopic}`);
  console.log(`Shop: ${chalk.magenta(shopDomain)}`);
  console.log(`Data: ${jsonData}`);
  console.log(`HMAC Signature: ${hmacSignature}`);

  // Send the request
  const response = await fetch(webhookAddress, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Hmac-Sha256': hmacSignature,
      'X-Shopify-Topic': webhookTopic,
      'X-Shopify-Shop-Domain': shopDomain,
      'X-Shopify-API-Version': '2024-07'
    },
    body: jsonData
  });

  // Check the response status
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Error from worker: ${response.status} ${response.statusText}\n${errorText}`);
  }

  // Parse the response as JSON
  const responseText = await response.text();
  const result = JSON.parse(responseText);

  // Output the response
  console.log('Worker response:', JSON.stringify(result, null, 2));

  // Highlight the message if available
  if (result.message) {
    console.log('\n✅ ' + result.message);
  }

  console.log('Remote test completed successfully!');
}
