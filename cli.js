#!/usr/bin/env node

import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Import utility functions from our new consolidated module
import {
  detectJobDirectory,
  ensureAndResolveJobName,
  getWorkerUrl,
  runJobTest,
  findSampleRecordForJob,
  runJobRemoteTest,
  handleCloudflareDeployment
} from './utils/cli-helpers.js';

import {
  handleAllJobsStatus,
  handleSingleJobStatus,
  enableJobWebhook,
  disableJobWebhook,
  deleteWebhookById
} from './utils/webhook-cli.js';

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
  .option('-s, --shop <shopDomain>', 'Override the shop domain in the job config')
  .action(async (jobNameArg, options) => {
    const jobName = await ensureAndResolveJobName(__dirname, jobNameArg, options.dir, true);
    if (!jobName) return;
    await runJobTest(__dirname, jobName, options.query, options.shop);
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
  .option('-a, --all', 'Show status of all jobs, ignoring current directory context')
  .action(async (jobNameArg, options) => {
    // If a specific job is specified, use that
    if (jobNameArg) {
      await handleSingleJobStatus(__dirname, jobNameArg);
      return;
    }

    // If directory option is specified, use that
    if (options.dir) {
      const resolved = await ensureAndResolveJobName(__dirname, null, options.dir, false);
      if (resolved) {
        await handleSingleJobStatus(__dirname, resolved);
        return;
      }
    }

    // Otherwise, try to auto-detect current directory context
    const jobName = detectJobDirectory(__dirname, null);
    if (jobName && !options.all) {
      // We detected a specific job directory
      await handleSingleJobStatus(__dirname, jobName);
    } else {
      // We're not in a specific job directory, show filtered or all jobs
      const filterByCurrentDir = !options.all;
      await handleAllJobsStatus(__dirname, filterByCurrentDir);
    }
  });

program
  .command('runtest')
  .description('Run test for the current job directory (or specified with -d)')
  .option('-d, --dir <jobDirectory>', 'Job directory name (if not running from within job dir)')
  .option('-q, --query <queryString>', 'Query string to filter results (e.g. "status:any")')
  .option('-j, --shop <shopDomain>', 'Override the shop domain in the job config')
  .action(async (options) => {
    const jobName = await ensureAndResolveJobName(__dirname, null, options.dir, true);
    if (!jobName) return;
    await runJobTest(__dirname, jobName, options.query, options.shop);
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
  .command('remote-test [jobNameArg]')
  .description('Test a job by sending a POST request to the worker URL with a record ID')
  .option('-d, --dir <jobDirectory>', 'Job directory name (if not running from within job dir)')
  .option('-i, --id <recordId>', 'ID of the record to process (optional, will find a sample record if not provided)')
  .option('-q, --query <queryString>', 'Query string to filter results when automatically finding a record')
  .option('-w, --worker <workerUrl>', 'Cloudflare worker URL (overrides .shopworker.json)')
  .option('-j, --shop <shopDomain>', 'Override the shop domain in the job config')
  .action(async (jobNameArg, options) => {
    try {
      const jobName = await ensureAndResolveJobName(__dirname, jobNameArg, options.dir, true);
      if (!jobName) return;

      const workerUrl = getWorkerUrl(options, __dirname);
      if (!workerUrl) {
        console.error("Worker URL is required for remote testing. Please provide with -w or set cloudflare_worker_url in .shopworker.json.");
        return;
      }

      // Pass the workerUrl in the options
      options.worker = workerUrl;

      // Execute the remote test
      await runJobRemoteTest(__dirname, jobName, options);
    } catch (error) {
      console.error(`Error running remote test: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('delete-webhook')
  .description('Delete a webhook by its ID')
  .argument('<webhookId>', 'ID of the webhook to delete')
  .option('-j, --job <jobName>', 'Job name to use for API connection (will try to detect from current directory if not specified)')
  .action(async (webhookId, options) => {
    // Try to detect the job from the current directory if not provided
    let jobNameArg = options.job;
    if (!jobNameArg) {
      jobNameArg = detectJobDirectory(__dirname, null);
    }

    // Resolve the job name
    const resolvedJobName = await ensureAndResolveJobName(__dirname, jobNameArg, null, false);
    if (!resolvedJobName) {
      console.error('Error: Could not determine which job to use. Please specify with --job option or run from a job directory.');
      console.error('Example: shopworker delete-webhook 123456789 --job product-create');
      return;
    }

    console.log(`Using credentials from job '${resolvedJobName}' to delete webhook ID: ${webhookId}`);

    const success = await deleteWebhookById(__dirname, resolvedJobName, webhookId);
    if (success) {
      console.log('Webhook deletion completed successfully.');
    } else {
      console.error('Webhook deletion failed.');
      process.exit(1);
    }
  });

program.parse(process.argv);
