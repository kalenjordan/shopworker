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
import { runJobTest } from './utils/job-executor.js';
import { handleCloudflareDeployment } from './utils/deployment-manager.js';
import {
  handleAllJobsStatus,
  handleSingleJobStatus,
  enableJobWebhook,
  disableJobWebhook
} from './utils/webhook-handlers.js';

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

program.parse(process.argv);
