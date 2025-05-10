import { loadJobConfig, loadTriggerConfig } from './job-loader.js';
import { initShopify } from './shopify.js';
import { getAvailableJobDirs, loadAndValidateWebhookConfigs } from './cli-helpers.js';
import WEBHOOK_CREATE_MUTATION from '../graphql/webhookSubscriptionCreate.js';
import WEBHOOK_DELETE_MUTATION from '../graphql/webhookSubscriptionDelete.js';
import GET_WEBHOOKS_QUERY from '../graphql/getWebhooks.js';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';

// ===================================================================
// Display Formatting Utilities
// ===================================================================

const COLUMN_WIDTHS = {
  status: 13,
  path: 30,
  shop: 18,
  job: 35,
  topic: 20
};

function cropAndPad(str, width) {
  if (!str) return ''.padEnd(width);
  str = String(str);
  return str.length > width ? str.slice(0, width - 3) + '...' : str.padEnd(width);
}

function formatStatusColumn(status, isDisabled = false) {
  if (status === 'Enabled') {
    return chalk.green(cropAndPad('✓ Enabled', COLUMN_WIDTHS.status));
  } else if (status === 'Disabled') {
    return chalk.gray(cropAndPad('✗ Disabled', COLUMN_WIDTHS.status));
  } else if (status === 'Manual') {
    return chalk.green(cropAndPad('✓ Manual', COLUMN_WIDTHS.status));
  } else {
    return cropAndPad(status, COLUMN_WIDTHS.status);
  }
}

function formatShopColumn(shop, isDisabled = false) {
  if (!shop) return cropAndPad('N/A', COLUMN_WIDTHS.shop);

  const paddedShop = cropAndPad(shop, COLUMN_WIDTHS.shop);
  return isDisabled ? chalk.gray(paddedShop) : paddedShop;
}

function applyColorIfDisabled(text, isDisabled) {
  return isDisabled ? chalk.gray(text) : text;
}

// ===================================================================
// Webhook Utility Functions
// ===================================================================

function convertToGraphqlTopic(topic) {
  return topic.toUpperCase().replace('/', '_');
}

function createWebhookUrl(baseUrl, jobPath) {
  const webhookUrl = new URL(baseUrl);
  webhookUrl.searchParams.set('job', jobPath);
  return webhookUrl.toString();
}

function getFullWebhookId(webhookId) {
  if (webhookId.startsWith('gid://')) return webhookId;
  return `gid://shopify/WebhookSubscription/${webhookId}`;
}

function getWebhookIdSuffix(webhookId) {
  return webhookId.split('/').pop();
}

function isValidResponse(response, path) {
  if (!response) return false;

  const parts = path.split('.');
  let current = response;

  for (const part of parts) {
    if (!current[part]) return false;
    current = current[part];
  }

  return true;
}

function isWebhookForJob(webhook, graphqlTopic, jobPath) {
  if (webhook.topic !== graphqlTopic) return false;
  if (!webhook.endpoint || webhook.endpoint.__typename !== 'WebhookHttpEndpoint') return false;

  try {
    const url = new URL(webhook.endpoint.callbackUrl);
    return url.searchParams.get('job') === jobPath;
  } catch (e) {
    return false;
  }
}

function isWebhookForTopicButNotJob(webhook, graphqlTopic, jobPath) {
  if (webhook.topic !== graphqlTopic) return false;

  if (webhook.endpoint && webhook.endpoint.__typename === 'WebhookHttpEndpoint') {
    try {
      const url = new URL(webhook.endpoint.callbackUrl);
      return url.searchParams.get('job') !== jobPath;
    } catch (e) {
      return true;
    }
  }

  return true;
}

function findMatchingWebhooks(webhooks, graphqlTopic, webhookAddress) {
  return webhooks.filter(webhook =>
    webhook.topic === graphqlTopic &&
    webhook.endpoint?.__typename === 'WebhookHttpEndpoint' &&
    webhook.endpoint.callbackUrl === webhookAddress
  );
}

function doFieldConfigsDiffer(configFields, activeFields) {
  if (!configFields || !activeFields) return false;

  const configSet = new Set(configFields);
  const activeSet = new Set(activeFields);

  return configSet.size !== activeSet.size ||
         ![...configSet].every(field => activeSet.has(field));
}

// ===================================================================
// Job Display Information
// ===================================================================

/**
 * Get display information for a job's webhook status
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} jobPath - The job path relative to jobs/
 * @returns {Promise<Object>} Object with job status display information
 */
export async function getJobDisplayInfo(cliDirname, jobPath) {
  // Load job configuration
  let jobConfig;
  try {
    jobConfig = loadJobConfig(jobPath);
  } catch (e) {
    return {
      jobPath,
      displayName: jobPath,
      displayTopic: 'CONFIG ERROR',
      statusMsg: '⚠️ ERROR',
      webhookIdSuffix: '-',
      shop: null
    };
  }

  // Set default values
  let displayTopic = jobConfig.trigger || 'N/A';
  let statusMsg = 'Manual'; // Default for jobs without trigger or non-webhook triggers
  let webhookIdSuffix = '-';
  const shop = jobConfig.shop || null;
  let includeFields = null;
  // Use either the job config name or the jobPath for display
  const displayName = jobConfig.name || jobPath;

  // Get includeFields from job config
  if (jobConfig.webhook?.includeFields && Array.isArray(jobConfig.webhook.includeFields)) {
    includeFields = jobConfig.webhook.includeFields;
  }

  if (!jobConfig.trigger) {
    return {
      jobPath,
      displayName,
      displayTopic,
      statusMsg,
      webhookIdSuffix,
      shop,
      includeFields
    };
  }

  // Load trigger configuration
  let triggerConfig;
  try {
    triggerConfig = loadTriggerConfig(jobConfig.trigger);
  } catch(e) {
    return {
      jobPath,
      displayName,
      displayTopic: jobConfig.trigger,
      statusMsg: '⚠️ TRIGGER CONFIG ERROR',
      webhookIdSuffix: '-',
      shop
    };
  }

  displayTopic = triggerConfig.webhook?.topic || jobConfig.trigger;

  // If no webhook topic in trigger, return early
  if (!triggerConfig.webhook?.topic) {
    return {
      jobPath,
      displayName,
      displayTopic,
      statusMsg,
      webhookIdSuffix,
      shop,
      includeFields
    };
  }

  // Check webhook status
  const graphqlTopic = convertToGraphqlTopic(triggerConfig.webhook.topic);
  try {
    const shopifyForJob = initShopify(cliDirname, jobPath);
    const response = await shopifyForJob.graphql(GET_WEBHOOKS_QUERY, { first: 100 });

    if (!isValidResponse(response, 'webhookSubscriptions.nodes')) {
      console.warn(`Warning: Could not retrieve webhooks for job ${displayName} (Shop: ${chalk.blue(jobConfig.shop)}). Response format unexpected.`);
      statusMsg = '⚠️ NO DATA';
    } else {
      const shopWebhooks = response.webhookSubscriptions.nodes;
      const jobWebhook = shopWebhooks.find(webhook => isWebhookForJob(webhook, graphqlTopic, jobPath));

      if (jobWebhook) {
        statusMsg = 'Enabled';
        webhookIdSuffix = getWebhookIdSuffix(jobWebhook.id);
      } else {
        statusMsg = 'Disabled';
      }
    }
  } catch (error) {
    console.warn(`Warning: Error fetching webhook status for job ${displayName} (Shop: ${chalk.blue(jobConfig.shop)}): ${error.message}`);
    statusMsg = '⚠️ API ERROR';
    webhookIdSuffix = 'ERR';
  }

  return {
    jobPath,
    displayName,
    displayTopic,
    statusMsg,
    webhookIdSuffix,
    shop,
    includeFields
  };
}

// ===================================================================
// Status Display Functions
// ===================================================================

/**
 * Check and display status for all jobs
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {boolean} filterByCurrentDir - Whether to filter jobs by current directory
 */
export async function handleAllJobsStatus(cliDirname, filterByCurrentDir = false) {
  // Get all available job directories
  const jobDirs = getAvailableJobDirs(cliDirname);
  if (jobDirs.length === 0) {
    console.log('No jobs found in the jobs/ directory.');
    return;
  }

  // Determine if we should filter based on current directory
  let currentDirPrefix = null;
  let filteredJobDirs = jobDirs;

  if (filterByCurrentDir) {
    // Use INIT_CWD from npm or current directory
    const currentDir = process.env.INIT_CWD || process.cwd();
    const jobsDir = path.join(cliDirname, 'jobs');
    const relPath = path.relative(jobsDir, currentDir);

    // Only filter if we're in a subdirectory of jobs/ and not in jobs/ itself
    if (!relPath.startsWith('..') && relPath !== '') {
      // Get the first segment of the path to determine parent directory (e.g., "order")
      const firstSegment = relPath.split(path.sep)[0];

      // If current directory is a job directory parent (like jobs/order/),
      // filter to only show jobs under that parent directory
      filteredJobDirs = jobDirs.filter(jobPath =>
        jobPath === firstSegment ||
        jobPath.startsWith(`${firstSegment}${path.sep}`)
      );

      if (filteredJobDirs.length > 0) {
        console.log(`Checking status for jobs in the '${firstSegment}' directory...`);
      } else {
        console.log(`No jobs found in the '${firstSegment}' directory.`);
        return;
      }
    } else {
      console.log('Checking status for all jobs in the project...');
    }
  } else {
    console.log('Checking status for all jobs in the project...');
  }

  // Prepare table header
  const totalWidth = Object.values(COLUMN_WIDTHS).reduce((sum, width) => sum + width, 0) + 5; // 5 spaces between columns
  console.log('\nJOB STATUS SUMMARY\n' + '-'.repeat(totalWidth));
  console.log(
    cropAndPad('STATUS', COLUMN_WIDTHS.status),
    cropAndPad('PATH', COLUMN_WIDTHS.path),
    cropAndPad('SHOP', COLUMN_WIDTHS.shop),
    cropAndPad('JOB', COLUMN_WIDTHS.job),
    cropAndPad('TOPIC', COLUMN_WIDTHS.topic)
  );
  console.log(
    ''.padEnd(COLUMN_WIDTHS.status, '-'),
    ''.padEnd(COLUMN_WIDTHS.path, '-'),
    ''.padEnd(COLUMN_WIDTHS.shop, '-'),
    ''.padEnd(COLUMN_WIDTHS.job, '-'),
    ''.padEnd(COLUMN_WIDTHS.topic, '-')
  );

  // Collect all job display info
  const jobDisplayInfos = await getAllJobDisplayInfo(cliDirname, filteredJobDirs);

  // Sort jobs by status priority then alphabetically
  const sortedJobDisplayInfos = sortJobDisplayInfos(jobDisplayInfos);

  // Display the sorted job information - we'll print our own header above, so don't need the one in displayJobsTable
  displayJobsTable(sortedJobDisplayInfos, false);

  console.log('-'.repeat(totalWidth));
  console.log('\nUse "shopworker enable <jobName>" to enable a job with a webhook.');
  console.log('Use "shopworker status <jobName>" to see detailed webhook information for a specific job.');
}

async function getAllJobDisplayInfo(cliDirname, jobDirs) {
  const jobDisplayInfos = [];

  for (const currentJobName of jobDirs) {
    try {
      const jobInfo = await getJobDisplayInfo(cliDirname, currentJobName);
      jobDisplayInfos.push(jobInfo);
    } catch (error) {
      console.error(`Error processing job ${currentJobName}: ${error.message}`);
      jobDisplayInfos.push({
        jobPath: currentJobName,
        displayName: currentJobName,
        displayTopic: 'ERROR',
        statusMsg: '⚠️ ERROR',
        webhookIdSuffix: '-',
        shop: null
      });
    }
  }

  return jobDisplayInfos;
}

function sortJobDisplayInfos(jobDisplayInfos) {
  return [...jobDisplayInfos].sort((a, b) => {
    // Define status priority (lower number = higher priority)
    const getStatusPriority = (status) => {
      if (status === 'Enabled') return 1;
      if (status === 'Manual') return 2;
      if (status === 'Disabled') return 3;
      return 4; // Error or other statuses
    };

    const aPriority = getStatusPriority(a.statusMsg);
    const bPriority = getStatusPriority(b.statusMsg);

    // First sort by status priority
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }
    // Then sort alphabetically by path
    return a.jobPath.localeCompare(b.jobPath);
  });
}

/**
 * Display a simple status entry for a job
 * @param {Array} jobDisplayInfos - Array of job info objects to display
 * @param {boolean} [printHeader=true] - Whether to print the table header
 */
function displayJobsTable(jobDisplayInfos, printHeader = true) {
  // Print headers if requested
  if (printHeader) {
    console.log();
    console.log(
      cropAndPad('STATUS', COLUMN_WIDTHS.status),
      cropAndPad('PATH', COLUMN_WIDTHS.path),
      cropAndPad('SHOP', COLUMN_WIDTHS.shop),
      cropAndPad('JOB', COLUMN_WIDTHS.job),
      cropAndPad('TOPIC', COLUMN_WIDTHS.topic)
    );

    console.log(
      ''.padEnd(COLUMN_WIDTHS.status, '-'),
      ''.padEnd(COLUMN_WIDTHS.path, '-'),
      ''.padEnd(COLUMN_WIDTHS.shop, '-'),
      ''.padEnd(COLUMN_WIDTHS.job, '-'),
      ''.padEnd(COLUMN_WIDTHS.topic, '-')
    );
  }

  // Print job status rows
  for (const info of jobDisplayInfos) {
    const disabled = info.statusMsg === 'Disabled';

    console.log(
      formatStatusColumn(info.statusMsg, disabled),
      applyColorIfDisabled(cropAndPad(info.jobPath, COLUMN_WIDTHS.path), disabled),
      formatShopColumn(info.shop, disabled),
      applyColorIfDisabled(cropAndPad(info.displayName, COLUMN_WIDTHS.job), disabled),
      applyColorIfDisabled(cropAndPad(info.displayTopic, COLUMN_WIDTHS.topic), disabled)
    );
  }
  console.log();
}

/**
 * Check and display status for a specific job
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} jobPath - The job path relative to jobs/
 */
export async function handleSingleJobStatus(cliDirname, jobPath) {
  // Load job configuration
  let jobConfig;
  try {
    jobConfig = loadJobConfig(jobPath);
  } catch (e) {
    console.error(`Error loading configuration for job ${jobPath}: ${e.message}`);
    return;
  }

  // Handle job with no trigger
  if (!jobConfig.trigger) {
    console.log(`Job ${jobPath} is configured for manual trigger (no trigger defined in config).`);
    console.log(`${jobPath.padEnd(40)} ${'N/A'.padEnd(30)} ${'✅ MANUAL'.padEnd(13)} -`);
    return;
  }

  // Load trigger configuration
  let triggerConfig;
  try {
    triggerConfig = loadTriggerConfig(jobConfig.trigger);
  } catch(e) {
    console.error(`Error loading trigger configuration '${jobConfig.trigger}' for job ${jobPath}: ${e.message}`);
    return;
  }

  // Handle non-webhook trigger
  if (!triggerConfig.webhook?.topic) {
    console.log(`Job ${jobPath} (trigger: '${jobConfig.trigger}') is not a webhook trigger (no webhook topic defined).`);
    console.log(`${jobPath.padEnd(40)} ${(jobConfig.trigger).padEnd(30)} ${'✅ MANUAL'.padEnd(13)} -`);
    return;
  }

  // Display basic info
  console.log(`Checking webhooks for job: ${jobPath} (Shop: ${chalk.blue(jobConfig.shop)})`);
  console.log(`Shopify Topic: ${triggerConfig.webhook.topic}`);

  // Show include fields from configurations
  displayIncludeFieldsInfo(jobConfig, triggerConfig);

  try {
    await displayDetailedWebhookStatus(cliDirname, jobPath, jobConfig, triggerConfig);
  } catch (error) {
    console.error(`Error checking webhook status for job '${jobPath}': ${error.message}`);
  }
}

function displayIncludeFieldsInfo(jobConfig, triggerConfig) {
  // Show job-specific webhook configuration if it exists
  if (jobConfig.webhook?.includeFields && Array.isArray(jobConfig.webhook.includeFields)) {
    console.log(`Job Config Include Fields: ${jobConfig.webhook.includeFields.join(', ')}`);
  }

  // Show trigger-specific webhook configuration if different from job config
  if (triggerConfig.webhook?.includeFields && Array.isArray(triggerConfig.webhook.includeFields)) {
    if (!jobConfig.webhook?.includeFields) {
      console.log(`Trigger Config Include Fields: ${triggerConfig.webhook.includeFields.join(', ')}`);
    }
  }
}

async function displayDetailedWebhookStatus(cliDirname, jobPath, jobConfig, triggerConfig) {
  const shopify = initShopify(cliDirname, jobPath);
  const response = await shopify.graphql(GET_WEBHOOKS_QUERY, { first: 100 });

  if (!isValidResponse(response, 'webhookSubscriptions.nodes')) {
    console.error('Unexpected response format from Shopify GraphQL API when fetching webhooks.');
    console.log('Response structure:', JSON.stringify(response, null, 2));
    return;
  }

  const webhooks = response.webhookSubscriptions.nodes;
  const graphqlTopic = convertToGraphqlTopic(triggerConfig.webhook.topic);

  // Find webhooks for this job and topic
  const matchingWebhooksForJobAndTopic = webhooks.filter(
    webhook => isWebhookForJob(webhook, graphqlTopic, jobPath)
  );

  // Find other webhooks for the same topic but not this job
  const otherWebhooksForTopic = webhooks.filter(
    webhook => isWebhookForTopicButNotJob(webhook, graphqlTopic, jobPath)
  );

  // Display matching webhooks
  if (matchingWebhooksForJobAndTopic.length > 0) {
    console.log(`\n🟢 Job '${jobPath}' is ENABLED for topic '${triggerConfig.webhook.topic}'.`);
    matchingWebhooksForJobAndTopic.forEach(webhook => displayWebhookDetails(webhook, jobConfig));
  } else {
    console.log(`\n🔴 Job '${jobPath}' is DISABLED for topic '${triggerConfig.webhook.topic}'.`);
    console.log(`   No active webhook found specifically for this job and topic on its configured shop.`);
  }

  // Display other webhooks for the same topic
  if (otherWebhooksForTopic.length > 0) {
    console.log(`\nℹ️  Note: Found ${otherWebhooksForTopic.length} other webhook(s) for topic '${triggerConfig.webhook.topic}' on the same shop:`);
    otherWebhooksForTopic.forEach(webhook => {
      console.log(`  - ID: ${webhook.id}, URL: ${webhook.endpoint?.callbackUrl || 'N/A'}`);
    });
  }
}

function displayWebhookDetails(webhook, jobConfig) {
  console.log(`  Webhook ID: ${webhook.id}`);
  console.log(`  Callback URL: ${webhook.endpoint.callbackUrl}`);
  console.log(`  Created At: ${webhook.createdAt}`);

  if (webhook.includeFields?.length > 0) {
    console.log(`  Active Include Fields: ${webhook.includeFields.join(', ')}`);

    // Check if active fields differ from configuration
    if (jobConfig.webhook?.includeFields &&
        doFieldConfigsDiffer(jobConfig.webhook.includeFields, webhook.includeFields)) {
      console.log(`  Note: Active fields differ from job configuration. Update webhook to apply current config.`);
    }
  }
}

// ===================================================================
// Webhook Management Functions
// ===================================================================

/**
 * Enable a job by creating a webhook
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} jobPath - The job path relative to jobs/
 * @param {string} workerUrl - The Cloudflare worker URL
 */
export async function enableJobWebhook(cliDirname, jobPath, workerUrl) {
  // Validate configs
  const configs = loadAndValidateWebhookConfigs(cliDirname, jobPath);
  if (!configs) return false;

  const { jobConfig, triggerConfig } = configs;
  const displayName = jobConfig.name || jobPath;

  console.log(`Enabling webhook for job: ${chalk.yellow(displayName)}`);
  console.log(`Shop: ${chalk.blue(jobConfig.shop)}`);
  console.log(`Webhook topic: ${chalk.cyan(triggerConfig.webhook.topic)}`);
  console.log(`Worker URL: ${chalk.cyan(workerUrl)}`);

  // Convert webhook topic to GraphQL format
  const graphqlTopic = convertToGraphqlTopic(triggerConfig.webhook.topic);

  try {
    // Initialize Shopify client for this job
    const shopify = initShopify(cliDirname, jobPath);

    // Construct the full webhook URL with the job name as a query parameter
    const webhookAddress = createWebhookUrl(workerUrl, jobPath);
    console.log(`Webhook address: ${chalk.cyan(webhookAddress)}`);

    // Get existing webhooks
    const webhookResponse = await shopify.graphql(GET_WEBHOOKS_QUERY, { first: 100 });
    if (!webhookResponse.webhookSubscriptions || !webhookResponse.webhookSubscriptions.nodes) {
      console.error('Error fetching webhooks: Unexpected response format');
      return false;
    }

    // Check if a matching webhook already exists
    const webhooks = webhookResponse.webhookSubscriptions.nodes;
    const matchingWebhooks = findMatchingWebhooks(webhooks, graphqlTopic, webhookAddress);

    if (matchingWebhooks.length > 0) {
      const webhook = matchingWebhooks[0];
      console.log(`Webhook already exists with ID: ${chalk.green(getWebhookIdSuffix(webhook.id))}`);

      // Check if includeFields configuration has changed
      if (jobConfig.webhook?.includeFields) {
        const configFields = jobConfig.webhook.includeFields;
        const activeFields = webhook.includeFields;

        if (doFieldConfigsDiffer(configFields, activeFields)) {
          console.log(chalk.yellow('Webhook includeFields have changed. Recreating webhook...'));
          await deleteMatchingWebhooks(shopify, matchingWebhooks);
          const webhookSubscription = prepareWebhookSubscription(webhookAddress, jobConfig);
          await createWebhook(shopify, graphqlTopic, webhookSubscription);
        }
      }
    } else {
      // No matching webhook exists, create a new one
      const webhookSubscription = prepareWebhookSubscription(webhookAddress, jobConfig);
      await createWebhook(shopify, graphqlTopic, webhookSubscription);
    }

    console.log(chalk.green('✔ Webhook enabled successfully'));
    return true;
  } catch (error) {
    console.error(`Error enabling webhook: ${error.message}`);
    if (error.response) {
      console.error('API Error details:', error.response);
    }
    return false;
  }
}

function prepareWebhookSubscription(webhookAddress, jobConfig) {
  const webhookSubscription = {
    callbackUrl: webhookAddress,
    format: "JSON"
  };

  // Only use includeFields from job config
  if (jobConfig.webhook?.includeFields && Array.isArray(jobConfig.webhook.includeFields)) {
    webhookSubscription.includeFields = jobConfig.webhook.includeFields;
    console.log(`Include Fields (from job config):`);
    jobConfig.webhook.includeFields.forEach(field => {
      console.log(`  - ${field}`);
    });
  }

  return webhookSubscription;
}

async function createWebhook(shopify, topic, webhookSubscription) {
  const variables = {
    topic: topic,
    webhookSubscription: webhookSubscription
  };

  return await shopify.graphql(WEBHOOK_CREATE_MUTATION, variables);
}

/**
 * Disable a job by removing its webhook
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} jobPath - The job path relative to jobs/
 * @param {string} workerUrl - The Cloudflare worker URL
 */
export async function disableJobWebhook(cliDirname, jobPath, workerUrl) {
  // Validate configs
  const configs = loadAndValidateWebhookConfigs(cliDirname, jobPath);
  if (!configs) return false;

  const { jobConfig, triggerConfig } = configs;
  const displayName = jobConfig.name || jobPath;

  console.log(`Disabling webhook for job: ${chalk.yellow(displayName)}`);
  console.log(`Shop: ${chalk.blue(jobConfig.shop)}`);
  console.log(`Webhook topic: ${chalk.cyan(triggerConfig.webhook.topic)}`);
  console.log(`Worker URL: ${chalk.cyan(workerUrl)}`);

  // Convert webhook topic to GraphQL format
  const graphqlTopic = convertToGraphqlTopic(triggerConfig.webhook.topic);

  try {
    // Initialize Shopify client for this job
    const shopify = initShopify(cliDirname, jobPath);

    // Construct the full webhook URL with the job name as a query parameter
    const webhookAddress = createWebhookUrl(workerUrl, jobPath);
    console.log(`Webhook address: ${chalk.cyan(webhookAddress)}`);

    // Get existing webhooks
    const webhookResponse = await shopify.graphql(GET_WEBHOOKS_QUERY, { first: 100 });
    if (!webhookResponse.webhookSubscriptions || !webhookResponse.webhookSubscriptions.nodes) {
      console.error('Error fetching webhooks: Unexpected response format');
      return false;
    }

    // Find matching webhooks
    const webhooks = webhookResponse.webhookSubscriptions.nodes;
    const matchingWebhooks = findMatchingWebhooks(webhooks, graphqlTopic, webhookAddress);

    if (matchingWebhooks.length === 0) {
      console.log(chalk.yellow('No matching webhooks found. Nothing to disable.'));
      return true;
    }

    // Delete all matching webhooks
    const deletionSuccess = await deleteMatchingWebhooks(shopify, matchingWebhooks);
    if (deletionSuccess) {
      console.log(chalk.green(`✔ ${matchingWebhooks.length} webhook(s) disabled successfully`));
      return true;
    } else {
      console.error('Failed to disable one or more webhooks');
      return false;
    }
  } catch (error) {
    console.error(`Error disabling webhook: ${error.message}`);
    if (error.response) {
      console.error('API Error details:', error.response);
    }
    return false;
  }
}

async function deleteMatchingWebhooks(shopify, webhooks) {
  let successCount = 0;

  for (const webhook of webhooks) {
    console.log(`Deleting webhook ID: ${webhook.id}...`);
    const result = await deleteWebhook(shopify, webhook.id);

    if (result) {
      console.log(`Successfully deleted webhook with ID: ${webhook.id}`);
      successCount++;
    }
  }

  return { successCount };
}

async function deleteWebhook(shopify, webhookId) {
  const deleteResponse = await shopify.graphql(WEBHOOK_DELETE_MUTATION, { id: webhookId });

  if (deleteResponse?.webhookSubscriptionDelete?.userErrors?.length > 0) {
    const errors = deleteResponse.webhookSubscriptionDelete.userErrors.map(err => err.message).join(", ");
    console.error(`Error deleting webhook ${webhookId}: ${errors}`);
    return false;
  } else if (deleteResponse?.webhookSubscriptionDelete?.deletedWebhookSubscriptionId) {
    return true;
  } else {
    console.error(`Error deleting webhook ${webhookId}: Unexpected response format.`);
    console.log(JSON.stringify(deleteResponse, null, 2));
    return false;
  }
}

/**
 * Delete a webhook by its ID
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} jobPath - The job path relative to jobs/
 * @param {string} webhookId - The ID of the webhook to delete
 */
export async function deleteWebhookById(cliDirname, jobPath, webhookId) {
  try {
    // Initialize Shopify client for this job
    const shopify = initShopify(cliDirname, jobPath);

    // Format the webhook ID properly if needed
    const fullWebhookId = getFullWebhookId(webhookId);

    // Delete the webhook
    const response = await deleteWebhook(shopify, fullWebhookId);

    // Check if deletion was successful
    if (response && response.webhookSubscriptionDelete) {
      if (response.webhookSubscriptionDelete.userErrors &&
          response.webhookSubscriptionDelete.userErrors.length > 0) {
        console.error('Error deleting webhook:');
        response.webhookSubscriptionDelete.userErrors.forEach(error => {
          console.error(`- ${error.message}`);
        });
        return false;
      }

      console.log(chalk.green(`✔ Webhook ${webhookId} deleted successfully`));
      return true;
    }

    console.error('Failed to delete webhook, unexpected response format');
    return false;
  } catch (error) {
    console.error(`Error deleting webhook: ${error.message}`);
    if (error.response) {
      console.error('API Error details:', error.response);
    }
    return false;
  }
}
