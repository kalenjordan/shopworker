import chalk from 'chalk';
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
 * @returns {Object} Object containing job config, trigger config, and webhook topic
 * @throws {Error} If job config cannot be loaded
 */
export function loadJobConfigsForRemoteTest(jobPath) {
  const jobConfig = loadJobConfig(jobPath);
  if (!jobConfig) {
    throw new Error(`Could not load configuration for job: ${jobPath}`);
  }

  const triggerConfig = jobConfig.trigger ? loadTriggerConfig(jobConfig.trigger) : null;
  const webhookTopic = triggerConfig?.webhook?.topic || 'products/create'; // Default if not found

  return { jobConfig, triggerConfig, webhookTopic };
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
 * Prepares the webhook payload and URL for testing
 * @param {string} workerUrl - The worker URL
 * @param {string} jobPath - The job path relative to jobs/
 * @param {string} recordId - The record ID to use
 * @param {string} shopDomain - The shop domain
 * @returns {Object} Object containing webhook URL and payload
 */
export function prepareWebhookRequest(workerUrl, jobPath, recordId, shopDomain) {
  // Format webhook URL
  const webhookUrl = new URL(workerUrl);
  webhookUrl.searchParams.set('job', jobPath);
  const webhookAddress = webhookUrl.toString();

  // Prepare webhook payload
  const payload = {
    id: recordId,
    admin_graphql_api_id: recordId,
    shop_domain: shopDomain
  };

  return { webhookAddress, payload };
}

/**
 * Sends the test webhook to the worker
 * @param {string} webhookAddress - The webhook URL
 * @param {Object} payload - The webhook payload
 * @param {string} apiSecret - The API secret for HMAC signing
 * @param {string} webhookTopic - The webhook topic
 * @param {string} shopDomain - The shop domain
 * @returns {Promise<void>}
 */
export async function sendTestWebhook(webhookAddress, payload, apiSecret, webhookTopic, shopDomain) {
  // Convert payload to string
  const payloadString = JSON.stringify(payload);

  console.log(chalk.blue(`Sending test webhook to: ${webhookAddress}`));
  console.log(chalk.dim(`Payload: ${payloadString.substring(0, 100)}${payloadString.length > 100 ? '...' : ''}`));

  // Import fetch for Node.js environment
  const fetch = (await import('node-fetch')).default;

  try {
    // Generate a proper HMAC signature for the worker to verify
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
  const { jobConfig, webhookTopic } = loadJobConfigsForRemoteTest(jobPath);

  // Get shop configuration and API secret
  const { apiSecret, shopDomain } = getShopConfigWithSecret(cliDirname, jobConfig.shop, options.shop);

  // Get record ID or find sample record
  const recordId = await getTestRecordId(cliDirname, jobPath, options);

  // Prepare webhook payload and URL
  const { webhookAddress, payload } = prepareWebhookRequest(workerUrl, jobPath, recordId, shopDomain);

  // Send test webhook
  await sendTestWebhook(webhookAddress, payload, apiSecret, webhookTopic, shopDomain);
}
