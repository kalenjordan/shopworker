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
 * Main event handler for the Cloudflare Worker
 */
export default {
  async fetch(request, env, ctx) {
    return await handleRequest(request, env, ctx);
  }
};

/**
 * Handle incoming webhook requests
 * @param {Request} request - The incoming request
 * @param {Object} env - Cloudflare environment variables and bindings
 * @param {Object} ctx - Execution context with waitUntil, etc.
 * @returns {Response} The response to send back
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
      return new Response('Invalid JSON body', { status: 400 });
    }

    // Verify webhook signature (simple check for now)
    if (!verifyShopifyWebhook(request, bodyText)) {
      return new Response('Invalid webhook signature', { status: 401 });
    }

    // Get the webhook topic from the headers
    const topic = request.headers.get('X-Shopify-Topic');

    if (!topic) {
      return new Response('Missing X-Shopify-Topic header', { status: 400 });
    }

    // Get job name from URL parameter - this is required
    const url = new URL(request.url);
    const jobName = url.searchParams.get('job');

    if (!jobName) {
      return new Response('Job name must be specified in the URL', { status: 400 });
    }

    // Dynamically load the job handler
    const jobModule = await loadJobHandler(jobName);

    if (!jobModule) {
      return new Response(`Job handler not found for: ${jobName}`, { status: 404 });
    }

    // Get shop domain from headers
    const shopDomain = request.headers.get('X-Shopify-Shop-Domain');
    if (!shopDomain) {
      return new Response('Missing X-Shopify-Shop-Domain header', { status: 400 });
    }

    // Parse the configuration from secrets
    let shopworkerConfig = {};
    try {
      if (env.SHOPWORKER_CONFIG) {
        shopworkerConfig = JSON.parse(env.SHOPWORKER_CONFIG);
      } else {
        console.warn('SHOPWORKER_CONFIG secret not found. Falling back to legacy configuration.');
      }
    } catch (error) {
      console.error('Error parsing SHOPWORKER_CONFIG:', error.message);
    }

    // Find the shop configuration for this domain
    let shopConfig = null;
    if (shopworkerConfig.shops) {
      shopConfig = shopworkerConfig.shops.find(shop => shop.shopify_domain === shopDomain);

      // Merge shop config into env for job to access
      if (shopConfig) {
        // Copy all shop configuration properties to env
        Object.assign(env, shopConfig);
      }
    }

    // Get API access token from shop config or environment
    const accessToken = shopConfig?.shopify_token || env.SHOPIFY_ACCESS_TOKEN;
    if (!accessToken) {
      return new Response('Shopify API access token not configured', { status: 500 });
    }

    // Create a Shopify client using our shared implementation
    const shopify = createShopifyClient({
      shopDomain,
      accessToken,
      apiVersion: '2025-04'
    });

    // Process the webhook data with the job handler, passing arguments as an object
    await jobModule.process({
      record: bodyData, // The webhook payload is passed as 'record' (previously 'order')
      shopify: shopify,
      env: env
    });

    return new Response(JSON.stringify({
      success: true,
      message: 'Webhook processed successfully'
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    // Log the error
    console.error('Error processing webhook:', error.message, error.stack);

    // Return a JSON error response
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}
