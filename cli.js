#!/usr/bin/env node

import dotenv from 'dotenv';
import { Command } from 'commander';
import Shopify from 'shopify-api-node';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

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
      accessToken: process.env.SHOPIFY_ACCESS_TOKEN
    });
  } catch (error) {
    console.error('Failed to initialize Shopify API:', error);
    process.exit(1);
  }
}

/**
 * Load a job configuration file
 * @param {string} jobName - The name of the job
 * @returns {Object} The job configuration
 */
function loadJobConfig(jobName) {
  const configPath = path.join(__dirname, 'jobs', jobName, 'config.json');
  try {
    const configData = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    console.error(`Error loading job config for ${jobName}:`, error);
    process.exit(1);
  }
}

/**
 * Load a trigger configuration file
 * @param {string} triggerName - The name of the trigger
 * @returns {Object} The trigger configuration
 */
function loadTriggerConfig(triggerName) {
  const triggerPath = path.join(__dirname, 'triggers', `${triggerName}.json`);
  try {
    const triggerData = fs.readFileSync(triggerPath, 'utf8');
    return JSON.parse(triggerData);
  } catch (error) {
    console.error(`Error loading trigger config for ${triggerName}:`, error);
    process.exit(1);
  }
}

/**
 * Load a GraphQL query from a file
 * @param {string} queryFileName - The filename of the GraphQL query
 * @returns {string} The GraphQL query
 */
function loadGraphqlQuery(queryFileName) {
  const queryPath = path.join(__dirname, 'graphql', queryFileName);
  try {
    return fs.readFileSync(queryPath, 'utf8');
  } catch (error) {
    console.error(`Error loading GraphQL query from ${queryFileName}:`, error);
    process.exit(1);
  }
}

/**
 * Detect if we're running from a job directory and return job name
 * @returns {string|null} The job name or null if not in a job directory
 */
function detectJobFromDirectory() {
  const cwd = process.cwd();

  // Check if we're in a job directory
  const cwdParts = cwd.split(path.sep);
  const currentDir = cwdParts[cwdParts.length - 1];

  // Check explicitly if the current directory is a job directory
  const jobsDir = path.join(__dirname, 'jobs');
  const possibleJobDirs = fs.readdirSync(jobsDir)
    .filter(dir => fs.statSync(path.join(jobsDir, dir)).isDirectory());

  if (possibleJobDirs.includes(currentDir)) {
    return currentDir;
  }

  // Extract the last directory name from the path
  const dirName = path.basename(cwd);

  // Check if there's a config.json file in this directory
  const configPath = path.join(cwd, 'config.json');
  if (fs.existsSync(configPath)) {
    // Verify this is indeed a job directory by checking if it exists in the jobs directory
    const jobPath = path.join(__dirname, 'jobs', dirName);
    if (fs.existsSync(jobPath)) {
      return dirName;
    }
  }

  // Check if we're in a job subdirectory within the jobs directory
  const relPath = path.relative(jobsDir, cwd);
  if (!relPath.startsWith('..') && relPath !== '') {
    // We're somewhere in the jobs directory
    const jobName = relPath.split(path.sep)[0];
    return jobName;
  }

  return null;
}

/**
 * Get the job name from the process arguments
 */
function getJobNameFromArgs() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === '--dir' || args[i] === '-d') {
      return args[i + 1];
    }
  }
  return null;
}

/**
 * Run a test for a specific job
 */
async function runJobTest(jobName, resourceId = '6690480947386') {
  try {
    console.log(`Testing job ${jobName} with resource ID ${resourceId}...`);

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

    // Load GraphQL query
    const query = loadGraphqlQuery(triggerConfig.test.query);

    // Add gid format if needed
    let formattedId = resourceId;
    if (!resourceId.startsWith('gid://')) {
      formattedId = `gid://shopify/Order/${resourceId}`;
    }

    // Execute GraphQL query
    const response = await shopify.graphql(query, { id: formattedId });

    if (!response.order) {
      console.error(`Order ${resourceId} not found`);
      return;
    }

    const order = response.order;
    console.log(`Order ${order.name} found, processing...`);

    // Dynamically import the job module
    const jobModule = await import(`./jobs/${jobName}/job.js`);

    // Pass order to job handler
    await jobModule.process(order, shopify);

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
  .command('test [jobName] [resourceId]')
  .description('Test a job with a specific resource ID')
  .option('-r, --resource <resourceId>', 'Resource ID to use for testing')
  .option('-d, --dir <jobDirectory>', 'Job directory name (used when npm script is run from project root)')
  .action(async (jobName, resourceId, options) => {
    // If jobName is not provided, try to get it from options or detect from directory
    if (!jobName) {
      // Check if a directory was specified in options
      if (options.dir) {
        jobName = options.dir;
        console.log(`Using job from --dir option: ${jobName}`);
      } else {
        // Try to detect from directory
        jobName = detectJobFromDirectory();
        if (!jobName) {
          console.error('Job name not provided and not in a job directory');
          console.log('Try running this command from within a job directory');
          return;
        }
        console.log(`Detected job name from directory: ${jobName}`);
      }
    }

    // If resourceId is not provided, check options or use a default
    if (!resourceId) {
      resourceId = options.resource || '6690480947386';
      console.log(`Using resource ID: ${resourceId}`);
    }

    await runJobTest(jobName, resourceId);
  });

// Add a test command that can be run from within a job directory
program
  .command('runtest [resourceId]')
  .description('Run test for the current job directory')
  .option('-d, --dir <jobDirectory>', 'Job directory name (used when npm script is run from project root)')
  .option('--source-dir <sourceDirectory>', 'Source directory from where the command was run (used by npm test)')
  .action(async (resourceId, options) => {
    let jobName;

    // Check if a directory was specified directly
    if (options.dir) {
      jobName = options.dir;
      console.log(`Using job from --dir option: ${jobName}`);
    }
    // Check if source directory was provided and use it to determine the job
    else if (options.sourceDir) {
      const sourceDir = options.sourceDir;
      console.log(`Using source directory: ${sourceDir}`);

      // Extract the last part of the path
      const sourceDirName = path.basename(sourceDir);
      console.log(`Source directory name: ${sourceDirName}`);

      // Check if this is a job directory by checking if it exists in jobs/
      const jobsDir = path.join(__dirname, 'jobs');
      const possibleJobDirs = fs.readdirSync(jobsDir)
        .filter(dir => fs.statSync(path.join(jobsDir, dir)).isDirectory());

      if (possibleJobDirs.includes(sourceDirName)) {
        jobName = sourceDirName;
        console.log(`Found job from source directory: ${jobName}`);
      } else {
        // Check if we're in a job's subdirectory by comparing paths
        const relPath = path.relative(jobsDir, sourceDir);
        if (!relPath.startsWith('..') && relPath !== '') {
          jobName = relPath.split(path.sep)[0];
          console.log(`Found job from relative path: ${jobName}`);
        }
      }
    }
    // Fall back to detecting from the current directory
    else {
      jobName = detectJobFromDirectory();
    }

    // If we still don't have a job name, show available options
    if (!jobName) {
      const jobsDir = path.join(__dirname, 'jobs');

      // Check if we can see the jobs directory
      if (fs.existsSync(jobsDir)) {
        const jobDirs = fs.readdirSync(jobsDir)
          .filter(dir => fs.statSync(path.join(jobsDir, dir)).isDirectory());

        if (jobDirs.length === 1) {
          // If there's only one job, use it automatically
          jobName = jobDirs[0];
          console.log(`Only one job available, using: ${jobName}`);
        } else {
          // Otherwise, show the available jobs
          console.error('Not in a job directory. Please specify a job with --dir option:');
          console.error('Available jobs:');
          jobDirs.forEach(dir => console.error(`  ${dir}`));
          console.error('Usage: npm test -- --dir=job-name');

          // Or run from within the job directory:
          console.error('');
          console.error('Or run from within the job directory:');
          console.error(`  cd jobs/JOBNAME && npm test`);
          return;
        }
      } else {
        console.error('Not in a job directory and jobs directory not found.');
        return;
      }
    }

    // Call the runJobTest function with the detected job name
    await runJobTest(jobName, resourceId);
  });

program.parse(process.argv);
