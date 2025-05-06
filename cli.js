#!/usr/bin/env node

import dotenv from 'dotenv';
import { Command } from 'commander';
import Shopify from 'shopify-api-node';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { loadJobConfig, loadTriggerConfig } from './utils/job-loader.js';

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
    // With shopify-api-node, we only need the shop name and access token
    const shopName = process.env.SHOP.replace('.myshopify.com', '');

    return new Shopify({
      shopName,
      accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
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
  try {
    // Load job config
    const jobConfig = loadJobConfig(jobName);
    if (!jobConfig.trigger) {
      console.error(`Job ${jobName} doesn't have a trigger defined`);
      return;
    }

    // Load trigger config
    const triggerConfig = loadTriggerConfig(jobConfig.trigger);
    if (!triggerConfig.test || !triggerConfig.test.query) {
      console.error(`Trigger ${jobConfig.trigger} doesn't have a test query defined`);
      return;
    }

    // Initialize Shopify API client
    const shopify = initShopify();

    // Dynamically import the GraphQL query specified in the trigger
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

    // Dynamically import the job module
    const jobModule = await import(`./jobs/${jobName}/job.js`);

    // Pass data to job handler
    await jobModule.process(item, shopify);

    console.log('Processing complete!');
  } catch (error) {
    console.error('Error running test:', error);
  }
}

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
  .description('Enable a job by registering webhooks with Shopify')
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

      console.log(`Registering webhook for job: ${jobName}`);
      console.log(`Topic: ${triggerConfig.webhook.topic}`);
      console.log(`Worker URL: ${webhookAddress}`);

      // Create webhook using Shopify API
      const webhook = await shopify.webhook.create({
        topic: triggerConfig.webhook.topic,
        address: webhookAddress,
        format: 'json'
      });

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

      console.log(`Finding and removing webhooks for job: ${jobName}`);
      console.log(`Topic: ${triggerConfig.webhook.topic}`);

      // Get all webhooks
      const webhooks = await shopify.webhook.list();

      // Filter webhooks by topic and address
      const matchingWebhooks = webhooks.filter(webhook =>
        webhook.topic === triggerConfig.webhook.topic &&
        webhook.address === webhookAddress
      );

      if (matchingWebhooks.length === 0) {
        console.log(`No webhooks found for job: ${jobName}`);
        return;
      }

      // Delete each matching webhook
      console.log(`Found ${matchingWebhooks.length} webhook(s) to remove`);

      for (const webhook of matchingWebhooks) {
        console.log(`Removing webhook with ID: ${webhook.id}`);
        await shopify.webhook.delete(webhook.id);
      }

      console.log('Job disabled successfully!');
    } catch (error) {
      console.error('Error disabling job:', error);
    }
  });

program
  .command('status [jobName]')
  .description('Check the status of webhooks for a job')
  .option('-d, --dir <jobDirectory>', 'Job directory name')
  .action(async (jobName, options) => {
    // If jobName is not provided, try to detect from directory or options
    if (!jobName) {
      jobName = detectJobDirectory(options.dir);

      if (!jobName) {
        console.error('Could not detect job directory');
        return;
      }
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

      console.log(`Checking webhooks for job: ${jobName}`);
      console.log(`Topic: ${triggerConfig.webhook.topic}`);

      // Get all webhooks
      const webhooks = await shopify.webhook.list();

      // Filter webhooks by topic
      const matchingWebhooks = webhooks.filter(webhook =>
        webhook.topic === triggerConfig.webhook.topic
      );

      if (matchingWebhooks.length === 0) {
        console.log(`No webhooks found for topic: ${triggerConfig.webhook.topic}`);
      } else {
        console.log(`Found ${matchingWebhooks.length} webhook(s) for topic: ${triggerConfig.webhook.topic}`);

        matchingWebhooks.forEach(webhook => {
          console.log(`\nWebhook ID: ${webhook.id}`);
          console.log(`Address: ${webhook.address}`);
          console.log(`Format: ${webhook.format}`);
          console.log(`Created at: ${webhook.created_at}`);
          console.log(`Active: Yes`);
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

program.parse(process.argv);
