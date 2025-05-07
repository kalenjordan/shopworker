import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { loadJobConfig, loadTriggerConfig } from './job-loader.js';
import { initShopify } from './shopify-api-helpers.js';

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
 * @param {string} jobName - The job name
 * @param {string} queryParam - Optional query parameter for filtering results
 * @returns {Promise<{record: Object, recordName: string, shopify: Object, triggerConfig: Object, jobConfig: Object}>}
 * The sample record and related configuration
 */
export async function findSampleRecordForJob(cliDirname, jobName, queryParam) {
  const jobConfig = loadJobConfig(jobName);
  if (!jobConfig.trigger) {
    throw new Error(`Job ${jobName} doesn't have a trigger defined`);
  }

  const triggerConfig = loadTriggerConfig(jobConfig.trigger);
  const shopify = initShopify(cliDirname, jobName);

  if (triggerConfig.test && triggerConfig.test.skipQuery) {
    return {
      record: {},
      recordName: 'manual-trigger',
      shopify,
      triggerConfig,
      jobConfig
    };
  }

  if (!triggerConfig.test || !triggerConfig.test.query) {
    throw new Error(`Trigger ${jobConfig.trigger} doesn't have a test query defined`);
  }

  const queryModulePath = pathToFileURL(path.resolve(cliDirname, `graphql/${triggerConfig.test.query}.js`)).href;
  const queryModule = await import(queryModulePath);
  const query = queryModule.default;

  console.log("Fetching most recent data...");
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
    throw new Error(`No ${topLevelKey || 'data'} found in response for job ${jobName}. Query: ${triggerConfig.test.query}`);
  }

  const record = response[topLevelKey].edges[0].node;
  const recordName = record.name || record.title || record.id;

  return {
    record,
    recordName,
    shopify,
    topLevelKey,
    triggerConfig,
    jobConfig
  };
}

/**
 * Run a test for a specific job
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} jobName - The job name
 * @param {string} queryParam - Optional query parameter for filtering results
 */
export async function runJobTest(cliDirname, jobName, queryParam) {
  try {
    const { record, recordName, shopify, topLevelKey, jobConfig } = await findSampleRecordForJob(cliDirname, jobName, queryParam);

    // Get shop configuration from .shopworker.json
    const shopConfig = getShopConfig(cliDirname, jobConfig.shop);

    // Use path.resolve with pathToFileURL to ensure proper module resolution
    const jobModulePath = pathToFileURL(path.resolve(cliDirname, `jobs/${jobName}/job.js`)).href;
    const jobModule = await import(jobModulePath);

    if (topLevelKey) {
      console.log(`Processing ${topLevelKey.replace(/s$/, '')} ${recordName} for job ${jobName}...`);
    } else {
      console.log(`Processing manual trigger for job ${jobName}...`);
    }

    await jobModule.process({ record, shopify: shopify, env: shopConfig });
    console.log('Processing complete!');
  } catch (error) {
    console.error(`Error running job test: ${error.message}`);
  }
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
 * Run a remote test against the worker for a specific job
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} jobName - The job name
 * @param {Object} options - Command options including workerUrl, recordId, and queryParam
 * @returns {Promise<void>}
 */
export async function runJobRemoteTest(cliDirname, jobName, options) {
  try {
    // Get worker URL
    const workerUrl = options.worker;
    if (!workerUrl) {
      throw new Error("Worker URL is required for remote testing. Please provide with -w or set cloudflare_worker_url in .shopworker.json.");
    }

    // Load job and trigger configs
    const jobConfig = loadJobConfig(jobName);
    if (!jobConfig) {
      throw new Error(`Could not load configuration for job: ${jobName}`);
    }

    const triggerConfig = jobConfig.trigger ? loadTriggerConfig(jobConfig.trigger) : null;
    const webhookTopic = triggerConfig?.webhook?.topic || 'products/create'; // Default if not found

    // Get shop domain
    const shopDomain = getShopDomain(cliDirname, jobConfig.shop);

    // Get record ID or find sample record
    let recordId = options.id;
    if (!recordId) {
      console.log("No record ID provided. Finding a sample record...");
      const { record } = await findSampleRecordForJob(cliDirname, jobName, options.query);
      recordId = record.id;
      if (!recordId) {
        throw new Error("Could not extract ID from the sample record.");
      }
      console.log(`Found sample record with ID: ${recordId}`);
    }

    // Format webhook URL
    const webhookUrl = new URL(workerUrl);
    webhookUrl.searchParams.set('job', jobName);
    const webhookAddress = webhookUrl.toString();

    let data = {
      id: recordId
    };
    console.log(`Sending test request to worker for job: ${jobName}: ${webhookAddress}`);
    console.log(`Topic: ${webhookTopic}`);
    console.log(`Shop: ${shopDomain}`);
    console.log(`Data\n: ${JSON.stringify(data, null, 2)}\n`);

    // Send the request
    const response = await fetch(webhookAddress, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Hmac-Sha256': 'dummY',
        'X-Shopify-Topic': webhookTopic,
        'X-Shopify-Shop-Domain': shopDomain,
        'X-Shopify-API-Version': '2024-07'
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Error from worker: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const result = await response.json();
    console.log('Worker response:', JSON.stringify(result, null, 2));
    console.log('Remote test completed successfully!');
  } catch (error) {
    console.error(`Error running remote test: ${error.message}`);
  }
}
