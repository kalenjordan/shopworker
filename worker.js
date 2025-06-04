/**
 * Cloudflare Worker entry point for Shopify webhooks
 */

import { createShopifyClient } from './utils/shopify.js';
import { logToWorker } from './utils/log.js';
import { hmacSha256 } from './utils/crypto.js';

/**
 * Verify that a webhook request is authentic and from Shopify
 * @param {Request} req - The request object
 * @param {string} body - The request body as string
 * @param {Object} env - Environment variables
 * @param {Object} shopConfig - Configuration for the shop
 * @returns {Promise<boolean>} Whether the webhook is verified
 */
async function verifyShopifyWebhook(req, body, env, shopConfig) {
  try {
    if (!shopConfig || !shopConfig.shopify_api_secret_key) {
      logToWorker(env, "Missing API secret for shop. Cannot verify webhook.");
      return false;
    }

    const hmac = req.headers.get('X-Shopify-Hmac-Sha256');
    if (!hmac) {
      logToWorker(env, "Missing HMAC signature in webhook request");
      return false;
    }

    const secret = shopConfig.shopify_api_secret_key;
    const generatedHmac = await hmacSha256(secret, body);

    if (generatedHmac !== hmac) {
      logToWorker(env, "HMAC verification failed for webhook");
      return false;
    }

    return true;
  } catch (error) {
    logToWorker(env, "Error verifying webhook:", error);
    return false;
  }
}

/**
 * Dynamically load a job handler
 */
async function loadJobHandler(jobPath) {
  try {
    // Handle job path which might include subdirectories
    return await import(`./jobs/${jobPath}/job.js`);
  } catch (error) {
    console.error(`Failed to load job handler for ${jobPath}:`, error.message);
    return null;
  }
}

/**
 * Dynamically load a job config
 */
async function loadJobConfig(jobPath) {
  try {
    // Import the config.json file from the job directory
    const configModule = await import(`./jobs/${jobPath}/config.json`);
    return configModule.default;
  } catch (error) {
    console.error(`Failed to load job config for ${jobPath}:`, error.message);
    throw new Error(`Job config not found for: ${jobPath}`);
  }
}

/**
 * Parse the Shopworker configuration from environment
 */
function parseShopworkerConfig(env) {
  if (!env.SHOPWORKER_CONFIG) {
    throw new Error('SHOPWORKER_CONFIG secret not found. Please run `shopworker put-secrets` to configure the worker.');
  }
  return JSON.parse(env.SHOPWORKER_CONFIG);
}

/**
 * Load secrets from environment variables
 * Any environment variable starting with SECRET_ will be added to the secrets object
 * with the key being the part after SECRET_
 */
function loadSecretsFromEnv(env) {
  const secrets = {};

  // Look for environment variables with keys starting with SECRET_
  for (const key in env) {
    if (key.startsWith('SECRET_')) {
      const secretKey = key.substring(7); // Remove 'SECRET_' prefix

      try {
        // Try to parse as JSON, fall back to string if it fails
        try {
          secrets[secretKey] = JSON.parse(env[key]);
        } catch (e) {
          secrets[secretKey] = env[key];
        }
      } catch (error) {
        console.error(`Error parsing secret ${key}:`, error);
      }
    }
  }

  return secrets;
}

/**
 * Find shop configuration for the given domain
 */
function findShopConfig(shopworkerConfig, shopDomain) {
  if (!shopworkerConfig.shops) {
    return null;
  }
  return shopworkerConfig.shops.find(shop => shop.shopify_domain === shopDomain);
}

/**
 * Get job path from URL parameters
 */
function getJobPathFromUrl(request) {
  const url = new URL(request.url);
  const jobPath = url.searchParams.get('job');

  if (!jobPath) {
    throw new Error('Job path must be specified in the URL');
  }

  return jobPath;
}

/**
 * Create Shopify client with proper authentication
 */
function createAuthenticatedShopifyClient(shopDomain, shopConfig, env) {
  const accessToken = shopConfig?.shopify_token || env.SHOPIFY_ACCESS_TOKEN;

  if (!accessToken) {
    throw new Error('Shopify API access token not configured');
  }

  return createShopifyClient({
    shop: shopDomain,
    accessToken,
    apiVersion: '2025-04'
  });
}

/**
 * Process webhook with the appropriate job handler
 */
async function processWebhook(jobModule, bodyData, shopify, env, shopConfig, jobPath) {
  // Load job config from the jobPath
  const jobConfig = await loadJobConfig(jobPath);

  // Load secrets from environment variables
  const secrets = loadSecretsFromEnv(env);

  await jobModule.process({
    record: bodyData,
    shopify,
    env,
    shopConfig,
    jobConfig,
    secrets
  });

  console.log('Webhook processed successfully');
}

/**
 * Create a success response
 */
function createSuccessResponse() {
  return new Response(JSON.stringify({
    success: true,
    message: 'Webhook processed successfully'
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

/**
 * Create an error response
 */
function createErrorResponse(message, status = 500) {
  console.log("Error response: " + message);
  return new Response(JSON.stringify({
    success: false,
    error: message
  }), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

/**
 * Handle incoming webhook requests
 */
async function handleRequest(request, env, ctx) {
  console.log("Handling request in worker.js");
  if (request.method !== 'POST') {
    console.log("Method not allowed: " + request.method);
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // Get the request body as text and as JSON
    const bodyText = await request.clone().text();
    let bodyData;

    try {
      bodyData = await request.json();
    } catch (e) {
      return createErrorResponse('Invalid JSON body', 400);
    }

    // Get shop domain from headers
    const shopDomain = request.headers.get('X-Shopify-Shop-Domain');
    if (!shopDomain) {
      return createErrorResponse('Missing X-Shopify-Shop-Domain header', 400);
    }

    // Parse the configuration and find shop config
    const shopworkerConfig = parseShopworkerConfig(env);
    const shopConfig = findShopConfig(shopworkerConfig, shopDomain);

    // Get the webhook topic from the headers
    const topic = request.headers.get('X-Shopify-Topic');
    if (!topic) {
      return createErrorResponse('Missing X-Shopify-Topic header', 400);
    }

    // Verify the webhook signature (skip verification for shopworker/webhook topic)
    if (topic !== 'shopworker/webhook') {
      if (!await verifyShopifyWebhook(request, bodyText, env, shopConfig)) {
        return createErrorResponse('Invalid webhook signature', 401);
      }
    }

    // Get job path from URL parameter
    const jobPath = getJobPathFromUrl(request);

    // Dynamically load the job handler
    const jobModule = await loadJobHandler(jobPath);
    if (!jobModule) {
      return createErrorResponse(`Job handler not found for: ${jobPath}`, 404);
    }

    // Create a Shopify client
    const shopify = createAuthenticatedShopifyClient(shopDomain, shopConfig, env);

    // Process the webhook data
    await processWebhook(jobModule, bodyData, shopify, env, shopConfig, jobPath);

    return createSuccessResponse();
  } catch (error) {
    // Log the error
    console.error('Error processing webhook:', error.message, error.stack);
    return createErrorResponse(error.message);
  }
}

/**
 * Main event handler for the Cloudflare Worker
 */
export default {
  async fetch(request, env, ctx) {
    return await handleRequest(request, env, ctx);
  }
};
