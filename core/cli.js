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
const projectRoot = path.dirname(__dirname);  // Get the parent directory as project root

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
  .option('-l, --limit <number>', 'Override the limit for the number of records to fetch (default: 1)', parseInt)
  .option('--dry-run [boolean]', 'Override the dry run setting in the job config (true/false)', (value) => {
    if (value === 'false') return false;
    if (value === 'true') return true;
    return value !== undefined ? true : undefined;
  })
  .action(async (jobNameArg, options) => {
    const jobName = await ensureAndResolveJobName(projectRoot, jobNameArg, options.dir, true);
    if (!jobName) return;
    await runJobTest(projectRoot, jobName, options);
  });

program
  .command('enable [jobNameArg]')
  .description('Enable a job by registering webhooks with Shopify after ensuring the latest code is deployed')
  .option('-d, --dir <jobDirectory>', 'Job directory name')
  .option('-w, --worker <workerUrl>', 'Cloudflare worker URL (overrides .shopworker.json)')
  .action(async (jobNameArg, options) => {
    const deploymentSuccessful = await handleCloudflareDeployment(projectRoot);
    if (!deploymentSuccessful) {
      console.error("Halting 'enable' command due to deployment issues.");
      return;
    }

    const jobName = await ensureAndResolveJobName(projectRoot, jobNameArg, options.dir, false);
    if (!jobName) return;

    const workerUrl = getWorkerUrl(options, projectRoot);
    if (!workerUrl) return;

    await enableJobWebhook(projectRoot, jobName, workerUrl);
  });

program
  .command('disable [jobNameArg]')
  .description('Disable a job by removing webhooks from Shopify')
  .option('-d, --dir <jobDirectory>', 'Job directory name')
  .option('-w, --worker <workerUrl>', 'Cloudflare worker URL (overrides .shopworker.json)')
  .action(async (jobNameArg, options) => {
    const jobName = await ensureAndResolveJobName(projectRoot, jobNameArg, options.dir, false);
    if (!jobName) return;

    const workerUrl = getWorkerUrl(options, projectRoot);
    if (!workerUrl) {
      console.error("Worker URL is required to accurately identify and disable webhooks. Please provide with -w or set cloudflare_worker_url in .shopworker.json.");
      return;
    }

    await disableJobWebhook(projectRoot, jobName, workerUrl);
  });

program
  .command('status [jobNameArg]')
  .description('Check the status of webhooks for a job or all jobs')
  .option('-d, --dir <jobDirectory>', 'Job directory name')
  .option('-a, --all', 'Show status of all jobs, ignoring current directory context')
  .action(async (jobNameArg, options) => {
    // Determine the actual working directory - when run via npm, INIT_CWD contains the real directory
    const actualWorkingDir = process.env.INIT_CWD || process.cwd();

    // If a specific job is specified, use that
    if (jobNameArg) {
      await handleSingleJobStatus(projectRoot, jobNameArg);
      return;
    }

    // If directory option is specified, use that
    if (options.dir) {
      const resolved = await ensureAndResolveJobName(projectRoot, null, options.dir, false);
      if (resolved) {
        await handleSingleJobStatus(projectRoot, resolved);
        return;
      }
    }

    // Otherwise, try to auto-detect current directory context
    const jobName = detectJobDirectory(projectRoot, null);
    if (jobName && !options.all) {
      // We detected a specific job directory
      await handleSingleJobStatus(projectRoot, jobName);
    } else {
      // We're not in a specific job directory, show filtered or all jobs
      const filterByCurrentDir = !options.all;

      // When filtering by current dir, explicitly pass the actual working directory
      if (filterByCurrentDir) {
        await handleAllJobsStatus(projectRoot, actualWorkingDir);
      } else {
        await handleAllJobsStatus(projectRoot, false);
      }
    }
  });

program
  .command('runtest')
  .description('Run test for the current job directory (or specified with -d)')
  .option('-d, --dir <jobDirectory>', 'Job directory name (if not running from within job dir)')
  .option('-q, --query <queryString>', 'Query string to filter results (e.g. "status:any")')
  .option('-j, --shop <shopDomain>', 'Override the shop domain in the job config')
  .option('-l, --limit <number>', 'Override the limit for the number of records to fetch (default: 1)', parseInt)
  .option('--dry-run [boolean]', 'Override the dry run setting in the job config (true/false)', (value) => {
    if (value === 'false') return false;
    if (value === 'true') return true;
    return value !== undefined ? true : undefined;
  })
  .action(async (options) => {
    const jobName = await ensureAndResolveJobName(projectRoot, null, options.dir, true);
    if (!jobName) return;
    await runJobTest(projectRoot, jobName, options);
  });

program
  .command('deploy')
  .description('Deploy the current state to Cloudflare and record the commit hash.')
  .action(async () => {
    console.log('Starting Cloudflare deployment process...');
    const success = await handleCloudflareDeployment(projectRoot);
    if (success) {
      console.log('Deployment process completed successfully.');
    } else {
      console.error('Deployment process failed.');
    }
  });

program
  .command('put-secrets')
  .description('Save .shopworker.json and all files from .secrets directory as Cloudflare secrets')
  .action(async () => {
    console.log('Setting up Cloudflare secrets...');
    const { execSync } = await import('child_process');

    // 1. Handle .shopworker.json
    const shopworkerPath = path.join(projectRoot, '.shopworker.json');
    if (!fs.existsSync(shopworkerPath)) {
      console.error('Error: .shopworker.json file not found.');
    } else {
      try {
        // Read the file
        const fileContent = fs.readFileSync(shopworkerPath, 'utf8');
        const configData = JSON.parse(fileContent);

        // Stringify the content for the secret
        const stringifiedContent = JSON.stringify(configData);

        // Create a temporary file with the config
        const tempFile = path.join(projectRoot, '.temp_config.json');
        fs.writeFileSync(tempFile, stringifiedContent, 'utf8');

        try {
          // Use the file content as input to wrangler
          console.log('Uploading SHOPWORKER_CONFIG secret...');
          execSync(`cat ${tempFile} | npx wrangler secret put SHOPWORKER_CONFIG`,
            { stdio: 'inherit', encoding: 'utf8' });

          console.log('Successfully saved .shopworker.json as SHOPWORKER_CONFIG secret.');
        } catch (error) {
          console.error('Error uploading SHOPWORKER_CONFIG secret:', error.message);
        } finally {
          // Clean up temporary file
          if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
          }
        }
      } catch (error) {
        console.error('Error processing .shopworker.json:', error.message);
      }
    }

    // 2. Handle secrets from .secrets directory
    const secretsDir = path.join(projectRoot, '.secrets');
    if (!fs.existsSync(secretsDir)) {
      console.log('Note: .secrets directory not found. No additional secrets uploaded.');
    } else {
      try {
        // Get all files in the .secrets directory
        const files = fs.readdirSync(secretsDir);

        if (files.length === 0) {
          console.log('No secret files found in .secrets directory.');
        } else {
          console.log(`\nUploading ${files.length} secrets from .secrets directory...`);

          // Process each file in the directory
          for (const file of files) {
            const filePath = path.join(secretsDir, file);

            // Skip directories
            if (fs.statSync(filePath).isDirectory()) {
              continue;
            }

            // Get key by removing the file extension
            const secretKey = path.parse(file).name;
            // Add SECRET_ prefix for the Cloudflare variable name
            const envVarName = `SECRET_${secretKey}`;

            // Read the file
            const content = fs.readFileSync(filePath, 'utf8');

            // Create a temporary file with the content
            const tempFile = path.join(projectRoot, `.temp_secret_${secretKey}`);
            fs.writeFileSync(tempFile, content, 'utf8');

            try {
              // Use the file content as input to wrangler
              console.log(`Uploading secret: ${envVarName}`);
              execSync(`cat ${tempFile} | npx wrangler secret put ${envVarName}`,
                { stdio: 'inherit', encoding: 'utf8' });

              console.log(`Successfully saved ${file} as ${envVarName} secret.`);
            } catch (error) {
              console.error(`Error uploading secret ${envVarName}:`, error.message);
            } finally {
              // Clean up temporary file
              if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
              }
            }
          }
        }
      } catch (error) {
        console.error('Error processing secrets from .secrets directory:', error.message);
      }
    }

    console.log('\nSecret upload process completed.');
  });

program
  .command('remote-test [jobNameArg]')
  .description('Test a job by sending a POST request to the worker URL with a record ID')
  .option('-d, --dir <jobDirectory>', 'Job directory name (if not running from within job dir)')
  .option('-i, --id <recordId>', 'ID of the record to process (optional, will find a sample record if not provided)')
  .option('-q, --query <queryString>', 'Query string to filter results when automatically finding a record')
  .option('-w, --worker <workerUrl>', 'Cloudflare worker URL (overrides .shopworker.json)')
  .option('-j, --shop <shopDomain>', 'Override the shop domain in the job config')
  .option('-l, --limit <number>', 'Override the limit for the number of records to fetch (default: 1)', parseInt)
  .option('-b, --batch-size <number>', 'Override the batch size for the number of records to fetch (default: 50)', parseInt)
  .action(async (jobNameArg, options) => {
    try {
      const jobName = await ensureAndResolveJobName(projectRoot, jobNameArg, options.dir, true);
      if (!jobName) return;

      const workerUrl = getWorkerUrl(options, projectRoot);
      if (!workerUrl) {
        console.error("Worker URL is required for remote testing. Please provide with -w or set cloudflare_worker_url in .shopworker.json.");
        return;
      }

      // Pass the workerUrl in the options
      options.worker = workerUrl;

      // Execute the remote test
      await runJobRemoteTest(projectRoot, jobName, options);
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
      jobNameArg = detectJobDirectory(projectRoot, null);
    }

    // Resolve the job name
    const resolvedJobName = await ensureAndResolveJobName(projectRoot, jobNameArg, null, false);
    if (!resolvedJobName) {
      console.error('Error: Could not determine which job to use. Please specify with --job option or run from a job directory.');
      console.error('Example: shopworker delete-webhook 123456789 --job product-create');
      return;
    }

    console.log(`Using credentials from job '${resolvedJobName}' to delete webhook ID: ${webhookId}`);

    const success = await deleteWebhookById(projectRoot, resolvedJobName, webhookId);
    if (success) {
      console.log('Webhook deletion completed successfully.');
    } else {
      console.error('Webhook deletion failed.');
      process.exit(1);
    }
  });

program.parse(process.argv);
