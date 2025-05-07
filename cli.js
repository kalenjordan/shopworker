#!/usr/bin/env node

import dotenv from 'dotenv';
import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { loadJobConfig, loadTriggerConfig } from './utils/job-loader.js';
import { createShopifyClient } from './utils/shopify-client.js';
import WEBHOOK_CREATE_MUTATION from './graphql/webhookSubscriptionCreate.js';
import WEBHOOK_DELETE_MUTATION from './graphql/webhookSubscriptionDelete.js';
import GET_WEBHOOKS_QUERY from './graphql/getWebhooks.js';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  console.error('.env file not found. Please create one based on env.example');
  process.exit(1);
}

const program = new Command();

// Initialize Shopify API
function initShopify() {
  try {
    // Get shop domain and access token from environment
    const shopDomain = process.env.SHOP;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!shopDomain) {
      throw new Error('SHOP environment variable is not set');
    }

    if (!accessToken) {
      throw new Error('SHOPIFY_ACCESS_TOKEN environment variable is not set');
    }

    // Create Shopify client using our shared implementation
    return createShopifyClient({
      shopDomain,
      accessToken,
      apiVersion: '2025-04'
    });
  } catch (error) {
    console.error('Failed to initialize Shopify API:', error);
    process.exit(1);
  }
}

/**
 * Detect the job directory from various possible locations
 * @param {string} [specifiedDir] - An explicitly specified directory
 * @returns {string|null} The job name or null if not determined
 */
function detectJobDirectory(specifiedDir) {
  // If a directory is explicitly specified, use it
  if (specifiedDir) {
    return specifiedDir;
  }

  // Get the directory from which npm test was run (if applicable)
  const initCwd = process.env.INIT_CWD || process.cwd();
  const currentDir = process.cwd();

  // List of possible directories to check
  const dirsToCheck = [initCwd, currentDir];

  // Get all valid job directories
  const jobsDir = path.join(__dirname, 'jobs');
  const validJobDirs = fs.readdirSync(jobsDir)
    .filter(dir => fs.statSync(path.join(jobsDir, dir)).isDirectory());

  // Try each directory
  for (const dir of dirsToCheck) {
    // Check 1: Is this a direct job directory? (jobs/job-name)
    const dirName = path.basename(dir);
    if (validJobDirs.includes(dirName)) {
      return dirName;
    }

    // Check 2: Is this inside a job directory?
    const relPath = path.relative(jobsDir, dir);
    if (!relPath.startsWith('..') && relPath !== '') {
      const jobName = relPath.split(path.sep)[0];
      return jobName;
    }
  }

  return null;
}

/**
 * Run a test for a specific job
 */
async function runJobTest(jobName, queryParam) {
  // Load job config
  const jobConfig = loadJobConfig(jobName);
  if (!jobConfig.trigger) {
    console.error(`Job ${jobName} doesn't have a trigger defined`);
    return;
  }

  // Load trigger config
  const triggerConfig = loadTriggerConfig(jobConfig.trigger);

  // Initialize Shopify client
  const shopify = initShopify();

  // Dynamically import the job module
  const jobModule = await import(`./jobs/${jobName}/job.js`);

  // Check if this is a manual trigger
  if (triggerConfig.test && triggerConfig.test.skipQuery) {
    console.log(`Manual trigger detected for job: ${jobName}`);
    // Pass arguments as an object for manual triggers
    await jobModule.process({
      order: {}, // Empty object for manual trigger data
      shopify: shopify,
      env: process.env
    });
    console.log('Processing complete!');
    return;
  }

  // For non-manual triggers that require a query
  if (!triggerConfig.test || !triggerConfig.test.query) {
    console.error(`Trigger ${jobConfig.trigger} doesn't have a test query defined`);
    return;
  }

  // Dynamically import the GraphQL query
  const queryModule = await import(`./graphql/${triggerConfig.test.query}.js`);
  const query = queryModule.default;

  console.log("Fetching most recent data...");

  // Prepare GraphQL variables
  const variables = { first: 1 };

  // Add query parameter if provided
  if (queryParam) {
    console.log(`Using query filter: ${queryParam}`);
    variables.query = queryParam;
  }

  // Execute GraphQL query with variables
  const response = await shopify.graphql(query, variables);

  // Find the first top-level field in the response that has edges
  const topLevelKey = Object.keys(response).find(key =>
    response[key] && typeof response[key] === 'object' && response[key].edges
  );

  if (!topLevelKey || !response[topLevelKey].edges || response[topLevelKey].edges.length === 0) {
    console.error(`No ${topLevelKey || 'data'} found in response`);
    return;
  }

  // Extract the first node from the results
  const item = response[topLevelKey].edges[0].node;
  const itemName = item.name || item.title || item.id;

  console.log(`Processing ${topLevelKey.replace(/s$/, '')} ${itemName}...`);

  // Pass arguments as an object to job handler
  await jobModule.process({
    order: item,
    shopify: shopify,
    env: process.env
  });

  console.log('Processing complete!');
}

// --- Reusable Cloudflare Deployment Function ---
async function handleCloudflareDeployment() {
  // Check for uncommitted Git changes
  try {
    const { execSync } = await import('child_process');
    const gitStatus = execSync('git status --porcelain', { encoding: 'utf8' });
    if (gitStatus.trim() !== '') {
      console.error('Error: There are uncommitted changes in your Git repository. Please commit or stash them before deploying.');
      console.error('Uncommitted changes:\n' + gitStatus);
      return false; // Indicate failure
    }
  } catch (error) {
    console.error('Error checking Git status:', error.message);
    console.warn('Warning: Could not verify Git status. Proceeding, but this might lead to deploying uncommitted code.');
    // Depending on policy, you might want to return false here too.
    // For now, allowing it to proceed with a warning.
  }

  const shopworkerFilePath = path.join(__dirname, '.shopworker');
  let lastDeployedCommit = null;

  if (fs.existsSync(shopworkerFilePath)) {
    try {
      const shopworkerFileContent = fs.readFileSync(shopworkerFilePath, 'utf8');
      const shopworkerData = JSON.parse(shopworkerFileContent);
      if (shopworkerData && shopworkerData.lastDeployedCommit) {
        lastDeployedCommit = shopworkerData.lastDeployedCommit;
      }
    } catch (error) {
      console.warn('Warning: Could not read or parse .shopworker file. Will proceed as if no previous deployment was made.', error.message);
    }
  }

  let currentCommit = null;
  try {
    const { execSync } = await import('child_process');
    currentCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch (error) {
    console.error('Error getting current Git commit:', error.message);
    console.error('Cannot proceed without knowing the current commit. Please ensure you are in a Git repository.');
    return false; // Indicate failure
  }

  if (currentCommit !== lastDeployedCommit) {
    console.log(`Current commit (${currentCommit}) differs from last deployed commit (${lastDeployedCommit || 'None'}).`);
    console.log('Deploying to Cloudflare via Wrangler...');
    try {
      const { execSync } = await import('child_process');
      execSync('npx wrangler deploy', { stdio: 'inherit', encoding: 'utf8' });
      console.log('Successfully deployed to Cloudflare.');

      const newShopworkerData = { lastDeployedCommit: currentCommit };
      fs.writeFileSync(shopworkerFilePath, JSON.stringify(newShopworkerData, null, 2), 'utf8');
      console.log(`Updated .shopworker with new deployed commit: ${currentCommit}`);
    } catch (error) {
      console.error('Error deploying to Cloudflare with Wrangler:', error.message);
      console.error('Aborting deployment.');
      return false; // Indicate failure
    }
  } else {
    console.log(`Current commit (${currentCommit}) matches last deployed commit. No new deployment needed.`);
  }
  return true; // Indicate success
}
// --- End of Reusable Cloudflare Deployment Function ---

program
  .name('shopworker')
  .description('Shopify worker CLI tool')
  .version('1.0.0');

program
  .command('test [jobName]')
  .description('Test a job with the most recent order')
  .option('-d, --dir <jobDirectory>', 'Job directory name (used when npm script is run from project root)')
  .option('-q, --query <queryString>', 'Query string to filter results (e.g. "status:any")')
  .action(async (jobName, options) => {
    // If jobName is not provided, try to detect from directory or options
    if (!jobName) {
      jobName = detectJobDirectory(options.dir);

      if (jobName) {
      } else {
        // Show available jobs
        const jobsDir = path.join(__dirname, 'jobs');
        const jobDirs = fs.readdirSync(jobsDir)
          .filter(dir => fs.statSync(path.join(jobsDir, dir)).isDirectory());

        if (jobDirs.length === 1) {
          // If there's only one job, use it automatically
          jobName = jobDirs[0];
          console.log(`Only one job available, using: ${jobName}`);
        } else {
          // Otherwise, show the available jobs
          console.error('Could not detect job directory. Available jobs:');
          jobDirs.forEach(dir => console.error(`  ${dir}`));
          console.error('Run with: npm test -- --dir=JOB_NAME');
          console.error('Or run from within the job directory');
          return;
        }
      }
    }

    await runJobTest(jobName, options.query);
  });

program
  .command('enable [jobName]')
  .description('Enable a job by registering webhooks with Shopify after ensuring the latest code is deployed')
  .option('-d, --dir <jobDirectory>', 'Job directory name')
  .option('-w, --worker <workerUrl>', 'Cloudflare worker URL', process.env.CLOUDFLARE_WORKER_URL)
  .action(async (jobName, options) => {
    // --- Deployment and Git checks ---
    const deploymentSuccessful = await handleCloudflareDeployment();
    if (!deploymentSuccessful) {
      console.error("Halting 'enable' command due to deployment issues.");
      return;
    }
    // --- End of Deployment checks ---

    // If jobName is not provided, try to detect from directory or options
    if (!jobName) {
      jobName = detectJobDirectory(options.dir);

      if (!jobName) {
        console.error('Could not detect job directory');
        return;
      }
    }

    // Use worker URL from options (which defaults to env var) or directly from env
    const workerUrl = options.worker || process.env.CLOUDFLARE_WORKER_URL;

    if (!workerUrl) {
      console.error('Cloudflare worker URL is required. Please set CLOUDFLARE_WORKER_URL in your .env file.');
      return;
    }

    try {
      // Load job config
      const jobConfig = loadJobConfig(jobName);
      if (!jobConfig.trigger) {
        console.error(`Job ${jobName} doesn't have a trigger defined`);
        return;
      }

      // Load trigger config
      const triggerConfig = loadTriggerConfig(jobConfig.trigger);
      if (!triggerConfig.webhook || !triggerConfig.webhook.topic) {
        console.error(`Trigger ${jobConfig.trigger} doesn't have a webhook topic defined`);
        return;
      }

      // Initialize Shopify API client
      const shopify = initShopify();

      // Add job name to webhook URL for routing
      const webhookUrl = new URL(workerUrl);
      webhookUrl.searchParams.set('job', jobName);
      const webhookAddress = webhookUrl.toString();

      console.log(`Registering webhook for job: ${jobName}`);
      console.log(`Topic: ${triggerConfig.webhook.topic}`);
      console.log(`Worker URL: ${webhookAddress}`);

      // Convert the trigger topic to match the GraphQL enum format (e.g., "products/update" to "PRODUCTS_UPDATE")
      const graphqlTopic = triggerConfig.webhook.topic.toUpperCase().replace('/', '_');

      // Create webhook using GraphQL
      const variables = {
        topic: graphqlTopic,
        webhookSubscription: {
          callbackUrl: webhookAddress,
          format: "JSON"
        }
      };

      const response = await shopify.graphql(WEBHOOK_CREATE_MUTATION, variables);

      if (!response || !response.webhookSubscriptionCreate) {
        console.log('Response structure:', JSON.stringify(response, null, 2));
        throw new Error('Unexpected response format from Shopify GraphQL API');
      }

      if (response.webhookSubscriptionCreate.userErrors &&
          response.webhookSubscriptionCreate.userErrors.length > 0) {
        const errors = response.webhookSubscriptionCreate.userErrors.map(err => err.message).join(", ");
        throw new Error(`Failed to create webhook: ${errors}`);
      }

      const webhook = response.webhookSubscriptionCreate.webhookSubscription;
      console.log(`Successfully registered webhook with ID: ${webhook.id}`);
      console.log('Job enabled successfully!');
    } catch (error) {
      console.error('Error enabling job:', error);
    }
  });

program
  .command('disable [jobName]')
  .description('Disable a job by removing webhooks from Shopify')
  .option('-d, --dir <jobDirectory>', 'Job directory name')
  .option('-w, --worker <workerUrl>', 'Cloudflare worker URL', process.env.CLOUDFLARE_WORKER_URL)
  .action(async (jobName, options) => {
    // If jobName is not provided, try to detect from directory or options
    if (!jobName) {
      jobName = detectJobDirectory(options.dir);

      if (!jobName) {
        console.error('Could not detect job directory');
        return;
      }
    }

    // Use worker URL from options (which defaults to env var) or directly from env
    const workerUrl = options.worker || process.env.CLOUDFLARE_WORKER_URL;

    if (!workerUrl) {
      console.error('Cloudflare worker URL is required. Please set CLOUDFLARE_WORKER_URL in your .env file.');
      return;
    }

    try {
      // Load job config
      const jobConfig = loadJobConfig(jobName);
      if (!jobConfig.trigger) {
        console.error(`Job ${jobName} doesn't have a trigger defined`);
        return;
      }

      // Load trigger config
      const triggerConfig = loadTriggerConfig(jobConfig.trigger);
      if (!triggerConfig.webhook || !triggerConfig.webhook.topic) {
        console.error(`Trigger ${jobConfig.trigger} doesn't have a webhook topic defined`);
        return;
      }

      // Initialize Shopify API client
      const shopify = initShopify();

      // Add job name to webhook URL for routing
      const webhookUrl = new URL(workerUrl);
      webhookUrl.searchParams.set('job', jobName);
      const webhookAddress = webhookUrl.toString();

      console.log(`Disabling webhook for job: ${jobName}`);
      console.log(`Topic: ${triggerConfig.webhook.topic}`);
      console.log(`Worker URL: ${webhookAddress}`);

      // Get all webhooks
      const getResponse = await shopify.graphql(GET_WEBHOOKS_QUERY, { first: 100 });

      // Check if response has the expected structure
      if (!getResponse || !getResponse.webhookSubscriptions || !getResponse.webhookSubscriptions.nodes) {
        console.log('Response structure:', JSON.stringify(getResponse, null, 2));
        throw new Error('Unexpected response format from Shopify GraphQL API');
      }

      const webhooks = getResponse.webhookSubscriptions.nodes;

      // Convert the trigger topic to match the GraphQL enum format (e.g., "products/update" to "PRODUCTS_UPDATE")
      const graphqlTopic = triggerConfig.webhook.topic.toUpperCase().replace('/', '_');

      // Filter webhooks by topic and callback URL
      const matchingWebhooks = webhooks.filter(webhook =>
        webhook.topic === graphqlTopic &&
        webhook.endpoint &&
        webhook.endpoint.__typename === 'WebhookHttpEndpoint' &&
        webhook.endpoint.callbackUrl === webhookAddress
      );

      if (matchingWebhooks.length === 0) {
        console.log('No matching webhooks found to disable');
        return;
      }

      // Delete each matching webhook
      for (const webhook of matchingWebhooks) {
        const deleteResponse = await shopify.graphql(WEBHOOK_DELETE_MUTATION, { id: webhook.id });

        if (!deleteResponse || !deleteResponse.webhookSubscriptionDelete) {
          console.error(`Error deleting webhook ${webhook.id}: Unexpected response format`);
          console.log(JSON.stringify(deleteResponse, null, 2));
          continue;
        }

        if (deleteResponse.webhookSubscriptionDelete.userErrors &&
            deleteResponse.webhookSubscriptionDelete.userErrors.length > 0) {
          const errors = deleteResponse.webhookSubscriptionDelete.userErrors.map(err => err.message).join(", ");
          console.error(`Error deleting webhook ${webhook.id}: ${errors}`);
          continue;
        }

        console.log(`Successfully deleted webhook with ID: ${webhook.id}`);
      }

      console.log('Job disabled successfully!');
    } catch (error) {
      console.error('Error disabling job:', error);
    }
  });

program
  .command('status [jobName]')
  .description('Check the status of webhooks for a job or all jobs')
  .option('-d, --dir <jobDirectory>', 'Job directory name')
  .action(async (jobName, options) => {
    // Initialize Shopify API client first (we'll need it in all cases)
    const shopify = initShopify();

    // If jobName is not provided and not in a job directory, check all jobs
    if (!jobName) {
      jobName = detectJobDirectory(options.dir);

      // If still no job name determined, we're at the project root - check all jobs
      if (!jobName) {
        console.log('Checking status for all jobs in the project...');

        // Get all job directories
        const jobsDir = path.join(__dirname, 'jobs');
        const jobDirs = fs.readdirSync(jobsDir)
          .filter(dir => fs.statSync(path.join(jobsDir, dir)).isDirectory());

        if (jobDirs.length === 0) {
          console.log('No jobs found in the jobs/ directory.');
          return;
        }

        // Get all webhooks using GraphQL (we'll do this once for efficiency)
        const response = await shopify.graphql(GET_WEBHOOKS_QUERY, { first: 100 });

        // Check if response has the expected structure
        if (!response || !response.webhookSubscriptions || !response.webhookSubscriptions.nodes) {
          console.log('Response structure:', JSON.stringify(response, null, 2));
          throw new Error('Unexpected response format from Shopify GraphQL API');
        }

        const allWebhooks = response.webhookSubscriptions.nodes;

        // Create a map of topics to webhooks for faster lookup
        const webhooksByTopic = {};
        allWebhooks.forEach(webhook => {
          if (!webhooksByTopic[webhook.topic]) {
            webhooksByTopic[webhook.topic] = [];
          }
          webhooksByTopic[webhook.topic].push(webhook);
        });

        // Print header
        console.log('\nJOB STATUS SUMMARY\n' + '-'.repeat(80));
        console.log(`${'JOB'.padEnd(30)} ${'TRIGGER'.padEnd(20)} ${'STATUS'.padEnd(15)} WEBHOOK ID`);
        console.log('-'.repeat(80));

        // Check each job
        for (const dir of jobDirs) {
          try {
            // Load job config
            const jobConfig = loadJobConfig(dir);
            if (!jobConfig.trigger) {
              // Jobs without triggers are manual only
              console.log(`${dir.padEnd(30)} ${'N/A'.padEnd(20)} ${'MANUAL'.padEnd(15)} N/A`);
              continue;
            }

            // Load trigger config
            const triggerConfig = loadTriggerConfig(jobConfig.trigger);

            // For jobs without webhook triggers
            if (!triggerConfig.webhook || !triggerConfig.webhook.topic) {
              console.log(`${dir.padEnd(30)} ${jobConfig.trigger.padEnd(20)} ${'MANUAL'.padEnd(15)} N/A`);
              continue;
            }

            // For webhook jobs
            const topicStr = triggerConfig.webhook.topic;
            const graphqlTopic = topicStr.toUpperCase().replace('/', '_');

            // Find matching webhooks
            const matchingWebhooks = webhooksByTopic[graphqlTopic] || [];

            // Find a webhook configured specifically for this job
            const jobWebhook = matchingWebhooks.find(webhook => {
              if (webhook.endpoint && webhook.endpoint.__typename === 'WebhookHttpEndpoint') {
                try {
                  const url = new URL(webhook.endpoint.callbackUrl);
                  return url.searchParams.get('job') === dir;
                } catch (e) {
                  return false;
                }
              }
              return false;
            });

            if (jobWebhook) {
              // This job has a dedicated webhook
              console.log(`${dir.padEnd(30)} ${topicStr.padEnd(20)} ${'ENABLED'.padEnd(15)} ${jobWebhook.id.split('/').pop()}`);
            } else if (matchingWebhooks.length > 0) {
              // There are webhooks for this topic but none specifically for this job
              console.log(`${dir.padEnd(30)} ${topicStr.padEnd(20)} ${'NOT CONFIGURED'.padEnd(15)} None for this job`);
            } else {
              // No webhooks found for this topic
              console.log(`${dir.padEnd(30)} ${topicStr.padEnd(20)} ${'DISABLED'.padEnd(15)} None found`);
            }

          } catch (error) {
            console.error(`Error checking job ${dir}:`, error.message);
          }
        }

        console.log('-'.repeat(80));
        console.log('\nUse "npm run enable -- <jobName>" to enable a job with a webhook.');
        console.log('Use "npm run status -- <jobName>" to see detailed webhook information for a specific job.');

        return;
      }
    }

    try {
      // For a single job, use the existing implementation
      // Load job config
      const jobConfig = loadJobConfig(jobName);
      if (!jobConfig.trigger) {
        console.error(`Job ${jobName} doesn't have a trigger defined`);
        return;
      }

      // Load trigger config
      const triggerConfig = loadTriggerConfig(jobConfig.trigger);
      if (!triggerConfig.webhook || !triggerConfig.webhook.topic) {
        console.error(`Trigger ${jobConfig.trigger} doesn't have a webhook topic defined`);
        return;
      }

      console.log(`Checking webhooks for job: ${jobName}`);
      console.log(`Topic: ${triggerConfig.webhook.topic}`);

      // Get all webhooks using GraphQL
      const response = await shopify.graphql(GET_WEBHOOKS_QUERY, { first: 100 });

      // Check if response has the expected structure
      if (!response || !response.webhookSubscriptions || !response.webhookSubscriptions.nodes) {
        console.log('Response structure:', JSON.stringify(response, null, 2));
        throw new Error('Unexpected response format from Shopify GraphQL API');
      }

      const webhooks = response.webhookSubscriptions.nodes;

      // Filter webhooks by topic
      // Convert the trigger topic to match the GraphQL enum format (e.g., "products/update" to "PRODUCTS_UPDATE")
      const graphqlTopic = triggerConfig.webhook.topic.toUpperCase().replace('/', '_');

      const matchingWebhooks = webhooks.filter(webhook =>
        webhook.topic === graphqlTopic
      );

      if (matchingWebhooks.length === 0) {
        console.log(`No webhooks found for topic: ${triggerConfig.webhook.topic} (${graphqlTopic})`);
      } else {
        console.log(`Found ${matchingWebhooks.length} webhook(s) for topic: ${triggerConfig.webhook.topic} (${graphqlTopic})`);

        matchingWebhooks.forEach(webhook => {
          console.log(`\nWebhook ID: ${webhook.id}`);
          if (webhook.endpoint && webhook.endpoint.__typename === 'WebhookHttpEndpoint') {
            console.log(`Address: ${webhook.endpoint.callbackUrl}`);

            // Check if this webhook is for this job
            try {
              const url = new URL(webhook.endpoint.callbackUrl);
              const jobParam = url.searchParams.get('job');
              if (jobParam === jobName) {
                console.log(`Status: Active (configured for this job)`);
              } else if (jobParam) {
                console.log(`Status: Active (configured for job: ${jobParam})`);
              } else {
                console.log(`Status: Active (no job specified in URL)`);
              }
            } catch (e) {
              console.log(`Status: Active`);
            }
          } else {
            console.log(`Endpoint Type: ${webhook.endpoint ? webhook.endpoint.__typename : 'Unknown'}`);
            console.log(`Status: Active`);
          }
          console.log(`Topic: ${webhook.topic}`);
          console.log(`Created at: ${webhook.createdAt}`);
        });
      }
    } catch (error) {
      console.error('Error checking webhook status:', error);
    }
  });

program
  .command('runtest')
  .description('Run test for the current job directory')
  .option('-d, --dir <jobDirectory>', 'Job directory name (used when npm script is run from project root)')
  .option('-q, --query <queryString>', 'Query string to filter results (e.g. "status:any")')
  .option('--source-dir <sourceDirectory>', 'Source directory from where the command was run')
  .action(async (options) => {
    // Detect job directory
    const jobName = detectJobDirectory(options.dir);
    if (!jobName) {
      console.error('Could not detect job directory');
      return;
    }

    // Run test directly with all options
    await runJobTest(jobName, options.query);
  });

// --- New Deploy Command ---
program
  .command('deploy')
  .description('Deploy the current state to Cloudflare and record the commit hash.')
  .action(async () => {
    console.log('Starting Cloudflare deployment process...');
    const success = await handleCloudflareDeployment();
    if (success) {
      console.log('Deployment process completed successfully.');
    } else {
      console.error('Deployment process failed.');
    }
  });
// --- End of New Deploy Command ---

program.parse(process.argv);
