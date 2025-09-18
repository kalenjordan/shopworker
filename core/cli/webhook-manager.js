import { loadJobConfig, loadTriggerConfig, getAvailableJobDirs, loadAndValidateWebhookConfigs } from './job-discovery.js';
import { initShopify } from '../shared/shopify.js';
import {
  displayJobsTable,
  sortJobDisplayInfos,
  displayIncludeFieldsInfo,
  displayWebhookDetails,
  displayOrphanedWebhooksWarning
} from './display-formatter.js';
import WEBHOOK_CREATE_MUTATION from '../graphql/webhookSubscriptionCreate.js';
import WEBHOOK_DELETE_MUTATION from '../graphql/webhookSubscriptionDelete.js';
import GET_WEBHOOKS_QUERY from '../graphql/webhooksGet.js';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import toml from '@iarna/toml';

// ===================================================================
// Wrangler Configuration Functions
// ===================================================================

/**
 * Get active cron expressions from wrangler.toml
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @returns {Array<string>} Array of active cron expressions
 */
function getActiveCronExpressions(cliDirname) {
  try {
    const wranglerPath = path.join(cliDirname, 'wrangler.toml');
    if (!fs.existsSync(wranglerPath)) {
      return [];
    }

    const wranglerContent = fs.readFileSync(wranglerPath, 'utf8');
    const wranglerConfig = toml.parse(wranglerContent);

    if (wranglerConfig.triggers && wranglerConfig.triggers.crons) {
      // Filter out any non-string values (in case of parsing issues)
      return wranglerConfig.triggers.crons.filter(cron => typeof cron === 'string');
    }

    return [];
  } catch (error) {
    console.warn('Failed to parse wrangler.toml for cron expressions:', error.message);
    return [];
  }
}

// ===================================================================
// Webhook Utility Functions
// ===================================================================

function convertToGraphqlTopic(topic) {
  return topic.toUpperCase().replace('/', '_');
}

function createWebhookUrl(baseUrl, jobPath) {
  // Use only the job name, not the full path
  const jobName = cleanJobPath(jobPath);
  // Create URL with job name in the path, not as a query parameter
  const webhookUrl = new URL(baseUrl);
  webhookUrl.pathname = `/${jobName}`;
  return webhookUrl.toString();
}

function getFullWebhookId(webhookId) {
  return webhookId.startsWith('gid://') ? webhookId : `gid://shopify/WebhookSubscription/${webhookId}`;
}

function getWebhookIdSuffix(webhookId) {
  return webhookId.split('/').pop();
}

function isValidResponse(response, path) {
  return path.split('.').reduce((current, part) => current?.[part], response) != null;
}

/**
 * Clean job path by removing directory prefixes
 */
function cleanJobPath(jobPath) {
  return jobPath.replace(/^(local|core)\/jobs\//, '');
}

/**
 * Parse job parameter from webhook URL
 */
function parseJobFromWebhookUrl(webhookUrl) {
  try {
    const url = new URL(webhookUrl);
    // First check query parameter (for backwards compatibility with old webhooks)
    const jobParam = url.searchParams.get('job');
    if (jobParam) {
      return decodeURIComponent(jobParam);
    }

    // Check path format (new format)
    const pathname = url.pathname.replace(/^\//, '').replace(/\/$/, '');
    return pathname || null;
  } catch (e) {
    return null;
  }
}

/**
 * Compare job paths with flexible matching (handles both full and clean paths)
 */
function jobPathsMatch(path1, path2) {
  if (!path1 || !path2) return false;
  
  const clean1 = cleanJobPath(decodeURIComponent(path1));
  const clean2 = cleanJobPath(decodeURIComponent(path2));
  
  return path1 === path2 || clean1 === path2 || path1 === clean2 || clean1 === clean2;
}

function isWebhookForJob(webhook, graphqlTopic, jobPath) {
  if (webhook.topic !== graphqlTopic) return false;
  if (!webhook.endpoint || webhook.endpoint.__typename !== 'WebhookHttpEndpoint') return false;

  const webhookJobPath = parseJobFromWebhookUrl(webhook.endpoint.callbackUrl);
  return webhookJobPath && jobPathsMatch(webhookJobPath, jobPath);
}

function isWebhookForTopicButNotJob(webhook, graphqlTopic, jobPath) {
  if (webhook.topic !== graphqlTopic) return false;
  if (!webhook.endpoint || webhook.endpoint.__typename === 'WebhookHttpEndpoint') {
    const webhookJobPath = parseJobFromWebhookUrl(webhook.endpoint.callbackUrl);
    return !jobPathsMatch(webhookJobPath, jobPath);
  }
  return true;
}

function findMatchingWebhooks(webhooks, graphqlTopic, webhookAddress) {
  return webhooks.filter(webhook => {
    if (webhook.topic !== graphqlTopic) return false;
    if (!webhook.endpoint || webhook.endpoint.__typename !== 'WebhookHttpEndpoint') return false;

    try {
      const storedUrl = new URL(webhook.endpoint.callbackUrl);
      const newUrl = new URL(webhookAddress);

      // Compare base URLs and job parameters
      return storedUrl.origin === newUrl.origin && 
             storedUrl.pathname === newUrl.pathname &&
             jobPathsMatch(
               parseJobFromWebhookUrl(webhook.endpoint.callbackUrl),
               parseJobFromWebhookUrl(webhookAddress)
             );
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
         !Array.from(configSet).every(field => activeSet.has(field));
}

// ===================================================================
// Job Display Information
// ===================================================================

/**
 * Create basic job display info from job config
 */
function createBaseJobInfo(jobPath, jobConfig) {
  const jobId = cleanJobPath(jobPath);
  const displayName = jobConfig?.title || '(missing title)';
  const fullPath = jobConfig?.fullPath || null;
  const shop = jobConfig?.shop || null;
  const includeFields = jobConfig?.webhook?.includeFields || null;
  
  return { jobId, displayName, fullPath, shop, includeFields };
}

/**
 * Handle job config loading errors
 */
function handleJobConfigError(jobPath, error) {
  const baseInfo = createBaseJobInfo(jobPath, null);
  return {
    ...baseInfo,
    displayName: jobPath,
    displayTopic: 'CONFIG ERROR',
    statusMsg: '⚠️ ERROR',
    webhookIdSuffix: '-'
  };
}

/**
 * Handle trigger configuration errors
 */
function handleTriggerError(jobPath, jobConfig, error) {
  const baseInfo = createBaseJobInfo(jobPath, jobConfig);
  const errorMsg = error.includes('not found') ? '⚠️ TRIGGER MISSING' : '⚠️ INVALID TRIGGER';
  
  return {
    ...baseInfo,
    displayTopic: jobConfig.trigger || 'N/A',
    statusMsg: errorMsg,
    webhookIdSuffix: '-'
  };
}

/**
 * Get webhook status for a job
 */
async function getWebhookStatus(cliDirname, jobPath, triggerConfig, displayName, shop) {
  const graphqlTopic = convertToGraphqlTopic(triggerConfig.webhook.topic);
  
  try {
    const shopifyForJob = await initShopify(cliDirname, jobPath);
    const response = await shopifyForJob.graphql(GET_WEBHOOKS_QUERY, { first: 100 });

    if (!isValidResponse(response, 'webhookSubscriptions.nodes')) {
      console.warn(`Warning: Could not retrieve webhooks for job ${displayName} (Shop: ${chalk.blue(shop)}). Response format unexpected.`);
      return { statusMsg: '⚠️ NO DATA', webhookIdSuffix: '-' };
    }

    const shopWebhooks = response.webhookSubscriptions.nodes;
    const jobWebhook = shopWebhooks.find(webhook => isWebhookForJob(webhook, graphqlTopic, jobPath));

    return jobWebhook 
      ? { statusMsg: 'Enabled', webhookIdSuffix: getWebhookIdSuffix(jobWebhook.id) }
      : { statusMsg: 'Disabled', webhookIdSuffix: '-' };
      
  } catch (error) {
    console.warn(`Warning: Error fetching webhook status for job ${displayName} (Shop: ${chalk.blue(shop)}): ${error.message}`);
    return { statusMsg: '⚠️ API ERROR', webhookIdSuffix: 'ERR' };
  }
}

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
    jobConfig = await loadJobConfig(jobPath);
  } catch (e) {
    return handleJobConfigError(jobPath, e);
  }
  
  // Check for trigger loading errors from job config
  if (jobConfig.triggerError) {
    return handleTriggerError(jobPath, jobConfig, jobConfig.triggerError);
  }

  const baseInfo = createBaseJobInfo(jobPath, jobConfig);
  
  // Handle missing trigger
  if (!jobConfig.trigger) {
    return {
      ...baseInfo,
      displayTopic: 'N/A',
      statusMsg: '⚠️ TRIGGER MISSING',
      webhookIdSuffix: '-'
    };
  }

  // Load trigger configuration
  let triggerConfig;
  try {
    triggerConfig = loadTriggerConfig(jobConfig.trigger);
  } catch (e) {
    return handleTriggerError(jobPath, jobConfig, e.message);
  }

  const displayTopic = triggerConfig.webhook?.topic || jobConfig.trigger;

  // For webrequest triggers, show as enabled since they work immediately when deployed
  if (displayTopic === 'shopworker/webrequest') {
    return {
      ...baseInfo,
      displayTopic,
      statusMsg: 'Enabled',
      webhookIdSuffix: '-'
    };
  }

  // For scheduled triggers, check if enabled in wrangler.toml
  if (jobConfig.trigger === 'schedule') {
    const cronExpression = jobConfig.schedule || 'Not configured';
    const activeCrons = getActiveCronExpressions(cliDirname);
    const isEnabled = activeCrons.includes(cronExpression);

    return {
      ...baseInfo,
      displayTopic: `schedule (${cronExpression})`,
      statusMsg: isEnabled ? 'Enabled' : 'Disabled',
      webhookIdSuffix: '-'
    };
  }

  // For non-webhook triggers, return manual status
  if (!triggerConfig.webhook?.topic) {
    return {
      ...baseInfo,
      displayTopic,
      statusMsg: 'Manual',
      webhookIdSuffix: '-'
    };
  }

  // Get webhook status
  const webhookStatus = await getWebhookStatus(
    cliDirname, 
    jobPath, 
    triggerConfig, 
    baseInfo.displayName, 
    baseInfo.shop
  );

  return {
    ...baseInfo,
    displayTopic,
    ...webhookStatus
  };
}

/**
 * Check if a webhook URL contains a job parameter but points to a non-existent job
 */
function isOrphanedWebhook(webhookUrl, validJobPaths) {
  const jobPath = parseJobFromWebhookUrl(webhookUrl);
  if (!jobPath) return false;

  return !validJobPaths.some(validPath => jobPathsMatch(jobPath, validPath));
}

/**
 * Find orphaned webhooks in a shop
 */
function findOrphanedWebhooks(webhooks, jobPaths) {
  return webhooks.filter(webhook => 
    webhook.endpoint?.__typename === 'WebhookHttpEndpoint' &&
    isOrphanedWebhook(webhook.endpoint.callbackUrl, jobPaths)
  );
}

/**
 * Display status of all jobs' webhooks
 * @param {string} cliDirname - The directory where cli.js is located
 * @param {boolean|string} filterByCurrentDir - Whether to only show jobs in the current directory (boolean)
 *                                           or path to directory to filter by (string)
 * @param {boolean} includeCore - Whether to include core jobs in the output (default: false)
 */
export async function handleAllJobsStatus(cliDirname, filterByCurrentDir = false, includeCore = false) {
  // Convert boolean to directory path if needed
  const currentDir = typeof filterByCurrentDir === 'string' ? filterByCurrentDir :
                      filterByCurrentDir === true ? process.cwd() : null;

  let jobDirs = getAvailableJobDirs(cliDirname, currentDir);

  // Filter out core jobs unless explicitly requested
  if (!includeCore) {
    jobDirs = jobDirs.filter(jobPath => !jobPath.startsWith('core/jobs/'));
  }

  if (jobDirs.length === 0) {
    if (currentDir) {
      console.log('No jobs found in the current directory.');
    } else {
      console.log('No jobs found.');
    }
    return;
  }

  // Get shop domain from config
  try {
    const { getShopDomain } = await import('../shared/config-helpers.js');
    const shopDomain = getShopDomain(cliDirname, null);
    console.log(chalk.magenta(`Shop: ${shopDomain}`));
  } catch (error) {
    // If we can't get shop domain, just continue
  }

  console.log(chalk.blue(`Fetching webhook status for ${jobDirs.length} job${jobDirs.length === 1 ? '' : 's'}...`));

  try {
    const jobInfos = await getAllJobDisplayInfo(cliDirname, jobDirs);
    const sortedJobInfos = sortJobDisplayInfos(jobInfos);
    displayJobsTable(sortedJobInfos);

    // Get all webhooks for all shops to check for orphaned ones
    // Always check all jobs for orphaned webhooks, regardless of includeCore setting
    const allJobDirs = getAvailableJobDirs(cliDirname, currentDir);
    await checkForOrphanedWebhooks(cliDirname, allJobDirs);
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
      const jobConfig = await loadJobConfig(jobPath);
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
        const jobConfig = await loadJobConfig(jobPath);
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
      const shopify = await initShopify(cliDirname, jobForShop);
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
export async function getAllJobDisplayInfo(cliDirname, jobDirs) {
  const jobInfoPromises = jobDirs.map(jobPath =>
    getJobDisplayInfo(cliDirname, jobPath)
      .catch(error => {
        console.error(`Error getting info for ${jobPath}:`, error);
        return {
          jobId: jobPath,
          fullPath: null,
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
    const jobConfig = await loadJobConfig(jobPath);
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
    const shopifyForJob = await initShopify(cliDirname, jobPath);
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
    // Load job configuration directly
    const jobConfig = await loadJobConfig(jobPath);
    if (!jobConfig) {
      console.error(`Could not load configuration for job: ${jobPath}`);
      return;
    }

    // Load trigger configuration
    if (!jobConfig.trigger) {
      console.error(`Job ${jobPath} does not have a trigger configured`);
      return;
    }

    const triggerConfig = loadTriggerConfig(jobConfig.trigger);
    if (!triggerConfig || !triggerConfig.webhook) {
      console.error(`Could not load webhook configuration for trigger: ${jobConfig.trigger}`);
      return;
    }

    const webhookAddress = createWebhookUrl(workerUrl, jobPath);
    console.log(`Shop: ${chalk.magenta(jobConfig.shop)}`);
    console.log(`Enabling webhook for job: ${chalk.blue(jobConfig.name || jobPath)}`);
    console.log(`Topic: ${triggerConfig.webhook.topic}`);
    console.log(`Endpoint: ${webhookAddress}`);

    // Check if subscription already exists
    const shopify = await initShopify(cliDirname, jobPath);
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
    // Load job configuration directly
    const jobConfig = await loadJobConfig(jobPath);
    if (!jobConfig) {
      console.error(`Could not load configuration for job: ${jobPath}`);
      return;
    }

    // Load trigger configuration
    if (!jobConfig.trigger) {
      console.error(`Job ${jobPath} does not have a trigger configured`);
      return;
    }

    const triggerConfig = loadTriggerConfig(jobConfig.trigger);
    if (!triggerConfig || !triggerConfig.webhook) {
      console.error(`Could not load webhook configuration for trigger: ${jobConfig.trigger}`);
      return;
    }

    const webhookAddress = createWebhookUrl(workerUrl, jobPath);
    console.log(`Shop: ${chalk.magenta(jobConfig.shop)}`);
    console.log(`Disabling webhook for job: ${chalk.blue(jobConfig.name || jobPath)}`);
    console.log(`Topic: ${triggerConfig.webhook.topic}`);
    console.log(`Endpoint: ${webhookAddress}`);

    // Find the subscription
    const shopify = await initShopify(cliDirname, jobPath);
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
    const jobConfig = await loadJobConfig(jobPath);
    if (!jobConfig) {
      console.error(`Error: Could not load job configuration for ${jobPath}`);
      return;
    }

    const fullWebhookId = getFullWebhookId(webhookId);
    console.log(`Shop: ${chalk.magenta(jobConfig.shop)}`);
    console.log(`For job: ${chalk.blue(jobConfig.name || jobPath)}`);
    console.log(`Deleting webhook ID: ${webhookId}`);

    const shopify = await initShopify(cliDirname, jobPath);
    await deleteWebhook(shopify, fullWebhookId);

    console.log(chalk.green('\n✓ Webhook deleted successfully'));
  } catch (error) {
    console.error(`Error deleting webhook: ${error.message}`);
  }
}
