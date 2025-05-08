import { loadJobConfig, loadTriggerConfig } from './job-loader.js';
import { initShopify } from './shopify-api-helpers.js';
import { getAvailableJobDirs, loadAndValidateWebhookConfigs } from './common-helpers.js';
import WEBHOOK_CREATE_MUTATION from '../graphql/webhookSubscriptionCreate.js';
import WEBHOOK_DELETE_MUTATION from '../graphql/webhookSubscriptionDelete.js';
import GET_WEBHOOKS_QUERY from '../graphql/getWebhooks.js';
import chalk from 'chalk';

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
  let statusMsg = '✅ MANUAL'; // Default for jobs without trigger or non-webhook triggers
  let webhookIdSuffix = '-';
  const shop = jobConfig.shop || null;
  let includeFields = null;

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
            statusMsg = '🟢 ENABLED';
            webhookIdSuffix = jobWebhook.id.split('/').pop();
            includeFields = jobWebhook.includeFields;
          } else {
            statusMsg = '🔴 DISABLED';
          }
        }
      } catch (initOrGraphQLError) {
        console.warn(`Warning: Error fetching webhook status for job ${currentJobName} (Shop: ${chalk.blue(jobConfig.shop)}): ${initOrGraphQLError.message}`);
        statusMsg = '⚠️ API ERROR';
        webhookIdSuffix = 'ERR';
      }
    }
  }
  return { jobName: currentJobName, displayTopic, statusMsg, webhookIdSuffix, shop, includeFields };
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

  console.log('\nJOB STATUS SUMMARY\n' + '-'.repeat(100));
  console.log(`${'JOB'.padEnd(25)} ${'SHOP'.padEnd(20)} ${'TRIGGER/TOPIC'.padEnd(30)} ${'STATUS'.padEnd(15)} ${'WEBHOOK ID'.padEnd(10)} FIELDS`);
  console.log('-'.repeat(100));

  for (const currentJobName of jobDirs) {
    try {
      const { jobName, displayTopic, statusMsg, webhookIdSuffix, shop, includeFields } = await getJobDisplayInfo(cliDirname, currentJobName);
      const shopDisplay = shop ? chalk.blue(shop).padEnd(20) : 'N/A'.padEnd(20);
      let fieldsDisplay = '';

      if (includeFields && includeFields.length > 0) {
        // Show first 3 fields with ellipsis if more
        const fieldCount = includeFields.length;
        const fieldsToShow = includeFields.slice(0, 3);
        fieldsDisplay = fieldsToShow.join(', ');
        if (fieldCount > 3) {
          fieldsDisplay += ` +${fieldCount - 3} more`;
        }
      }

      console.log(`${jobName.padEnd(25)} ${shopDisplay} ${displayTopic.padEnd(30)} ${statusMsg.padEnd(15)} ${webhookIdSuffix.padEnd(10)} ${fieldsDisplay}`);
    } catch (error) { // Catch errors from getJobDisplayInfo if they are not handled internally
      console.error(`Error processing job ${currentJobName}: ${error.message}`);
      console.log(`${currentJobName.padEnd(25)} ${'ERROR'.padEnd(20)} ${'ERROR'.padEnd(30)} ${'⚠️ UNKNOWN ERROR'.padEnd(15)} ${'-'.padEnd(10)} -`);
    }
  }

  console.log('-'.repeat(100));
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
          console.log(`  Include Fields: ${webhook.includeFields.join(', ')}`);
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
  const { triggerConfig } = configs;

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

    // Add includeFields if specified in the trigger config
    if (triggerConfig.webhook.includeFields && Array.isArray(triggerConfig.webhook.includeFields)) {
      webhookSubscription.includeFields = triggerConfig.webhook.includeFields;
      console.log(`Include Fields:`);
      triggerConfig.webhook.includeFields.forEach(field => {
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
