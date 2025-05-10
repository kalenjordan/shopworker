import { loadJobConfig, loadTriggerConfig } from './job-loader.js';
import { initShopify } from './shopify-api-helpers.js';
import { getAvailableJobDirs, loadAndValidateWebhookConfigs } from './common-helpers.js';
import WEBHOOK_CREATE_MUTATION from '../graphql/webhookSubscriptionCreate.js';
import WEBHOOK_DELETE_MUTATION from '../graphql/webhookSubscriptionDelete.js';
import GET_WEBHOOKS_QUERY from '../graphql/getWebhooks.js';
import chalk from 'chalk';

// Column widths for job status summary table
const COLUMN_WIDTHS = {
  shop: 18, // Shop (now first)
  job: 35, // Job name
  topic: 20, // Trigger/Topic
  status: 13, // Status
  webhookId: 12 // Webhook ID
};

// Helper to crop and pad a string
function cropAndPad(str, width) {
  if (str.length > width) {
    return str.slice(0, width - 3) + '...';
  }
  return str.padEnd(width);
}

/**
 * Get display information for a job's webhook status
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} currentJobName - The job name
 * @returns {Promise<Object>} Object with job status display information
 */
export async function getJobDisplayInfo(cliDirname, currentJobName) {
  let jobConfig;
  try {
    jobConfig = loadJobConfig(currentJobName);
  } catch (e) {
    return { jobName: currentJobName, displayTopic: 'CONFIG ERROR', statusMsg: '⚠️ ERROR', webhookIdSuffix: '-', shop: null };
  }

  let displayTopic = jobConfig.trigger || 'N/A';
  let statusMsg = 'Manual'; // Default for jobs without trigger or non-webhook triggers
  let webhookIdSuffix = '-';
  const shop = jobConfig.shop || null;

  // Only use includeFields from job config
  if (jobConfig.webhook && jobConfig.webhook.includeFields && Array.isArray(jobConfig.webhook.includeFields)) {
    includeFields = jobConfig.webhook.includeFields;
  }

  if (jobConfig.trigger) {
    let triggerConfig;
    try {
      triggerConfig = loadTriggerConfig(jobConfig.trigger);
    } catch(e) {
      return { jobName: currentJobName, displayTopic: jobConfig.trigger, statusMsg: '⚠️ TRIGGER CONFIG ERROR', webhookIdSuffix: '-', shop };
    }

    displayTopic = triggerConfig.webhook?.topic || jobConfig.trigger;

    if (triggerConfig.webhook && triggerConfig.webhook.topic) {
      const graphqlTopic = triggerConfig.webhook.topic.toUpperCase().replace('/', '_');
      try {
        const shopifyForJob = initShopify(cliDirname, currentJobName); // Initializes based on job's shop config
        const response = await shopifyForJob.graphql(GET_WEBHOOKS_QUERY, { first: 100 });

        if (!response || !response.webhookSubscriptions || !response.webhookSubscriptions.nodes) {
          console.warn(`Warning: Could not retrieve webhooks for job ${currentJobName} (Shop: ${chalk.blue(jobConfig.shop)}). Response format unexpected.`);
          statusMsg = '⚠️ NO DATA';
        } else {
          const shopWebhooks = response.webhookSubscriptions.nodes;
          const jobWebhook = shopWebhooks.find(webhook => {
            if (webhook.topic === graphqlTopic && webhook.endpoint && webhook.endpoint.__typename === 'WebhookHttpEndpoint') {
              try {
                const url = new URL(webhook.endpoint.callbackUrl);
                return url.searchParams.get('job') === currentJobName;
              } catch (e) { return false; }
            }
            return false;
          });

          if (jobWebhook) {
            statusMsg = `Enabled`;
            webhookIdSuffix = jobWebhook.id.split('/').pop();
          } else {
            statusMsg = `Disabled`;
          }
        }
      } catch (initOrGraphQLError) {
        console.warn(`Warning: Error fetching webhook status for job ${currentJobName} (Shop: ${chalk.blue(jobConfig.shop)}): ${initOrGraphQLError.message}`);
        statusMsg = '⚠️ API ERROR';
        webhookIdSuffix = 'ERR';
      }
    }
  }
  return { jobName: currentJobName, displayTopic, statusMsg, webhookIdSuffix, shop };
}

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

  const totalWidth = COLUMN_WIDTHS.shop + COLUMN_WIDTHS.job + COLUMN_WIDTHS.topic + COLUMN_WIDTHS.status + COLUMN_WIDTHS.webhookId + 5; // 5 spaces between columns
  console.log('\nJOB STATUS SUMMARY\n' + '-'.repeat(totalWidth));
  console.log(
    cropAndPad('SHOP', COLUMN_WIDTHS.shop) + ' ' +
    cropAndPad('JOB', COLUMN_WIDTHS.job) + ' ' +
    cropAndPad('TRIGGER/TOPIC', COLUMN_WIDTHS.topic) + ' ' +
    cropAndPad('STATUS', COLUMN_WIDTHS.status) + ' ' +
    cropAndPad('WEBHOOK ID', COLUMN_WIDTHS.webhookId)
  );
  console.log('-'.repeat(totalWidth));

  for (const currentJobName of jobDirs) {
    try {
      const { jobName, displayTopic, statusMsg, webhookIdSuffix, shop } = await getJobDisplayInfo(cliDirname, currentJobName);
      // Pad the shop name first, then color only the padded shop name
      let shopDisplay = 'N/A';
      if (shop) {
        const paddedShop = cropAndPad(shop, COLUMN_WIDTHS.shop);
        shopDisplay = chalk.blue(paddedShop);
      } else {
        shopDisplay = cropAndPad('N/A', COLUMN_WIDTHS.shop);
      }
      // Pad job name and topic as usual
      const jobDisplay = cropAndPad(jobName, COLUMN_WIDTHS.job);
      const topicDisplay = cropAndPad(displayTopic, COLUMN_WIDTHS.topic);
      // Pad webhook ID as usual
      const webhookIdDisplay = cropAndPad(webhookIdSuffix, COLUMN_WIDTHS.webhookId);
      // Pad status *after* coloring, so color codes don't affect column width
      let statusDisplay = statusMsg;
      if (statusMsg === 'Enabled') {
        statusDisplay = chalk.green(cropAndPad('✓ Enabled', COLUMN_WIDTHS.status));
      } else if (statusMsg === 'Disabled') {
        statusDisplay = chalk.red(cropAndPad('✗ Disabled', COLUMN_WIDTHS.status));
      } else if (statusMsg === 'Manual') {
        statusDisplay = chalk.green(cropAndPad('✓ Manual', COLUMN_WIDTHS.status));
      } else {
        statusDisplay = cropAndPad(statusMsg, COLUMN_WIDTHS.status);
      }
      console.log(
        shopDisplay + ' ' +
        jobDisplay + ' ' +
        topicDisplay + ' ' +
        statusDisplay + ' ' +
        webhookIdDisplay
      );
    } catch (error) {
      console.error(`Error processing job ${currentJobName}: ${error.message}`);
      console.log(
        cropAndPad('N/A', COLUMN_WIDTHS.shop) + ' ' +
        cropAndPad(currentJobName, COLUMN_WIDTHS.job) + ' ' +
        cropAndPad('ERROR', COLUMN_WIDTHS.topic) + ' ' +
        cropAndPad('⚠️ UNKNOWN ERROR', COLUMN_WIDTHS.status) + ' ' +
        cropAndPad('-', COLUMN_WIDTHS.webhookId)
      );
    }
  }

  console.log('-'.repeat(totalWidth));
  console.log('\nUse "shopworker enable <jobName>" to enable a job with a webhook.');
  console.log('Use "shopworker status <jobName>" to see detailed webhook information for a specific job.');
}

/**
 * Check and display status for a specific job
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} jobName - The job name
 */
export async function handleSingleJobStatus(cliDirname, jobName) {
  let jobConfig, triggerConfig;
  try {
    jobConfig = loadJobConfig(jobName);
  } catch (e) {
    console.error(`Error loading configuration for job ${jobName}: ${e.message}`);
    return;
  }

  if (!jobConfig.trigger) {
    console.log(`Job ${jobName} is configured for manual trigger (no trigger defined in config).`);
    console.log(`${jobName.padEnd(40)} ${'N/A'.padEnd(30)} ${'✅ MANUAL'.padEnd(13)} -`);
    return;
  }

  try {
    triggerConfig = loadTriggerConfig(jobConfig.trigger);
  } catch(e) {
    console.error(`Error loading trigger configuration '${jobConfig.trigger}' for job ${jobName}: ${e.message}`);
    return;
  }

  if (!triggerConfig.webhook || !triggerConfig.webhook.topic) {
    console.log(`Job ${jobName} (trigger: '${jobConfig.trigger}') is not a webhook trigger (no webhook topic defined).`);
    console.log(`${jobName.padEnd(40)} ${(jobConfig.trigger).padEnd(30)} ${'✅ MANUAL'.padEnd(13)} -`);
    return;
  }

  console.log(`Checking webhooks for job: ${jobName} (Shop: ${chalk.blue(jobConfig.shop)})`);
  console.log(`Shopify Topic: ${triggerConfig.webhook.topic}`);

  // Show job-specific webhook configuration if it exists
  if (jobConfig.webhook && jobConfig.webhook.includeFields && Array.isArray(jobConfig.webhook.includeFields)) {
    console.log(`Job Config Include Fields: ${jobConfig.webhook.includeFields.join(', ')}`);
  }

  // Show trigger-specific webhook configuration if different from job config
  if (triggerConfig.webhook.includeFields && Array.isArray(triggerConfig.webhook.includeFields)) {
    if (!jobConfig.webhook || !jobConfig.webhook.includeFields) {
      console.log(`Trigger Config Include Fields: ${triggerConfig.webhook.includeFields.join(', ')}`);
    }
  }

  try {
    const shopify = initShopify(cliDirname, jobName);
    const response = await shopify.graphql(GET_WEBHOOKS_QUERY, { first: 100 });

    if (!response || !response.webhookSubscriptions || !response.webhookSubscriptions.nodes) {
      console.error('Unexpected response format from Shopify GraphQL API when fetching webhooks.');
      console.log('Response structure:', JSON.stringify(response, null, 2));
      return;
    }

    const webhooks = response.webhookSubscriptions.nodes;
    const graphqlTopic = triggerConfig.webhook.topic.toUpperCase().replace('/', '_');

    const matchingWebhooksForJobAndTopic = webhooks.filter(webhook => {
      if (webhook.topic === graphqlTopic && webhook.endpoint && webhook.endpoint.__typename === 'WebhookHttpEndpoint') {
        try {
          const url = new URL(webhook.endpoint.callbackUrl);
          return url.searchParams.get('job') === jobName;
        } catch (e) { return false; }
      }
      return false;
    });

    const otherWebhooksForTopic = webhooks.filter(webhook => {
      if (webhook.topic === graphqlTopic) {
        if (webhook.endpoint && webhook.endpoint.__typename === 'WebhookHttpEndpoint') {
          try {
            const url = new URL(webhook.endpoint.callbackUrl);
            return url.searchParams.get('job') !== jobName; // Exclude the one for current job
          } catch (e) { return true; }
        } else { return true; }
      }
      return false;
    });

    if (matchingWebhooksForJobAndTopic.length > 0) {
      console.log(`\n🟢 Job '${jobName}' is ENABLED for topic '${triggerConfig.webhook.topic}'.`);
      matchingWebhooksForJobAndTopic.forEach(webhook => {
        console.log(`  Webhook ID: ${webhook.id}`);
        console.log(`  Callback URL: ${webhook.endpoint.callbackUrl}`);
        console.log(`  Created At: ${webhook.createdAt}`);
        if (webhook.includeFields && webhook.includeFields.length > 0) {
          console.log(`  Active Include Fields: ${webhook.includeFields.join(', ')}`);

          // Check if active fields differ from configuration
          let diffFromConfig = false;

          if (jobConfig.webhook && jobConfig.webhook.includeFields) {
            const jobFields = new Set(jobConfig.webhook.includeFields);
            const activeFields = new Set(webhook.includeFields);

            diffFromConfig =
              jobFields.size !== activeFields.size ||
              ![...jobFields].every(field => activeFields.has(field));

            if (diffFromConfig) {
              console.log(`  Note: Active fields differ from job configuration. Update webhook to apply current config.`);
            }
          }
        }
      });
    } else {
      console.log(`\n🔴 Job '${jobName}' is DISABLED for topic '${triggerConfig.webhook.topic}'.`);
      console.log(`   No active webhook found specifically for this job and topic on its configured shop.`);
    }

    if (otherWebhooksForTopic.length > 0) {
      console.log(`\nℹ️  Note: Found ${otherWebhooksForTopic.length} other webhook(s) for topic '${triggerConfig.webhook.topic}' on the same shop:`);
      otherWebhooksForTopic.forEach(webhook => {
        console.log(`  - ID: ${webhook.id}, URL: ${webhook.endpoint?.callbackUrl || 'N/A'}`);
      });
    }

  } catch (error) {
    console.error(`Error checking webhook status for job '${jobName}': ${error.message}`);
  }
}

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
    const webhookUrl = new URL(workerUrl);
    webhookUrl.searchParams.set('job', jobName);
    const webhookAddress = webhookUrl.toString();

    console.log(`Registering webhook for job: ${jobName} (Shop: ${chalk.blue(configs.jobConfig.shop)})`);
    console.log(`Topic: ${triggerConfig.webhook.topic}`);
    console.log(`Worker URL: ${webhookAddress}`);

    const graphqlTopic = triggerConfig.webhook.topic.toUpperCase().replace('/', '_');
    const webhookSubscription = {
      callbackUrl: webhookAddress,
      format: "JSON"
    };

    // Only use includeFields from job config
    if (jobConfig.webhook && jobConfig.webhook.includeFields && Array.isArray(jobConfig.webhook.includeFields)) {
      webhookSubscription.includeFields = jobConfig.webhook.includeFields;
      console.log(`Include Fields (from job config):`);
      jobConfig.webhook.includeFields.forEach(field => {
        console.log(`  - ${field}`);
      });
    }

    const variables = {
      topic: graphqlTopic,
      webhookSubscription: webhookSubscription
    };

    const response = await shopify.graphql(WEBHOOK_CREATE_MUTATION, variables);

    if (!response || !response.webhookSubscriptionCreate) {
      console.error('Unexpected response format from Shopify GraphQL API during webhook creation.');
      console.log('Response structure:', JSON.stringify(response, null, 2));
      return;
    }

    if (response.webhookSubscriptionCreate.userErrors?.length > 0) {
      const errors = response.webhookSubscriptionCreate.userErrors.map(err => err.message).join(", ");
      throw new Error(`Failed to create webhook: ${errors}`);
    }

    const webhook = response.webhookSubscriptionCreate.webhookSubscription;
    console.log(`Successfully registered webhook with ID: ${webhook.id}`);

    // Show the included fields in the success message if they exist
    if (webhook.includeFields && webhook.includeFields.length > 0) {
      console.log(`Webhook will only include these fields: ${webhook.includeFields.join(', ')}`);
    }

    console.log('Job enabled successfully!');
  } catch (error) {
    console.error(`Error enabling job '${jobName}': ${error.message}`);
  }
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
    const webhookUrl = new URL(workerUrl);
    webhookUrl.searchParams.set('job', jobName);
    const webhookAddress = webhookUrl.toString();
    const graphqlTopic = triggerConfig.webhook.topic.toUpperCase().replace('/', '_');

    console.log(`Disabling webhook for job: ${jobName} (Shop: ${chalk.blue(configs.jobConfig.shop)})`);
    console.log(`Topic: ${triggerConfig.webhook.topic}`);
    console.log(`Worker URL (match criteria): ${webhookAddress}`);

    const getResponse = await shopify.graphql(GET_WEBHOOKS_QUERY, { first: 100 });
    if (!getResponse?.webhookSubscriptions?.nodes) {
      console.error('Unexpected response format from Shopify GraphQL API when fetching webhooks for deletion.');
      console.log('Response structure:', JSON.stringify(getResponse, null, 2));
      return;
    }

    const matchingWebhooks = getResponse.webhookSubscriptions.nodes.filter(webhook =>
      webhook.topic === graphqlTopic &&
      webhook.endpoint?.__typename === 'WebhookHttpEndpoint' &&
      webhook.endpoint.callbackUrl === webhookAddress
    );

    if (matchingWebhooks.length === 0) {
      console.log('No matching webhooks found to disable for this job.');
      return;
    }

    let successCount = 0;
    for (const webhook of matchingWebhooks) {
      console.log(`Deleting webhook ID: ${webhook.id}...`);
      const deleteResponse = await shopify.graphql(WEBHOOK_DELETE_MUTATION, { id: webhook.id });
      if (deleteResponse?.webhookSubscriptionDelete?.userErrors?.length > 0) {
        const errors = deleteResponse.webhookSubscriptionDelete.userErrors.map(err => err.message).join(", ");
        console.error(`Error deleting webhook ${webhook.id}: ${errors}`);
      } else if (deleteResponse?.webhookSubscriptionDelete?.deletedWebhookSubscriptionId) {
        console.log(`Successfully deleted webhook with ID: ${webhook.id}`);
        successCount++;
      } else {
        console.error(`Error deleting webhook ${webhook.id}: Unexpected response format.`);
        console.log(JSON.stringify(deleteResponse, null, 2));
      }
    }
    if (successCount > 0 && successCount === matchingWebhooks.length) {
        console.log('Job disabled successfully!');
    } else if (successCount > 0) {
        console.log(`${successCount} of ${matchingWebhooks.length} webhooks disabled. Some errors occurred.`);
    } else {
        console.log('Job disable process completed, but no webhooks were successfully deleted.');
    }

  } catch (error) {
    console.error(`Error disabling job '${jobName}': ${error.message}`);
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

    // If the ID doesn't have the gid format, add it
    let fullWebhookId = webhookId;
    if (!webhookId.startsWith('gid://')) {
      fullWebhookId = `gid://shopify/WebhookSubscription/${webhookId}`;
      console.log(`Using full webhook ID: ${fullWebhookId}`);
    }

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
