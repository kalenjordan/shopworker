#!/usr/bin/env node

import dotenv from 'dotenv';
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

// Load environment variables
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  // .env is optional since we primarily use .shopworker.json for configuration
  // However, .env might still be used for other things like CLOUDFLARE_WORKER_URL
}

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
  .option('-w, --worker <workerUrl>', 'Cloudflare worker URL (overrides .env or .shopworker.json)')
  .action(async (jobNameArg, options) => {
    const deploymentSuccessful = await handleCloudflareDeployment(__dirname);
    if (!deploymentSuccessful) {
      console.error("Halting 'enable' command due to deployment issues.");
      return;
    }

    const jobName = await ensureAndResolveJobName(__dirname, jobNameArg, options.dir, false);
    if (!jobName) return;

    const workerUrl = getWorkerUrl(options);
    if (!workerUrl) return;

    await enableJobWebhook(__dirname, jobName, workerUrl);
  });

program
  .command('disable [jobNameArg]')
  .description('Disable a job by removing webhooks from Shopify')
  .option('-d, --dir <jobDirectory>', 'Job directory name')
  .option('-w, --worker <workerUrl>', 'Cloudflare worker URL (overrides .env or .shopworker.json)')
  .action(async (jobNameArg, options) => {
    const jobName = await ensureAndResolveJobName(__dirname, jobNameArg, options.dir, false);
    if (!jobName) return;

    const workerUrl = getWorkerUrl(options);
    if (!workerUrl) {
      console.error("Worker URL is required to accurately identify and disable webhooks. Please provide with -w or set CLOUDFLARE_WORKER_URL.");
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

program.parse(process.argv);
