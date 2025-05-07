#!/usr/bin/env node

import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Import utility functions from our new modules
import {
  detectJobDirectory,
  ensureAndResolveJobName,
  getWorkerUrl
} from './utils/common-helpers.js';
import { runJobTest, findSampleRecordForJob } from './utils/job-executor.js';
import { handleCloudflareDeployment } from './utils/deployment-manager.js';
import {
  handleAllJobsStatus,
  handleSingleJobStatus,
  enableJobWebhook,
  disableJobWebhook
} from './utils/webhook-handlers.js';
import { loadJobConfig, loadTriggerConfig } from './utils/job-loader.js';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ================================================================= //
//                        COMMANDER PROGRAM                          //
// ================================================================= //
const program = new Command();

program
  .name('shopworker')
  .description('Shopify worker CLI tool')
  .version('1.0.0');

program
  .command('test [jobNameArg]')
  .description('Test a job with the most recent order data or manual trigger')
  .option('-d, --dir <jobDirectory>', 'Job directory name (if not running from within job dir)')
  .option('-q, --query <queryString>', 'Query string to filter results (e.g. "status:any")')
  .action(async (jobNameArg, options) => {
    const jobName = await ensureAndResolveJobName(__dirname, jobNameArg, options.dir, true);
    if (!jobName) return;
    await runJobTest(__dirname, jobName, options.query);
  });

program
  .command('enable [jobNameArg]')
  .description('Enable a job by registering webhooks with Shopify after ensuring the latest code is deployed')
  .option('-d, --dir <jobDirectory>', 'Job directory name')
  .option('-w, --worker <workerUrl>', 'Cloudflare worker URL (overrides .shopworker.json)')
  .action(async (jobNameArg, options) => {
    const deploymentSuccessful = await handleCloudflareDeployment(__dirname);
    if (!deploymentSuccessful) {
      console.error("Halting 'enable' command due to deployment issues.");
      return;
    }

    const jobName = await ensureAndResolveJobName(__dirname, jobNameArg, options.dir, false);
    if (!jobName) return;

    const workerUrl = getWorkerUrl(options, __dirname);
    if (!workerUrl) return;

    await enableJobWebhook(__dirname, jobName, workerUrl);
  });

program
  .command('disable [jobNameArg]')
  .description('Disable a job by removing webhooks from Shopify')
  .option('-d, --dir <jobDirectory>', 'Job directory name')
  .option('-w, --worker <workerUrl>', 'Cloudflare worker URL (overrides .shopworker.json)')
  .action(async (jobNameArg, options) => {
    const jobName = await ensureAndResolveJobName(__dirname, jobNameArg, options.dir, false);
    if (!jobName) return;

    const workerUrl = getWorkerUrl(options, __dirname);
    if (!workerUrl) {
      console.error("Worker URL is required to accurately identify and disable webhooks. Please provide with -w or set cloudflare_worker_url in .shopworker.json.");
      return;
    }

    await disableJobWebhook(__dirname, jobName, workerUrl);
  });

program
  .command('status [jobNameArg]')
  .description('Check the status of webhooks for a job or all jobs')
  .option('-d, --dir <jobDirectory>', 'Job directory name')
  .action(async (jobNameArg, options) => {
    // For 'status', jobName can be undefined to mean "all jobs"
    // detectJobDirectory will be tried. If it's still undefined, then all jobs.
    let jobName = jobNameArg || detectJobDirectory(__dirname, options.dir);

    if (!jobName) {
      await handleAllJobsStatus(__dirname);
    } else {
      await handleSingleJobStatus(__dirname, jobName);
    }
  });

program
  .command('runtest')
  .description('Run test for the current job directory (or specified with -d)')
  .option('-d, --dir <jobDirectory>', 'Job directory name (if not running from within job dir)')
  .option('-q, --query <queryString>', 'Query string to filter results (e.g. "status:any")')
  .action(async (options) => {
    const jobName = await ensureAndResolveJobName(__dirname, null, options.dir, true);
    if (!jobName) return;
    await runJobTest(__dirname, jobName, options.query);
  });

program
  .command('deploy')
  .description('Deploy the current state to Cloudflare and record the commit hash.')
  .action(async () => {
    console.log('Starting Cloudflare deployment process...');
    const success = await handleCloudflareDeployment(__dirname);
    if (success) {
      console.log('Deployment process completed successfully.');
    } else {
      console.error('Deployment process failed.');
    }
  });

program
  .command('put-secrets')
  .description('Save .shopworker.json contents as a Cloudflare secret')
  .action(async () => {
    console.log('Setting up Cloudflare secrets...');
    const shopworkerPath = path.join(__dirname, '.shopworker.json');

    if (!fs.existsSync(shopworkerPath)) {
      console.error('Error: .shopworker.json file not found.');
      return;
    }

    try {
      // Read the file
      const fileContent = fs.readFileSync(shopworkerPath, 'utf8');
      const configData = JSON.parse(fileContent);

      // Stringify the content for the secret
      const stringifiedContent = JSON.stringify(configData);

      // Save as Cloudflare secret using wrangler
      const { execSync } = await import('child_process');

      // Create a temporary file with the config
      const tempFile = path.join(__dirname, '.temp_config.json');
      fs.writeFileSync(tempFile, stringifiedContent, 'utf8');

      try {
        // Use the file content as input to wrangler
        execSync(`cat ${tempFile} | npx wrangler secret put SHOPWORKER_CONFIG`,
          { stdio: 'inherit', encoding: 'utf8' });

        console.log('Successfully saved .shopworker.json as SHOPWORKER_CONFIG secret.');
      } finally {
        // Clean up temporary file
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      }
    } catch (error) {
      console.error('Error setting up Cloudflare secret:', error.message);
    }
  });

program
  .command('test-remote [jobNameArg]')
  .description('Test a job by sending a POST request to the worker URL with a record ID')
  .option('-d, --dir <jobDirectory>', 'Job directory name (if not running from within job dir)')
  .option('-i, --id <recordId>', 'ID of the record to process (optional, will find a sample record if not provided)')
  .option('-q, --query <queryString>', 'Query string to filter results when automatically finding a record')
  .option('-w, --worker <workerUrl>', 'Cloudflare worker URL (overrides .shopworker.json)')
  .action(async (jobNameArg, options) => {
    const jobName = await ensureAndResolveJobName(__dirname, jobNameArg, options.dir, true);
    if (!jobName) return;

    const workerUrl = getWorkerUrl(options, __dirname);
    if (!workerUrl) {
      console.error("Worker URL is required for remote testing. Please provide with -w or set cloudflare_worker_url in .shopworker.json.");
      return;
    }

    // Load job and trigger configs to get webhook topic and shop domain
    const jobConfig = loadJobConfig(jobName);
    if (!jobConfig) {
      console.error(`Could not load configuration for job: ${jobName}`);
      return;
    }

    const triggerConfig = jobConfig.trigger ? loadTriggerConfig(jobConfig.trigger) : null;
    const webhookTopic = triggerConfig?.webhook?.topic || 'products/create'; // Default if not found

    // Get shop domain from job config
    const shopConfigPath = path.join(__dirname, '.shopworker.json');
    let shopDomain = 'unknown-shop.myshopify.com'; // Default fallback

    try {
      const shopworkerContent = fs.readFileSync(shopConfigPath, 'utf8');
      const shopworkerData = JSON.parse(shopworkerContent);
      const shopConfig = shopworkerData.shops.find(s => s.name === jobConfig.shop);
      if (shopConfig && shopConfig.shopify_domain) {
        shopDomain = shopConfig.shopify_domain;
      }
    } catch (error) {
      console.warn(`Warning: Could not read shop domain from config: ${error.message}`);
    }

    let recordId = options.id;
    if (!recordId) {
      try {
        console.log("No record ID provided. Finding a sample record...");
        const { record } = await findSampleRecordForJob(__dirname, jobName, options.query);
        recordId = record.id;
        if (!recordId) {
          console.error("Could not extract ID from the sample record.");
          return;
        }
        console.log(`Found sample record with ID: ${recordId}`);
      } catch (error) {
        console.error(`Error finding sample record: ${error.message}`);
        return;
      }
    }

    // Format the URL with ?job parameter similar to webhook URL format
    const webhookUrl = new URL(workerUrl);
    webhookUrl.searchParams.set('job', jobName);
    const webhookAddress = webhookUrl.toString();

    console.log(`Sending test request to worker for job: ${jobName}: ${webhookAddress}`);
    console.log(`Topic: ${webhookTopic}`);
    console.log(`Shop: ${shopDomain}`);

    try {
      const response = await fetch(webhookAddress, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Hmac-Sha256': 'dummY',
          'X-Shopify-Topic': webhookTopic,
          'X-Shopify-Shop-Domain': shopDomain,
          'X-Shopify-API-Version': '2024-07'
        },
        body: JSON.stringify({
          id: recordId
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Error from worker: ${response.status} ${response.statusText}`);
        console.error(errorText);
        return;
      }

      const result = await response.json();
      console.log('Worker response:', JSON.stringify(result, null, 2));
      console.log('Remote test completed successfully!');
    } catch (error) {
      console.error(`Error connecting to worker: ${error.message}`);
    }
  });

program.parse(process.argv);
