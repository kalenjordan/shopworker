/**
 * Cloudflare Worker entry point for Shopify webhooks
 */

import { verifyShopifyWebhook } from './utils/worker-utils.js';
import { createShopifyClient } from './utils/shopify-client.js';

/**
 * Dynamically load a job handler
 */
async function loadJobHandler(jobName) {
  try {
    // Use dynamic import with template path
    // This pattern allows Webpack/bundlers to include all potential imports
    return await import(`./jobs/${jobName}/job.js`);
  } catch (error) {
    console.error(`Failed to load job handler for ${jobName}:`, error.message);
    return null;
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
 * Find shop configuration for the given domain
 */
function findShopConfig(shopworkerConfig, shopDomain) {
  if (!shopworkerConfig.shops) {
    return null;
  }
  return shopworkerConfig.shops.find(shop => shop.shopify_domain === shopDomain);
}

/**
 * Get job name from URL parameters
 */
function getJobNameFromUrl(request) {
  const url = new URL(request.url);
  const jobName = url.searchParams.get('job');

  if (!jobName) {
    throw new Error('Job name must be specified in the URL');
  }

  return jobName;
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
    shopDomain,
    accessToken,
    apiVersion: '2025-04'
  });
}

/**
 * Process webhook with the appropriate job handler
 */
async function processWebhook(jobModule, bodyData, shopify, env, shopConfig) {
  await jobModule.process({
    record: bodyData,
    shopify,
    env,
    shopConfig
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
  // Only accept POST requests
  if (request.method !== 'POST') {
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

    // Verify the webhook signature
    if (!await verifyShopifyWebhook(request, bodyText, env, shopConfig)) {
      return createErrorResponse('Invalid webhook signature', 401);
    }

    // Get the webhook topic from the headers
    const topic = request.headers.get('X-Shopify-Topic');
    if (!topic) {
      return createErrorResponse('Missing X-Shopify-Topic header', 400);
    }

    // Get job name from URL parameter
    const jobName = getJobNameFromUrl(request);

    // Dynamically load the job handler
    const jobModule = await loadJobHandler(jobName);
    if (!jobModule) {
      return createErrorResponse(`Job handler not found for: ${jobName}`, 404);
    }

    // Create a Shopify client
    const shopify = createAuthenticatedShopifyClient(shopDomain, shopConfig, env);

    // Process the webhook data
    await processWebhook(jobModule, bodyData, shopify, env, shopConfig);

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
