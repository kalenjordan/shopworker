import fs from 'fs';
import path from 'path';
import { createShopifyClient } from './shopify-client.js';

/**
 * Initialize Shopify API client for a specific job
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} jobName - The job name
 * @returns {Object} The Shopify client
 */
export function initShopify(cliDirname, jobName) {
  try {
    if (!jobName) {
      throw new Error('jobName is required to initialize Shopify client.');
    }

    const jobConfigPath = path.join(cliDirname, 'jobs', jobName, 'config.json');
    if (!fs.existsSync(jobConfigPath)) {
      throw new Error(`Job configuration file not found: ${jobConfigPath}`);
    }
    const jobConfigFile = fs.readFileSync(jobConfigPath, 'utf8');
    const jobConfig = JSON.parse(jobConfigFile);

    const shopIdentifier = jobConfig.shop;
    if (!shopIdentifier) {
      throw new Error(`'shop' not defined in job configuration: ${jobConfigPath}`);
    }

    const shopworkerFilePath = path.join(cliDirname, '.shopworker.json');
    if (!fs.existsSync(shopworkerFilePath)) {
      throw new Error('.shopworker.json file not found. Please create one.');
    }
    const shopworkerFileContent = fs.readFileSync(shopworkerFilePath, 'utf8');
    const shopworkerData = JSON.parse(shopworkerFileContent);

    if (!shopworkerData.shops || !Array.isArray(shopworkerData.shops)) {
      throw new Error('Invalid .shopworker.json format: "shops" array is missing or not an array.');
    }

    const shopDetails = shopworkerData.shops.find(s => s.name === shopIdentifier);
    if (!shopDetails) {
      throw new Error(`Shop configuration for '${shopIdentifier}' not found in .shopworker.json.`);
    }

    const shopDomain = shopDetails.shopify_domain;
    const accessToken = shopDetails.shopify_token;

    if (!shopDomain) {
      throw new Error(`'shopify_domain' not set for shop '${shopIdentifier}' in .shopworker.json`);
    }
    if (!accessToken) {
      throw new Error(`'shopify_token' not set for shop '${shopIdentifier}' in .shopworker.json`);
    }

    return createShopifyClient({
      shopDomain,
      accessToken,
      apiVersion: '2025-04' // Consider making this configurable
    });
  } catch (error) {
    console.error(`Failed to initialize Shopify API for job '${jobName}': ${error.message}`);
    if (error.cause) console.error('Cause:', error.cause);
    process.exit(1); // Critical failure
  }
}
