import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { sendEmail, validateCredentials } from '../connectors/resend.js';
import { isWorkerEnvironment } from '../shared/env.js';

/**
 * Parse command-line parameters from various formats
 * Supports: JSON, URL query string format (key=value&key=value), or single key=value
 * @param {string} params - Parameter string from command line
 * @returns {Object} Parsed parameters object
 */
function parseParams(params) {
  if (params.startsWith('{')) {
    return parseJsonParams(params);
  }
  return parseKeyValueParams(params);
}

/**
 * Parse JSON format parameters
 * @param {string} params - JSON string
 * @returns {Object} Parsed JSON object
 */
function parseJsonParams(params) {
  try {
    return JSON.parse(params);
  } catch (e) {
    // If JSON parsing fails, try key-value parsing as fallback
    return parseKeyValueParams(params);
  }
}

/**
 * Parse key=value format parameters
 * @param {string} params - Key-value pairs string
 * @returns {Object} Parsed parameters object
 */
function parseKeyValueParams(params) {
  const pairs = params.includes('&') ? params.split('&') : [params];
  const result = {};
  
  for (const pair of pairs) {
    const [key, ...valueParts] = pair.trim().split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('='); // Handle values with = in them
      result[key] = parseParamValue(value);
    }
  }
  
  return result;
}

/**
 * Parse a parameter value, attempting JSON parse first
 * @param {string} value - The value to parse
 * @returns {*} Parsed value or original string
 */
function parseParamValue(value) {
  try {
    return JSON.parse(value);
  } catch (e) {
    return value; // Return as string if not valid JSON
  }
}
import chalk from 'chalk';
import { loadJobConfig, loadTriggerConfig } from './job-discovery.js';
import { initShopify } from '../shared/shopify.js';
import { getShopConfig, loadSecrets } from '../shared/config-helpers.js';

/**
 * Display a webrequest response in appropriate format
 * @param {Object} result - The job result to display
 */
function displayWebrequestResponse(result) {
  console.log(chalk.green('\n📤 Webrequest Response:'));
  
  const isTextResponse = result.headers?.['Content-Type'] === 'text/plain';
  
  if (isTextResponse) {
    displayTextResponse(result);
  } else {
    displayJsonResponse(result);
  }
}

/**
 * Display a text response with formatting
 * @param {Object} result - The job result with text body
 */
function displayTextResponse(result) {
  console.log(chalk.gray('Status:'), result.statusCode);
  console.log(chalk.gray('Content-Type:'), 'text/plain');
  console.log(chalk.gray('\n--- Response Body ---\n'));
  console.log(result.body);
  console.log(chalk.gray('\n--- End Response ---'));
}

/**
 * Display a JSON response with formatting
 * @param {Object} result - The job result to display as JSON
 */
function displayJsonResponse(result) {
  console.log(JSON.stringify(result, null, 2));
}

/**
 * Find a sample record for testing a job
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} jobPath - The job path relative to jobs/
 * @param {Object} options - Options object containing query, shop, params, etc.
 * @returns {Promise<{record: Object, recordName: string, shopify: Object, triggerConfig: Object, jobConfig: Object}>}
 * The sample record and related configuration
 */
export async function findSampleRecordForJob(cliDirname, jobPath, options = {}) {
  const { query: queryParam, shop: shopParam } = options;
  const jobConfig = await loadJobConfig(jobPath);
  if (!jobConfig.trigger) {
    throw new Error(`Job ${jobPath} doesn't have a trigger defined`);
  }
  const triggerConfig = loadTriggerConfig(jobConfig.trigger);

  // If shopParam is provided, create a copy of jobConfig with the shop override
  let configToUse = jobConfig;
  if (shopParam) {
    // Find shop by domain in shopworker.json
    const shopworkerFilePath = path.join(cliDirname, '.shopworker.json');
    const shopworkerData = JSON.parse(fs.readFileSync(shopworkerFilePath, 'utf8'));
    const shopConfig = shopworkerData.shops.find(s => s.shopify_domain === shopParam || s.name === shopParam);
    if (!shopConfig) {
      throw new Error(`Shop with domain or name '${shopParam}' not found in .shopworker.json.`);
    }
    // Create a copy of jobConfig with overridden shop
    configToUse = { ...jobConfig, shop: shopConfig.name };
    console.log(chalk.yellow(`Overriding shop with: ${shopConfig.name} (${shopConfig.shopify_domain})`));
  }

  const shopify = await initShopify(cliDirname, jobPath, shopParam);

  if (jobConfig.trigger === 'manual') {
    return {
      record: {},
      recordName: 'manual-trigger',
      shopify,
      triggerConfig,
      jobConfig: configToUse
    };
  }

  // Handle webrequest triggers with test payloads
  if (jobConfig.trigger === 'webrequest') {
    let record = {};
    
    // Check if test configuration exists and file is present
    if (jobConfig.test && jobConfig.test.webhookPayload) {
      const payloadPath = path.resolve(cliDirname, jobPath, jobConfig.test.webhookPayload);
      
      if (fs.existsSync(payloadPath)) {
        console.log("Loading webrequest payload from fixtures...");
        console.log(`Using webrequest payload from: ${jobConfig.test.webhookPayload}`);
        try {
          const payloadContent = fs.readFileSync(payloadPath, 'utf8');
          record = JSON.parse(payloadContent);
        } catch (error) {
          throw new Error(`Failed to load webrequest payload from ${payloadPath}: ${error.message}`);
        }
      } else if (!options.params) {
        // Only warn if no params provided via CLI
        console.log(chalk.yellow(`Warning: Webrequest payload file not found: ${payloadPath}`));
        console.log(chalk.yellow('Using empty payload. Provide parameters via --params flag.'));
      }
    } else if (!options.params) {
      console.log(chalk.yellow('No test payload configured. Using empty payload.'));
      console.log(chalk.yellow('Provide parameters via --params flag.'));
    }
    
    // Apply command-line parameter overrides if provided
    if (options.params) {
      const paramOverrides = parseParams(options.params);
      record = { ...record, ...paramOverrides };
      console.log(chalk.yellow('Applied parameter overrides:'), paramOverrides);
    }
    
    const recordName = `webrequest-payload`;
    return {
      record,
      recordName,
      shopify,
      triggerConfig,
      jobConfig: configToUse
    };
  }

  // Check if this is a webhook job and validate required test configuration
  if (jobConfig.trigger === 'webhook') {
    if (!jobConfig.test) {
      throw new Error(`Job ${jobPath} has trigger 'webhook' but is missing 'test' configuration in config.json`);
    }
    if (!jobConfig.test.webhookPayload || typeof jobConfig.test.webhookPayload !== 'string') {
      throw new Error(`Job ${jobPath} has trigger 'webhook' but is missing 'test.webhookPayload' file path in config.json`);
    }
  }

  // Check if this is a webhook payload test
  if (jobConfig.trigger === 'webhook' && jobConfig.test && jobConfig.test.webhookPayload) {
    console.log("Loading webhook payload from fixtures...");
    // Use the path specified in jobConfig.test.webhookPayload, relative to the job directory
    const payloadPath = path.resolve(cliDirname, jobPath, jobConfig.test.webhookPayload);
    if (!fs.existsSync(payloadPath)) {
      throw new Error(`Webhook payload file not found: ${payloadPath}. Please ensure the file exists at the path specified in config.json.`);
    }
    console.log(`Using webhook payload from: ${jobConfig.test.webhookPayload}`);
    try {
      const payloadContent = fs.readFileSync(payloadPath, 'utf8');
      let record = JSON.parse(payloadContent);

      // Apply command-line parameter overrides if provided
      if (options.params) {
        const paramOverrides = parseParams(options.params);
        record = { ...record, ...paramOverrides };
        console.log(chalk.yellow('Applied parameter overrides:'), paramOverrides);
      }

      const recordName = `webhook-payload-${path.basename(payloadPath)}`;
      return {
        record,
        recordName,
        shopify,
        triggerConfig,
        jobConfig: configToUse
      };
    } catch (error) {
      throw new Error(`Failed to load webhook payload from ${payloadPath}: ${error.message}`);
    }
  }

  // Check if this is a scheduled job test
  if (jobConfig.trigger === 'schedule') {
    console.log("Testing scheduled job...");
    // Create a synthetic payload similar to what the scheduled handler would provide
    const record = {
      scheduledTime: new Date().toISOString(),
      cron: jobConfig.schedule || '* * * * *'
    };

    // Apply command-line parameter overrides if provided
    if (options.params) {
      const paramOverrides = parseParams(options.params);
      Object.assign(record, paramOverrides);
      console.log(chalk.yellow('Applied parameter overrides:'), paramOverrides);
    }

    const recordName = `schedule-test-${jobConfig.schedule || 'default'}`;
    return {
      record,
      recordName,
      shopify,
      triggerConfig,
      jobConfig: configToUse
    };
  }

  if (!triggerConfig.test || !triggerConfig.test.query) {
    throw new Error(`Trigger ${jobConfig.trigger} doesn't have a test query defined`);
  }

  const queryModulePath = pathToFileURL(path.resolve(cliDirname, `core/graphql/${triggerConfig.test.query}.js`)).href;
  const queryModule = await import(queryModulePath);
  const query = queryModule.default;

  console.log("Populating sample record into job from CLI...");
  const variables = { first: 1 };
  if (queryParam) {
    console.log(`Using query filter: ${queryParam}`);
    variables.query = queryParam;
  }

  const response = await shopify.graphql(query, variables);

  const topLevelKey = Object.keys(response).find(key =>
    response[key] && typeof response[key] === 'object' && response[key].edges
  );

  if (!topLevelKey || !response[topLevelKey].edges || response[topLevelKey].edges.length === 0) {
    throw new Error(`No ${topLevelKey || 'data'} found in response for job ${jobPath}. Query: ${triggerConfig.test.query}`);
  }

  const record = response[topLevelKey].edges[0].node;
  const recordName = record.name || record.title || record.id;

  return {
    record,
    recordName,
    shopify,
    topLevelKey,
    triggerConfig,
    jobConfig: configToUse
  };
}

/**
 * Run a test for a specific job
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} jobPath - The job path relative to jobs/
 * @param {Object} options - CLI options object containing query, shop, limit, dryRun, etc.
 */
export async function runJobTest(cliDirname, jobPath, options) {
  const { record, recordName, shopify, topLevelKey, jobConfig } = await findSampleRecordForJob(cliDirname, jobPath, options);

  // Start with the base job config
  let configToUse = jobConfig;

  // Override the limit in job config if provided
  if (options.limit && options.limit >= 1) {
    configToUse = {
      ...configToUse,
      test: {
        ...configToUse.test,
        limit: options.limit
      }
    };
    console.log(chalk.yellow(`Overriding job config limit with: ${options.limit}`));
  }

  // Override the dryRun in job config if provided
  if (options.dryRun !== undefined) {
    configToUse = {
      ...configToUse,
      test: {
        ...configToUse.test,
        dryRun: options.dryRun
      }
    };
    console.log(chalk.yellow(`Overriding job config dryRun with: ${options.dryRun}`));
  }

  // Get shop configuration from .shopworker.json
  const shopConfig = getShopConfig(cliDirname, configToUse.shop);

  // Load secrets from .secrets directory
  const secrets = loadSecrets(cliDirname);

  // Log shop domain in purple using chalk
  console.log(chalk.magenta(`Processing for shop: ${shopConfig.shopify_domain}`));

  // Use path.resolve with pathToFileURL to ensure proper module resolution
  // Clean the job path (remove local/jobs or core/jobs prefix if present)
  const cleanJobPath = jobPath.replace(/^(local|core)\/jobs\//, '');
  
  // First try local jobs directory
  let jobModulePath = path.resolve(cliDirname, 'local', 'jobs', cleanJobPath, 'job.js');

  if (!fs.existsSync(jobModulePath)) {
    // If not found in local, try core jobs directory
    jobModulePath = path.resolve(cliDirname, 'core', 'jobs', cleanJobPath, 'job.js');
  }
  
  // If still not found, maybe the path already includes local/jobs or core/jobs
  if (!fs.existsSync(jobModulePath)) {
    jobModulePath = path.resolve(cliDirname, jobPath, 'job.js');
  }

  const jobModule = await import(pathToFileURL(jobModulePath).href);

  // Create a mock step object for CLI execution
  const step = {
    do: async (name, optionsOrCallback, callbackIfOptions) => {
      // Handle both signatures: (name, callback) and (name, options, callback)
      const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : callbackIfOptions;
      const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;

      // Log step name with retry info if configured
      if (options.retries) {
        console.log(chalk.blue(`→ Step: ${name} (with ${options.retries.limit} retries)`));
      } else {
        console.log(chalk.blue(`→ Step: ${name}`));
      }

      // Store original console.log to restore later
      const originalConsoleLog = console.log;
      
      // Override console.log to add indentation during step execution
      console.log = (...args) => {
        originalConsoleLog('  ', ...args);
      };
      
      try {
        const result = await callback();
        // Restore original console.log before logging step completion
        console.log = originalConsoleLog;

        // Display the JSON response in gray if there is a result
        if (result !== undefined) {
          const compactJson = JSON.stringify(result);
          if (compactJson.length > 400) {
            // For very long responses, truncate to 150 characters
            const truncated = compactJson.substring(0, 147) + '...';
            console.log('  ' + chalk.gray(truncated));
          } else {
            // For responses under 400 chars, show formatted JSON with indentation
            const jsonString = JSON.stringify(result, null, 2);
            const indentedJson = jsonString.split('\n').map(line => '  ' + line).join('\n');
            console.log(chalk.gray(indentedJson));
          }
        }

        console.log(chalk.green(`✓ Step completed: ${name}`));
        return result;
      } catch (error) {
        // Restore original console.log before logging step failure
        console.log = originalConsoleLog;
        console.log(chalk.red(`✗ Step failed: ${name}`));
        throw error;
      }
    }
  };

  // Pass process.env as env, shopConfig as shopConfig, and secrets for consistency with worker environment
  const jobParams = {
    payload: record,
    shopify: shopify,
    env: process.env,   // Pass Node.js process.env as env
    shopConfig: shopConfig,  // Pass shopConfig separately
    jobConfig: configToUse,  // Pass the job config (with potential overrides) to the process function
    secrets: secrets,    // Pass secrets to the process function
  };

  // Only add step parameter for non-webrequest jobs
  if (jobConfig.trigger !== 'webrequest') {
    jobParams.step = step;
  }

  try {
    const result = await jobModule.process(jobParams);

    // For webrequest jobs, show the response that would be returned
    if (jobConfig.trigger === 'webrequest') {
      displayWebrequestResponse(result);
    }

    console.log('Processing complete!');
  } catch (error) {
    console.log(chalk.red('\n✗ Job failed with error:'));
    console.log(chalk.red(`  ${error.message}`));
    if (error.stack) {
      console.log(chalk.gray('\nStack trace:'));
      console.log(chalk.gray(error.stack));
    }

    // Send error notification email if configured
    const shouldSendErrorEmail = configToUse.send_email !== false;

    if (shouldSendErrorEmail && shopConfig.resend_api_key) {
      try {
        validateCredentials({ resend_api_key: shopConfig.resend_api_key });

        const timestamp = new Date().toLocaleString('en-US', {
          timeZone: 'America/Chicago',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZoneName: 'short'
        });

        const errorEmail = {
          to: configToUse.email_to || ['kalenj@gmail.com'],
          from: configToUse.email_from || 'ShopWorker <worker@shopworker.dev>',
          subject: `❌ Job Failed: ${configToUse.title || jobPath} - ${shopConfig.shopify_domain} - ${timestamp}`,
          html: `
            <h2>Job Execution Failed</h2>
            <p><strong>Job:</strong> ${configToUse.title || jobPath}</p>
            <p><strong>Error:</strong> ${error.message}</p>
            <p><strong>Shop:</strong> ${shopConfig.shopify_domain}</p>
            <p><strong>Environment:</strong> CLI Test</p>
            <p><strong>Time:</strong> ${timestamp}</p>
            <h3>Stack Trace:</h3>
            <pre style="background: #f5f5f5; padding: 10px; border-radius: 4px;">${error.stack}</pre>
          `,
          text: `Job Execution Failed\n\nJob: ${configToUse.title || jobPath}\nError: ${error.message}\nShop: ${shopConfig.shopify_domain}\nTime: ${timestamp}\n\nStack:\n${error.stack}`
        };

        await sendEmail(errorEmail, shopConfig.resend_api_key);
        console.log(chalk.green(`\n✓ Error notification email sent to ${errorEmail.to} - Subject: "${errorEmail.subject}"`));
      } catch (emailError) {
        console.log(chalk.yellow(`\n⚠ Failed to send error notification email: ${emailError.message}`));
      }
    }

    throw error; // Re-throw to maintain exit code behavior
  }
}
