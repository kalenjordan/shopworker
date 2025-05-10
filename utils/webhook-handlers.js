import { loadJobConfig, loadTriggerConfig } from './job-loader.js';
import { initShopify } from './shopify-api-helpers.js';
import { getAvailableJobDirs, loadAndValidateWebhookConfigs } from './common-helpers.js';
import WEBHOOK_CREATE_MUTATION from '../graphql/webhookSubscriptionCreate.js';
import WEBHOOK_DELETE_MUTATION from '../graphql/webhookSubscriptionDelete.js';
import GET_WEBHOOKS_QUERY from '../graphql/getWebhooks.js';
import chalk from 'chalk';

// ===================================================================
// Display Formatting Utilities
// ===================================================================

const COLUMN_WIDTHS = {
  status: 13,
  shop: 18,
  job: 35,
  topic: 20,
  webhookId: 15
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
  return isDisabled ? chalk.gray(paddedShop) : chalk.blue(paddedShop);
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

function createWebhookUrl(baseUrl, jobName) {
  const webhookUrl = new URL(baseUrl);
  webhookUrl.searchParams.set('job', jobName);
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

function isWebhookForJob(webhook, graphqlTopic, jobName) {
  if (webhook.topic !== graphqlTopic) return false;
  if (!webhook.endpoint || webhook.endpoint.__typename !== 'WebhookHttpEndpoint') return false;

  try {
    const url = new URL(webhook.endpoint.callbackUrl);
    return url.searchParams.get('job') === jobName;
  } catch (e) {
    return false;
  }
}

function isWebhookForTopicButNotJob(webhook, graphqlTopic, jobName) {
  if (webhook.topic !== graphqlTopic) return false;

  if (webhook.endpoint && webhook.endpoint.__typename === 'WebhookHttpEndpoint') {
    try {
      const url = new URL(webhook.endpoint.callbackUrl);
      return url.searchParams.get('job') !== jobName;
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
 * @param {string} currentJobName - The job name
 * @returns {Promise<Object>} Object with job status display information
 */
export async function getJobDisplayInfo(cliDirname, currentJobName) {
  // Load job configuration
  let jobConfig;
  try {
    jobConfig = loadJobConfig(currentJobName);
  } catch (e) {
    return {
      jobName: currentJobName,
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

  // Get includeFields from job config
  if (jobConfig.webhook?.includeFields && Array.isArray(jobConfig.webhook.includeFields)) {
    includeFields = jobConfig.webhook.includeFields;
  }

  if (!jobConfig.trigger) {
    return {
      jobName: currentJobName,
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
      jobName: currentJobName,
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
      jobName: currentJobName,
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
    const shopifyForJob = initShopify(cliDirname, currentJobName);
    const response = await shopifyForJob.graphql(GET_WEBHOOKS_QUERY, { first: 100 });

    if (!isValidResponse(response, 'webhookSubscriptions.nodes')) {
      console.warn(`Warning: Could not retrieve webhooks for job ${currentJobName} (Shop: ${chalk.blue(jobConfig.shop)}). Response format unexpected.`);
      statusMsg = '⚠️ NO DATA';
    } else {
      const shopWebhooks = response.webhookSubscriptions.nodes;
      const jobWebhook = shopWebhooks.find(webhook => isWebhookForJob(webhook, graphqlTopic, currentJobName));

      if (jobWebhook) {
        statusMsg = 'Enabled';
        webhookIdSuffix = getWebhookIdSuffix(jobWebhook.id);
      } else {
        statusMsg = 'Disabled';
      }
    }
  } catch (error) {
    console.warn(`Warning: Error fetching webhook status for job ${currentJobName} (Shop: ${chalk.blue(jobConfig.shop)}): ${error.message}`);
    statusMsg = '⚠️ API ERROR';
    webhookIdSuffix = 'ERR';
  }

  return {
    jobName: currentJobName,
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
 */
export async function handleAllJobsStatus(cliDirname) {
  console.log('Checking status for all jobs in the project...');
  const jobDirs = getAvailableJobDirs(cliDirname);

  if (jobDirs.length === 0) {
    console.log('No jobs found in the jobs/ directory.');
    return;
  }

  // Prepare table header
  const totalWidth = Object.values(COLUMN_WIDTHS).reduce((sum, width) => sum + width, 0) + 5; // 5 spaces between columns
  console.log('\nJOB STATUS SUMMARY\n' + '-'.repeat(totalWidth));
  console.log(
    cropAndPad('STATUS', COLUMN_WIDTHS.status) + ' ' +
    cropAndPad('SHOP', COLUMN_WIDTHS.shop) + ' ' +
    cropAndPad('JOB', COLUMN_WIDTHS.job) + ' ' +
    cropAndPad('TRIGGER/TOPIC', COLUMN_WIDTHS.topic) + ' ' +
    cropAndPad('WEBHOOK ID', COLUMN_WIDTHS.webhookId)
  );
  console.log('-'.repeat(totalWidth));

  // Collect all job display info
  const jobDisplayInfos = await getAllJobDisplayInfo(cliDirname, jobDirs);

  // Sort jobs by status priority then alphabetically
  const sortedJobDisplayInfos = sortJobDisplayInfos(jobDisplayInfos);

  // Display the sorted job information
  displayJobsTable(sortedJobDisplayInfos);

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
        jobName: currentJobName,
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
    // Then sort alphabetically by job name
    return a.jobName.localeCompare(b.jobName);
  });
}

function displayJobsTable(jobDisplayInfos) {
  for (const { jobName, displayTopic, statusMsg, webhookIdSuffix, shop } of jobDisplayInfos) {
    const isDisabled = statusMsg === 'Disabled';

    const statusDisplay = formatStatusColumn(statusMsg);
    const shopDisplay = formatShopColumn(shop, isDisabled);

    // Prepare display columns
    const jobDisplay = cropAndPad(jobName, COLUMN_WIDTHS.job);
    const topicDisplay = cropAndPad(displayTopic, COLUMN_WIDTHS.topic);
    const webhookIdDisplay = cropAndPad(webhookIdSuffix, COLUMN_WIDTHS.webhookId);

    // Apply color to columns if the job is disabled
    const coloredJobDisplay = applyColorIfDisabled(jobDisplay, isDisabled);
    const coloredTopicDisplay = applyColorIfDisabled(topicDisplay, isDisabled);
    const coloredWebhookIdDisplay = applyColorIfDisabled(webhookIdDisplay, isDisabled);

    console.log(
      statusDisplay + ' ' +
      shopDisplay + ' ' +
      coloredJobDisplay + ' ' +
      coloredTopicDisplay + ' ' +
      coloredWebhookIdDisplay
    );
  }
}

/**
 * Check and display status for a specific job
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} jobName - The job name
 */
export async function handleSingleJobStatus(cliDirname, jobName) {
  // Load job configuration
  let jobConfig;
  try {
    jobConfig = loadJobConfig(jobName);
  } catch (e) {
    console.error(`Error loading configuration for job ${jobName}: ${e.message}`);
    return;
  }

  // Handle job with no trigger
  if (!jobConfig.trigger) {
    console.log(`Job ${jobName} is configured for manual trigger (no trigger defined in config).`);
    console.log(`${jobName.padEnd(40)} ${'N/A'.padEnd(30)} ${'✅ MANUAL'.padEnd(13)} -`);
    return;
  }

  // Load trigger configuration
  let triggerConfig;
  try {
    triggerConfig = loadTriggerConfig(jobConfig.trigger);
  } catch(e) {
    console.error(`Error loading trigger configuration '${jobConfig.trigger}' for job ${jobName}: ${e.message}`);
    return;
  }

  // Handle non-webhook trigger
  if (!triggerConfig.webhook?.topic) {
    console.log(`Job ${jobName} (trigger: '${jobConfig.trigger}') is not a webhook trigger (no webhook topic defined).`);
    console.log(`${jobName.padEnd(40)} ${(jobConfig.trigger).padEnd(30)} ${'✅ MANUAL'.padEnd(13)} -`);
    return;
  }

  // Display basic info
  console.log(`Checking webhooks for job: ${jobName} (Shop: ${chalk.blue(jobConfig.shop)})`);
  console.log(`Shopify Topic: ${triggerConfig.webhook.topic}`);

  // Show include fields from configurations
  displayIncludeFieldsInfo(jobConfig, triggerConfig);

  try {
    await displayDetailedWebhookStatus(cliDirname, jobName, jobConfig, triggerConfig);
  } catch (error) {
    console.error(`Error checking webhook status for job '${jobName}': ${error.message}`);
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

async function displayDetailedWebhookStatus(cliDirname, jobName, jobConfig, triggerConfig) {
  const shopify = initShopify(cliDirname, jobName);
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
    webhook => isWebhookForJob(webhook, graphqlTopic, jobName)
  );

  // Find other webhooks for the same topic but not this job
  const otherWebhooksForTopic = webhooks.filter(
    webhook => isWebhookForTopicButNotJob(webhook, graphqlTopic, jobName)
  );

  // Display matching webhooks
  if (matchingWebhooksForJobAndTopic.length > 0) {
    console.log(`\n🟢 Job '${jobName}' is ENABLED for topic '${triggerConfig.webhook.topic}'.`);
    matchingWebhooksForJobAndTopic.forEach(webhook => displayWebhookDetails(webhook, jobConfig));
  } else {
    console.log(`\n🔴 Job '${jobName}' is DISABLED for topic '${triggerConfig.webhook.topic}'.`);
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
 * @param {string} jobName - The job name
 * @param {string} workerUrl - The Cloudflare worker URL
 */
export async function enableJobWebhook(cliDirname, jobName, workerUrl) {
  const configs = loadAndValidateWebhookConfigs(cliDirname, jobName);
  if (!configs) return;
  const { jobConfig, triggerConfig } = configs;

  try {
    const shopify = initShopify(cliDirname, jobName);
    const webhookAddress = createWebhookUrl(workerUrl, jobName);

    // Log configuration details
    console.log(`Registering webhook for job: ${jobName} (Shop: ${chalk.blue(configs.jobConfig.shop)})`);
    console.log(`Topic: ${triggerConfig.webhook.topic}`);
    console.log(`Worker URL: ${webhookAddress}`);

    // Prepare webhook subscription data
    const graphqlTopic = convertToGraphqlTopic(triggerConfig.webhook.topic);
    const webhookSubscription = prepareWebhookSubscription(webhookAddress, jobConfig);

    // Create the webhook
    const response = await createWebhook(shopify, graphqlTopic, webhookSubscription);

    if (!isValidResponse(response, 'webhookSubscriptionCreate')) {
      console.error('Unexpected response format from Shopify GraphQL API during webhook creation.');
      console.log('Response structure:', JSON.stringify(response, null, 2));
      return;
    }

    if (response.webhookSubscriptionCreate.userErrors?.length > 0) {
      const errors = response.webhookSubscriptionCreate.userErrors.map(err => err.message).join(", ");
      throw new Error(`Failed to create webhook: ${errors}`);
    }

    // Display success message
    const webhook = response.webhookSubscriptionCreate.webhookSubscription;
    console.log(`Successfully registered webhook with ID: ${webhook.id}`);

    if (webhook.includeFields?.length > 0) {
      console.log(`Webhook will only include these fields: ${webhook.includeFields.join(', ')}`);
    }

    console.log('Job enabled successfully!');
  } catch (error) {
    console.error(`Error enabling job '${jobName}': ${error.message}`);
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
 * @param {string} jobName - The job name
 * @param {string} workerUrl - The Cloudflare worker URL
 */
export async function disableJobWebhook(cliDirname, jobName, workerUrl) {
  const configs = loadAndValidateWebhookConfigs(cliDirname, jobName);
  if (!configs) return;
  const { triggerConfig } = configs;

  try {
    const shopify = initShopify(cliDirname, jobName);
    const webhookAddress = createWebhookUrl(workerUrl, jobName);
    const graphqlTopic = convertToGraphqlTopic(triggerConfig.webhook.topic);

    // Log operation details
    console.log(`Disabling webhook for job: ${jobName} (Shop: ${chalk.blue(configs.jobConfig.shop)})`);
    console.log(`Topic: ${triggerConfig.webhook.topic}`);
    console.log(`Worker URL (match criteria): ${webhookAddress}`);

    // Get all webhooks
    const getResponse = await shopify.graphql(GET_WEBHOOKS_QUERY, { first: 100 });
    if (!isValidResponse(getResponse, 'webhookSubscriptions.nodes')) {
      console.error('Unexpected response format from Shopify GraphQL API when fetching webhooks for deletion.');
      console.log('Response structure:', JSON.stringify(getResponse, null, 2));
      return;
    }

    // Find matching webhooks to delete
    const matchingWebhooks = findMatchingWebhooks(
      getResponse.webhookSubscriptions.nodes,
      graphqlTopic,
      webhookAddress
    );

    if (matchingWebhooks.length === 0) {
      console.log('No matching webhooks found to disable for this job.');
      return;
    }

    // Delete each matching webhook
    const result = await deleteMatchingWebhooks(shopify, matchingWebhooks);

    // Display results
    if (result.successCount > 0 && result.successCount === matchingWebhooks.length) {
      console.log('Job disabled successfully!');
    } else if (result.successCount > 0) {
      console.log(`${result.successCount} of ${matchingWebhooks.length} webhooks disabled. Some errors occurred.`);
    } else {
      console.log('Job disable process completed, but no webhooks were successfully deleted.');
    }
  } catch (error) {
    console.error(`Error disabling job '${jobName}': ${error.message}`);
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
 * @param {string} jobName - The job name (for initializing the Shopify client)
 * @param {string} webhookId - The ID of the webhook to delete
 */
export async function deleteWebhookById(cliDirname, jobName, webhookId) {
  try {
    const shopify = initShopify(cliDirname, jobName);
    console.log(`Attempting to delete webhook with ID: ${webhookId}`);

    // Ensure webhook ID is in the correct format
    const fullWebhookId = getFullWebhookId(webhookId);
    if (fullWebhookId !== webhookId) {
      console.log(`Using full webhook ID: ${fullWebhookId}`);
    }

    // Delete the webhook
    const deleteResponse = await shopify.graphql(WEBHOOK_DELETE_MUTATION, { id: fullWebhookId });

    if (deleteResponse?.webhookSubscriptionDelete?.userErrors?.length > 0) {
      const errors = deleteResponse.webhookSubscriptionDelete.userErrors.map(err => err.message).join(", ");
      console.error(`Error deleting webhook ${webhookId}: ${errors}`);
      return false;
    } else if (deleteResponse?.webhookSubscriptionDelete?.deletedWebhookSubscriptionId) {
      console.log(`Successfully deleted webhook with ID: ${webhookId}`);
      return true;
    } else {
      console.error(`Error deleting webhook ${webhookId}: Unexpected response format.`);
      console.log(JSON.stringify(deleteResponse, null, 2));
      return false;
    }
  } catch (error) {
    console.error(`Error deleting webhook '${webhookId}': ${error.message}`);
    return false;
  }
}
