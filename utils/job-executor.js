import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { loadJobConfig, loadTriggerConfig } from './job-loader.js';
import { initShopify } from './shopify-api-helpers.js';

/**
 * Get shop configuration from .shopworker.json
 * @param {string} cliDirname - The directory where cli.js is located
 * @param {string} shopName - The shop name from job config
 * @returns {Object} The shop configuration
 */
function getShopConfig(cliDirname, shopName) {
  const shopworkerFilePath = path.join(cliDirname, '.shopworker.json');
  if (!fs.existsSync(shopworkerFilePath)) {
    throw new Error('.shopworker.json file not found. Please create one.');
  }

  const shopworkerFileContent = fs.readFileSync(shopworkerFilePath, 'utf8');
  const shopworkerData = JSON.parse(shopworkerFileContent);

  if (!shopworkerData.shops || !Array.isArray(shopworkerData.shops)) {
    throw new Error('Invalid .shopworker.json format: "shops" array is missing or not an array.');
  }

  const shopConfig = shopworkerData.shops.find(s => s.name === shopName);
  if (!shopConfig) {
    throw new Error(`Shop configuration for '${shopName}' not found in .shopworker.json.`);
  }

  return shopConfig;
}

/**
 * Run a test for a specific job
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} jobName - The job name
 * @param {string} queryParam - Optional query parameter for filtering results
 */
export async function runJobTest(cliDirname, jobName, queryParam) {
  const jobConfig = loadJobConfig(jobName);
  if (!jobConfig.trigger) {
    console.error(`Job ${jobName} doesn't have a trigger defined`);
    return;
  }

  const triggerConfig = loadTriggerConfig(jobConfig.trigger);
  const shopify = initShopify(cliDirname, jobName);

  // Get shop configuration from .shopworker.json
  const shopConfig = getShopConfig(cliDirname, jobConfig.shop);

  // Use path.resolve with pathToFileURL to ensure proper module resolution
  const jobModulePath = pathToFileURL(path.resolve(cliDirname, `jobs/${jobName}/job.js`)).href;
  const jobModule = await import(jobModulePath);

  if (triggerConfig.test && triggerConfig.test.skipQuery) {
    console.log(`Manual trigger detected for job: ${jobName}. Running without query.`);
    await jobModule.process({ record: {}, shopify: shopify, env: shopConfig });
    console.log('Processing complete!');
    return;
  }

  if (!triggerConfig.test || !triggerConfig.test.query) {
    console.error(`Trigger ${jobConfig.trigger} doesn't have a test query defined`);
    return;
  }

  const queryModulePath = pathToFileURL(path.resolve(cliDirname, `graphql/${triggerConfig.test.query}.js`)).href;
  const queryModule = await import(queryModulePath);
  const query = queryModule.default;

  console.log("Fetching most recent data...");
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
    console.error(`No ${topLevelKey || 'data'} found in response for job ${jobName}. Query: ${triggerConfig.test.query}`);
    return;
  }

  const record = response[topLevelKey].edges[0].node;
  const recordName = record.name || record.title || record.id;
  console.log(`Processing ${topLevelKey.replace(/s$/, '')} ${recordName} for job ${jobName}...`);
  await jobModule.process({ record, shopify: shopify, env: shopConfig });
  console.log('Processing complete!');
}
