import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { loadJobConfig, loadTriggerConfig } from './job-loader.js';
import { hmacSha256 } from './crypto.js';
import { getShopConfigWithSecret, getShopDomain } from './config-helpers.js';
import { findSampleRecordForJob } from './job-management.js';

/**
 * Validates and retrieves the worker URL for remote testing
 * @param {string} workerUrlOption - The worker URL option from command line
 * @returns {string} The validated worker URL
 * @throws {Error} If worker URL is missing
 */
export function validateWorkerUrl(workerUrlOption) {
  if (!workerUrlOption) {
    throw new Error("Worker URL is required for remote testing. Please provide with -w or set cloudflare_worker_url in .shopworker.json.");
  }
  return workerUrlOption;
}

/**
 * Loads job and trigger configurations for remote testing
 * @param {string} jobPath - The job path relative to jobs/
 * @returns {Object} Object containing job config, trigger config, and Shopify webhook topic
 * @throws {Error} If job config cannot be loaded
 */
export function loadJobConfigsForRemoteTest(jobPath) {
  const jobConfig = loadJobConfig(jobPath);
  if (!jobConfig) {
    throw new Error(`Could not load configuration for job: ${jobPath}`);
  }

  const triggerConfig = jobConfig.trigger ? loadTriggerConfig(jobConfig.trigger) : null;
  const shopifyWebhookTopic = triggerConfig?.webhook?.topic || 'products/create'; // Default if not found

  return { jobConfig, triggerConfig, shopifyWebhookTopic };
}

/**
 * Loads Shopworker webhook fixture data for webhook triggers
 * @param {string} cliDirname - The directory where cli.js is located
 * @param {string} jobPath - The job path relative to jobs/
 * @param {Object} jobConfig - The job configuration
 * @returns {Promise<Object>} The Shopworker webhook payload from fixture
 * @throws {Error} If fixture cannot be loaded
 */
export async function loadShopworkerWebhookFixture(cliDirname, jobPath, jobConfig) {
  if (!jobConfig.test || !jobConfig.test.webhookPayload) {
    throw new Error(`Job ${jobPath} has trigger 'webhook' but is missing 'test.webhookPayload' file path in config.json`);
  }

  const payloadPath = path.resolve(cliDirname, jobConfig.test.webhookPayload);

  if (!fs.existsSync(payloadPath)) {
    throw new Error(`Shopworker webhook payload file not found: ${payloadPath}. Please ensure the file exists at the path specified in config.json.`);
  }

  console.log(`Loading Shopworker webhook fixture from: ${jobConfig.test.webhookPayload}`);

  try {
    const payloadContent = fs.readFileSync(payloadPath, 'utf8');
    return JSON.parse(payloadContent);
  } catch (error) {
    throw new Error(`Failed to load Shopworker webhook payload from ${payloadPath}: ${error.message}`);
  }
}

/**
 * Finds or uses a provided record ID for testing
 * @param {string} cliDirname - The directory where cli.js is located
 * @param {string} jobPath - The job path relative to jobs/
 * @param {Object} options - Command options including recordId and queryParam
 * @returns {Promise<string>} The record ID to use for testing
 * @throws {Error} If record ID cannot be determined
 */
export async function getTestRecordId(cliDirname, jobPath, options) {
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
  return recordId;
}

/**
 * Prepares the Shopify webhook payload and URL for testing
 * @param {string} workerUrl - The worker URL
 * @param {string} jobPath - The job path relative to jobs/
 * @param {Object} payload - The payload to send (either minimal with ID or full Shopworker webhook fixture)
 * @param {string} shopDomain - The shop domain
 * @returns {Object} Object containing Shopify webhook URL and payload
 */
export function prepareShopifyWebhookRequest(workerUrl, jobPath, payload, shopDomain) {
  // Format Shopify webhook URL
  const webhookUrl = new URL(workerUrl);
  webhookUrl.searchParams.set('job', jobPath);
  const shopifyWebhookAddress = webhookUrl.toString();

  // Ensure payload has shop_domain for Shopify webhook format
  const shopifyWebhookPayload = {
    ...payload,
    shop_domain: shopDomain
  };

  return { shopifyWebhookAddress, shopifyWebhookPayload };
}

/**
 * Sends the test webhook to the worker (either Shopify or Shopworker webhook)
 * @param {string} shopifyWebhookAddress - The webhook URL
 * @param {Object} shopifyWebhookPayload - The webhook payload
 * @param {Object} shopConfig - The shop configuration containing secrets
 * @param {string} shopifyWebhookTopic - The Shopify webhook topic
 * @param {string} shopDomain - The shop domain
 * @param {boolean} isShopworkerWebhook - Whether this is a Shopworker webhook trigger
 * @returns {Promise<void>}
 */
export async function sendTestShopifyWebhook(shopifyWebhookAddress, shopifyWebhookPayload, shopConfig, shopifyWebhookTopic, shopDomain, isShopworkerWebhook = false) {
  // Convert payload to string
  const payloadString = JSON.stringify(shopifyWebhookPayload);

  const topic = isShopworkerWebhook ? 'shopworker/webhook' : shopifyWebhookTopic;
  const webhookType = isShopworkerWebhook ? "Shopworker webhook" : "Shopify webhook";
  console.log(chalk.blue(`Sending test ${webhookType} to: ${shopifyWebhookAddress}`));
  console.log(chalk.blue(`Topic: ${topic}`));
  console.log(chalk.dim(`Payload: ${payloadString.substring(0, 100)}${payloadString.length > 100 ? '...' : ''}`));

  // Import fetch for Node.js environment
  const fetch = (await import('node-fetch')).default;

  try {
    let headers = {
      'Content-Type': 'application/json',
      'X-Shopify-Topic': topic,
      'X-Shopify-Shop-Domain': shopDomain,
      'X-Shopify-Test': 'true'
    };

    if (isShopworkerWebhook) {
      // For Shopworker webhooks, use the shopworker webhook secret as a header
      if (!shopConfig.shopworker_webhook_secret) {
        throw new Error(`Shopworker webhook secret not found in shop config. Make sure shopworker_webhook_secret is defined in .shopworker.json.`);
      }
      headers['X-Shopworker-Webhook-Secret'] = shopConfig.shopworker_webhook_secret;
    } else {
      // For Shopify webhooks, generate HMAC signature using API secret
      if (!shopConfig.shopify_api_secret_key) {
        throw new Error(`Shopify API secret not found in shop config. Make sure shopify_api_secret_key is defined in .shopworker.json.`);
      }
      const hmacSignature = await hmacSha256(shopConfig.shopify_api_secret_key, payloadString);
      headers['X-Shopify-Hmac-Sha256'] = hmacSignature;
    }

    const response = await fetch(shopifyWebhookAddress, {
      method: 'POST',
      headers,
      body: payloadString
    });

    if (response.ok) {
      console.log(chalk.green(`Successfully sent test ${webhookType} and received response ${response.status}`));
      const responseText = await response.text();
      if (responseText) {
        console.log(chalk.dim(`Response: ${responseText}`));
      }
    } else {
      console.error(chalk.red(`Failed to send test ${webhookType}. Status: ${response.status}`));
      const responseText = await response.text();
      console.error(chalk.red(`Response: ${responseText}`));
    }
  } catch (error) {
    console.error(chalk.red(`Error sending test ${webhookType}: ${error.message}`));
    if (error.stack) {
      console.error(chalk.dim(error.stack));
    }
  }
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
  const workerUrl = validateWorkerUrl(options.worker);

  // Load job and trigger configs
  const { jobConfig, shopifyWebhookTopic } = loadJobConfigsForRemoteTest(jobPath);

  // Get shop configuration and API secret
  const { shopConfig, shopDomain } = getShopConfigWithSecret(cliDirname, jobConfig.shop, options.shop);

  let payload;
  let isShopworkerWebhook = false;

  // Check if this is a Shopworker webhook trigger
  if (jobConfig.trigger === 'webhook') {
    // For Shopworker webhook triggers, load the fixture data
    payload = await loadShopworkerWebhookFixture(cliDirname, jobPath, jobConfig);
    isShopworkerWebhook = true;
    console.log(chalk.yellow("Using Shopworker webhook fixture data for remote test"));
  } else {
    // For other triggers (Shopify webhook triggers), get record ID and create minimal payload
    const recordId = await getTestRecordId(cliDirname, jobPath, options);
    payload = {
      id: recordId,
      admin_graphql_api_id: recordId
    };
    console.log(chalk.yellow("Using minimal payload with record ID for remote test"));
  }

  // Prepare Shopify webhook payload and URL
  const { shopifyWebhookAddress, shopifyWebhookPayload } = prepareShopifyWebhookRequest(workerUrl, jobPath, payload, shopDomain);

  // Send test webhook
  await sendTestShopifyWebhook(shopifyWebhookAddress, shopifyWebhookPayload, shopConfig, shopifyWebhookTopic, shopDomain, isShopworkerWebhook);
}
