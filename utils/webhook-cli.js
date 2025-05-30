import { loadJobConfig, loadTriggerConfig } from './job-loader.js';
import { initShopify } from './shopify.js';
import { getAvailableJobDirs, loadAndValidateWebhookConfigs } from './cli-helpers.js';
import {
  displayJobsTable,
  sortJobDisplayInfos,
  displayIncludeFieldsInfo,
  displayWebhookDetails,
  displayOrphanedWebhooksWarning
} from './cli-formatting.js';
import WEBHOOK_CREATE_MUTATION from '../graphql/webhookSubscriptionCreate.js';
import WEBHOOK_DELETE_MUTATION from '../graphql/webhookSubscriptionDelete.js';
import GET_WEBHOOKS_QUERY from '../graphql/getWebhooks.js';
import chalk from 'chalk';

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
    const urlJobParam = url.searchParams.get('job');

    // Handle URL encoding differences by comparing the decoded values
    return decodeURIComponent(urlJobParam) === decodeURIComponent(jobPath);
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
  return webhooks.filter(webhook => {
    if (webhook.topic !== graphqlTopic) return false;
    if (!webhook.endpoint || webhook.endpoint.__typename !== 'WebhookHttpEndpoint') return false;

    try {
      // Compare base URLs (domain and path)
      const storedUrl = new URL(webhook.endpoint.callbackUrl);
      const newUrl = new URL(webhookAddress);

      if (storedUrl.origin !== newUrl.origin || storedUrl.pathname !== newUrl.pathname) {
        return false;
      }

      // Compare job parameter specifically
      const storedJobParam = storedUrl.searchParams.get('job');
      const newJobParam = newUrl.searchParams.get('job');

      return decodeURIComponent(storedJobParam) === decodeURIComponent(newJobParam);
    } catch (e) {
      return false;
    }
  });
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

/**
 * Check if a webhook URL contains a job parameter but points to a non-existent job
 * @param {string} webhookUrl - The webhook URL to check
 * @param {Array<string>} validJobPaths - List of valid job paths
 * @returns {boolean} Whether the webhook is orphaned
 */
function isOrphanedWebhook(webhookUrl, validJobPaths) {
  try {
    const url = new URL(webhookUrl);
    const jobPath = url.searchParams.get('job');

    // If there's no job parameter, it's not an orphaned webhook
    if (!jobPath) return false;

    // If the job path exists in our valid job paths, it's not orphaned
    return !validJobPaths.some(validPath =>
      decodeURIComponent(validPath) === decodeURIComponent(jobPath)
    );
  } catch (e) {
    // If we can't parse the URL, it's not considered orphaned
    return false;
  }
}

/**
 * Find orphaned webhooks in a shop
 * @param {Array<Object>} webhooks - List of webhooks from Shopify API
 * @param {Array<string>} jobPaths - List of valid job paths
 * @returns {Array<Object>} List of orphaned webhooks with their details
 */
function findOrphanedWebhooks(webhooks, jobPaths) {
  return webhooks.filter(webhook => {
    if (!webhook.endpoint || webhook.endpoint.__typename !== 'WebhookHttpEndpoint') {
      return false;
    }

    return isOrphanedWebhook(webhook.endpoint.callbackUrl, jobPaths);
  });
}

/**
 * Display status of all jobs' webhooks
 * @param {string} cliDirname - The directory where cli.js is located
 * @param {boolean|string} filterByCurrentDir - Whether to only show jobs in the current directory (boolean)
 *                                           or path to directory to filter by (string)
 */
export async function handleAllJobsStatus(cliDirname, filterByCurrentDir = false) {
  // Convert boolean to directory path if needed
  const currentDir = typeof filterByCurrentDir === 'string' ? filterByCurrentDir :
                      filterByCurrentDir === true ? process.cwd() : null;

  const jobDirs = getAvailableJobDirs(cliDirname, currentDir);

  if (jobDirs.length === 0) {
    if (currentDir) {
      console.log('No jobs found in the current directory.');
    } else {
      console.log('No jobs found.');
    }
    return;
  }

  console.log(chalk.blue(`Fetching webhook status for ${jobDirs.length} jobs...`));

  try {
    const jobInfos = await getAllJobDisplayInfo(cliDirname, jobDirs);
    const sortedJobInfos = sortJobDisplayInfos(jobInfos);
    displayJobsTable(sortedJobInfos);

    // Get all webhooks for all shops to check for orphaned ones
    await checkForOrphanedWebhooks(cliDirname, jobDirs);
  } catch (error) {
    console.error('Error retrieving webhook status:', error);
  }
}

/**
 * Check for orphaned webhooks across all shops
 * @param {string} cliDirname - CLI directory
 * @param {Array<string>} jobDirs - List of all valid job directories
 */
async function checkForOrphanedWebhooks(cliDirname, jobDirs) {
  // Get a list of unique shop names from all jobs
  const shopNames = new Set();

  for (const jobPath of jobDirs) {
    try {
      const jobConfig = loadJobConfig(jobPath);
      if (jobConfig && jobConfig.shop) {
        shopNames.add(jobConfig.shop);
      }
    } catch (e) {
      // Skip jobs with invalid configs
    }
  }

  // For each shop, fetch all webhooks and check for orphaned ones
  for (const shopName of shopNames) {
    // Find any job for this shop to use for API access
    let jobForShop = null;
    for (const jobPath of jobDirs) {
      try {
        const jobConfig = loadJobConfig(jobPath);
        if (jobConfig && jobConfig.shop === shopName) {
          jobForShop = jobPath;
          break;
        }
      } catch (e) {
        // Skip jobs with invalid configs
      }
    }

    if (!jobForShop) continue;

    try {
      const shopify = initShopify(cliDirname, jobForShop);
      const response = await shopify.graphql(GET_WEBHOOKS_QUERY, { first: 100 });

      if (!isValidResponse(response, 'webhookSubscriptions.nodes')) {
        continue;
      }

      const webhooks = response.webhookSubscriptions.nodes;
      const orphanedWebhooks = findOrphanedWebhooks(webhooks, jobDirs);

      if (orphanedWebhooks.length > 0) {
        console.log(chalk.magenta(`\nShop: ${shopName}`));
        displayOrphanedWebhooksWarning(orphanedWebhooks, getWebhookIdSuffix);
      }
    } catch (error) {
      console.warn(`Warning: Error checking orphaned webhooks for shop ${shopName}: ${error.message}`);
    }
  }
}

/**
 * Get display information for all jobs
 * @param {string} cliDirname - CLI directory
 * @param {Array<string>} jobDirs - List of job directories
 * @returns {Promise<Array<Object>>} Array of job display info objects
 */
async function getAllJobDisplayInfo(cliDirname, jobDirs) {
  const jobInfoPromises = jobDirs.map(jobPath =>
    getJobDisplayInfo(cliDirname, jobPath)
      .catch(error => {
        console.error(`Error getting info for ${jobPath}:`, error);
        return {
          jobPath,
          displayName: jobPath,
          displayTopic: 'ERROR',
          statusMsg: '⚠️ ERROR',
          webhookIdSuffix: '-',
          shop: null
        };
      })
  );

  return Promise.all(jobInfoPromises);
}

/**
 * Display detailed webhook status for a single job
 * @param {string} cliDirname - The directory where cli.js is located
 * @param {string} jobPath - The job path relative to jobs/
 */
export async function handleSingleJobStatus(cliDirname, jobPath) {
  try {
    const jobConfig = loadJobConfig(jobPath);
    if (!jobConfig) {
      console.error(`Error: Could not load job configuration for ${jobPath}`);
      return;
    }

    const jobName = jobConfig.name || jobPath;
    console.log(`\nShop: ${chalk.magenta(jobConfig.shop || 'Not specified')}`);
    console.log(`Job: ${chalk.blue(jobName)}`);
    console.log(`Path: ${jobPath}`);

    if (!jobConfig.trigger) {
      console.log(chalk.yellow('\nThis job has no trigger configured.'));
      return;
    }

    console.log(`Trigger: ${jobConfig.trigger}`);

    const triggerConfig = loadTriggerConfig(jobConfig.trigger);
    if (!triggerConfig) {
      console.error(`Error: Could not load trigger configuration for ${jobConfig.trigger}`);
      return;
    }

    if (!triggerConfig.webhook || !triggerConfig.webhook.topic) {
      console.log(chalk.yellow('\nThis trigger does not use webhooks.'));
      return;
    }

    displayIncludeFieldsInfo(jobConfig, triggerConfig);
    await displayDetailedWebhookStatus(cliDirname, jobPath, jobConfig, triggerConfig);
  } catch (error) {
    console.error(`Error retrieving webhook status for ${jobPath}:`, error);
  }
}

/**
 * Display detailed webhook status for a job
 */
async function displayDetailedWebhookStatus(cliDirname, jobPath, jobConfig, triggerConfig) {
  console.log(chalk.bold('\nWebhook Status:'));

  const graphqlTopic = convertToGraphqlTopic(triggerConfig.webhook.topic);

  try {
    const shopifyForJob = initShopify(cliDirname, jobPath);
    const response = await shopifyForJob.graphql(GET_WEBHOOKS_QUERY, { first: 100 });

    if (!isValidResponse(response, 'webhookSubscriptions.nodes')) {
      console.log(chalk.yellow('Could not retrieve webhook information from Shopify. Response format unexpected.'));
      return;
    }

    const shopWebhooks = response.webhookSubscriptions.nodes;
    const jobWebhook = shopWebhooks.find(webhook => isWebhookForJob(webhook, graphqlTopic, jobPath));

    if (jobWebhook) {
      console.log(chalk.green('✓ Webhook is active'));
      displayWebhookDetails(jobWebhook, jobConfig);

      // Check if include fields match config
      if (jobConfig.webhook?.includeFields && jobWebhook.includeFields) {
        if (doFieldConfigsDiffer(jobConfig.webhook.includeFields, jobWebhook.includeFields)) {
          console.log(chalk.yellow('\nWarning: The active webhook fields do not match your configuration.'));
          console.log(chalk.yellow('You may want to disable and re-enable this webhook.'));

          console.log(chalk.bold('\nActive webhook fields:'));
          jobWebhook.includeFields.forEach(field => console.log(`- ${field}`));
        }
      }
    } else {
      console.log(chalk.red('✗ Webhook is not active'));

      // Check if there's another webhook with the same topic
      const conflictingWebhooks = shopWebhooks.filter(webhook =>
        isWebhookForTopicButNotJob(webhook, graphqlTopic, jobPath)
      );

      if (conflictingWebhooks.length > 0) {
        console.log(chalk.yellow(`\nFound ${conflictingWebhooks.length} other webhook(s) with the same topic:`));
        conflictingWebhooks.forEach(webhook => {
          const url = webhook.endpoint?.__typename === 'WebhookHttpEndpoint'
            ? webhook.endpoint.callbackUrl
            : '(not an HTTP endpoint)';
          console.log(`- ID: ${getWebhookIdSuffix(webhook.id)}, URL: ${url}`);
        });
      }
    }
  } catch (error) {
    console.error(`Error fetching webhook status: ${error.message}`);
  }
}

/**
 * Enable a webhook for a job
 * @param {string} cliDirname - The directory where cli.js is located
 * @param {string} jobPath - The job path relative to jobs/
 * @param {string} workerUrl - The worker URL to use for the webhook
 */
export async function enableJobWebhook(cliDirname, jobPath, workerUrl) {
  try {
    // Validate webhook configuration first
    const { jobConfig, triggerConfig } = loadAndValidateWebhookConfigs(cliDirname, jobPath);
    if (!jobConfig || !triggerConfig) return;

    const webhookAddress = createWebhookUrl(workerUrl, jobPath);
    console.log(`Shop: ${chalk.magenta(jobConfig.shop)}`);
    console.log(`Enabling webhook for job: ${chalk.blue(jobConfig.name || jobPath)}`);
    console.log(`Topic: ${triggerConfig.webhook.topic}`);
    console.log(`Endpoint: ${webhookAddress}`);

    // Check if subscription already exists
    const shopify = initShopify(cliDirname, jobPath);
    const response = await shopify.graphql(GET_WEBHOOKS_QUERY, { first: 100 });

    if (!isValidResponse(response, 'webhookSubscriptions.nodes')) {
      throw new Error('Invalid API response when fetching webhooks');
    }

    const webhooks = response.webhookSubscriptions.nodes;
    const graphqlTopic = convertToGraphqlTopic(triggerConfig.webhook.topic);

    // First, check for exact match (same topic, same endpoint)
    const exactMatchWebhooks = findMatchingWebhooks(webhooks, graphqlTopic, webhookAddress);
    if (exactMatchWebhooks.length > 0) {
      console.log(chalk.green('\n✓ Webhook is already enabled for this job with the same endpoint'));
      exactMatchWebhooks.forEach(webhook => {
        console.log(`- ID: ${getWebhookIdSuffix(webhook.id)}`);
        console.log(`  Created: ${new Date(webhook.createdAt).toLocaleString()}`);
      });

      // Check if include fields match configuration
      if (jobConfig.webhook?.includeFields &&
          exactMatchWebhooks.some(webhook => doFieldConfigsDiffer(jobConfig.webhook.includeFields, webhook.includeFields))) {
        console.log(chalk.yellow('\nNote: The existing webhook has different include fields than your configuration.'));
        console.log(chalk.yellow('You may want to disable and re-enable this webhook to update the fields.'));
      }

      return;
    }

    // Next, check for webhooks with same topic but different endpoint
    const sameTopicWebhooks = webhooks.filter(webhook =>
      webhook.topic === graphqlTopic &&
      webhook.endpoint?.__typename === 'WebhookHttpEndpoint' &&
      webhook.endpoint.callbackUrl !== webhookAddress
    );

    if (sameTopicWebhooks.length > 0) {
      console.log(chalk.yellow('\nWebhook for this topic already exists with a different endpoint:'));
      sameTopicWebhooks.forEach(webhook => {
        console.log(`- ID: ${getWebhookIdSuffix(webhook.id)}`);
        console.log(`  Endpoint: ${webhook.endpoint.callbackUrl}`);
      });
      console.log(chalk.yellow('\nShopify only allows one webhook per topic per shop.'));
      console.log(chalk.yellow('Please disable the existing webhook first using:'));
      console.log(chalk.cyan(`shopworker delete-webhook ${getWebhookIdSuffix(sameTopicWebhooks[0].id)} --job ${jobPath}`));

      return;
    }

    // Create the subscription
    try {
      const webhookSubscription = prepareWebhookSubscription(webhookAddress, jobConfig);
      await createWebhook(shopify, triggerConfig.webhook.topic, webhookSubscription);
      console.log(chalk.green('\n✓ Webhook created successfully'));
    } catch (error) {
      // Check if this is a URL not allowed error
      if (error.message.includes('Address is not allowed')) {
        console.log(chalk.red('\nError: The webhook URL is not allowed by Shopify.'));
        console.log('Shopify requires webhook URLs to be HTTPS and from a trusted domain.');
        console.log('For testing, you can use the Shopify CLI or a service like ngrok.');
      } else {
        // Re-throw other errors
        throw error;
      }
    }
  } catch (error) {
    console.error(`Error enabling webhook: ${error.message}`);
  }
}

/**
 * Prepare webhook subscription data
 */
function prepareWebhookSubscription(webhookAddress, jobConfig) {
  const subscription = {
    callbackUrl: webhookAddress,
    format: 'JSON'
  };

  // Add includeFields if specified
  if (jobConfig.webhook?.includeFields && Array.isArray(jobConfig.webhook.includeFields)) {
    subscription.includeFields = jobConfig.webhook.includeFields;
  }

  // Add metafield namespaces if specified
  if (jobConfig.webhook?.metafieldNamespaces && Array.isArray(jobConfig.webhook.metafieldNamespaces)) {
    subscription.metafieldNamespaces = jobConfig.webhook.metafieldNamespaces;
  }

  return subscription;
}

/**
 * Create a webhook with Shopify API
 */
async function createWebhook(shopify, topic, webhookSubscription) {
  const graphqlTopic = convertToGraphqlTopic(topic);
  const variables = {
    topic: graphqlTopic,
    webhookSubscription
  };

  const response = await shopify.graphql(WEBHOOK_CREATE_MUTATION, variables);

  if (response.webhookSubscriptionCreate?.userErrors?.length > 0) {
    const errors = response.webhookSubscriptionCreate.userErrors
      .map(err => `${err.field.join('.')}: ${err.message}`)
      .join(', ');
    throw new Error(`Failed to create webhook: ${errors}`);
  }
}

/**
 * Disable a webhook for a job
 * @param {string} cliDirname - The directory where cli.js is located
 * @param {string} jobPath - The job path relative to jobs/
 * @param {string} workerUrl - The worker URL for the webhook
 */
export async function disableJobWebhook(cliDirname, jobPath, workerUrl) {
  try {
    // Validate webhook configuration first
    const { jobConfig, triggerConfig } = loadAndValidateWebhookConfigs(cliDirname, jobPath);
    if (!jobConfig || !triggerConfig) return;

    const webhookAddress = createWebhookUrl(workerUrl, jobPath);
    console.log(`Shop: ${chalk.magenta(jobConfig.shop)}`);
    console.log(`Disabling webhook for job: ${chalk.blue(jobConfig.name || jobPath)}`);
    console.log(`Topic: ${triggerConfig.webhook.topic}`);
    console.log(`Endpoint: ${webhookAddress}`);

    // Find the subscription
    const shopify = initShopify(cliDirname, jobPath);
    const response = await shopify.graphql(GET_WEBHOOKS_QUERY, { first: 100 });

    if (!isValidResponse(response, 'webhookSubscriptions.nodes')) {
      throw new Error('Invalid API response when fetching webhooks');
    }

    const webhooks = response.webhookSubscriptions.nodes;
    const graphqlTopic = convertToGraphqlTopic(triggerConfig.webhook.topic);

    // Use isWebhookForJob which has better URL matching
    const matchingWebhooks = webhooks.filter(webhook => isWebhookForJob(webhook, graphqlTopic, jobPath));

    if (matchingWebhooks.length === 0) {
      // Also check without URL encoding
      console.log(chalk.yellow('\nNo matching webhook found. Nothing to disable.'));

      // If there are webhooks with same topic but different endpoints, show them
      const sameTopicWebhooks = webhooks.filter(webhook =>
        webhook.topic === graphqlTopic &&
        webhook.endpoint?.__typename === 'WebhookHttpEndpoint'
      );

      if (sameTopicWebhooks.length > 0) {
        console.log(chalk.yellow(`\nFound ${sameTopicWebhooks.length} webhook(s) with topic ${triggerConfig.webhook.topic}:`));
        sameTopicWebhooks.forEach(webhook => {
          console.log(`- ID: ${getWebhookIdSuffix(webhook.id)}`);
          console.log(`  URL: ${webhook.endpoint.callbackUrl}`);

          // Try to extract the job from the URL
          try {
            const url = new URL(webhook.endpoint.callbackUrl);
            const urlJob = url.searchParams.get('job');
            if (urlJob) {
              console.log(`  Job in URL: ${urlJob}`);
            }
          } catch (e) {
            // Ignore URL parsing errors
          }
        });

        console.log(chalk.yellow('\nTo delete one of these webhooks, use:'));
        console.log(chalk.cyan(`shopworker delete-webhook <webhook-id> --job ${jobPath}`));
      }

      return;
    }

    console.log(`\nFound ${matchingWebhooks.length} webhook(s) to disable.`);

    // Delete all matching webhooks
    await deleteMatchingWebhooks(shopify, matchingWebhooks);

    console.log(chalk.green('✓ Webhook(s) deleted successfully'));
  } catch (error) {
    console.error(`Error disabling webhook: ${error.message}`);
  }
}

/**
 * Delete multiple webhooks
 */
async function deleteMatchingWebhooks(shopify, webhooks) {
  for (const webhook of webhooks) {
    try {
      await deleteWebhook(shopify, webhook.id);
      console.log(`Deleted webhook ID: ${getWebhookIdSuffix(webhook.id)}`);
    } catch (error) {
      console.error(`Error deleting webhook ${webhook.id}: ${error.message}`);
    }
  }
}

/**
 * Delete a webhook by ID
 */
async function deleteWebhook(shopify, webhookId) {
  const variables = {
    id: webhookId
  };

  const response = await shopify.graphql(WEBHOOK_DELETE_MUTATION, variables);

  if (response.webhookSubscriptionDelete?.userErrors?.length > 0) {
    const errors = response.webhookSubscriptionDelete.userErrors
      .map(err => `${err.field.join('.')}: ${err.message}`)
      .join(', ');
    throw new Error(`Failed to delete webhook: ${errors}`);
  }
}

/**
 * Delete a webhook by ID (direct command)
 * @param {string} cliDirname - The directory where cli.js is located
 * @param {string} jobPath - The job path relative to jobs/
 * @param {string} webhookId - The ID of the webhook to delete
 */
export async function deleteWebhookById(cliDirname, jobPath, webhookId) {
  try {
    const jobConfig = loadJobConfig(jobPath);
    if (!jobConfig) {
      console.error(`Error: Could not load job configuration for ${jobPath}`);
      return;
    }

    const fullWebhookId = getFullWebhookId(webhookId);
    console.log(`Shop: ${chalk.magenta(jobConfig.shop)}`);
    console.log(`For job: ${chalk.blue(jobConfig.name || jobPath)}`);
    console.log(`Deleting webhook ID: ${webhookId}`);

    const shopify = initShopify(cliDirname, jobPath);
    await deleteWebhook(shopify, fullWebhookId);

    console.log(chalk.green('\n✓ Webhook deleted successfully'));
  } catch (error) {
    console.error(`Error deleting webhook: ${error.message}`);
  }
}
