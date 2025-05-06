/**
 * Cloudflare Worker entry point for Shopify webhooks
 */

import { verifyShopifyWebhook } from './utils/worker-utils.js';

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
    return await handleRequest(request, env);
  }
};

/**
 * Handle incoming webhook requests
 * @param {Request} request - The incoming request
 * @returns {Response} The response to send back
 */
async function handleRequest(request, env) {
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

    // Verify webhook signature
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

    // Create a mock Shopify client for the worker environment
    const mockShopify = {
      graphql: async (query, variables) => {
        return { productUpdate: { userErrors: [], product: { title: bodyData.title || 'Test Product' } } };
      }
    };

    // Process the webhook data with the job handler
    await jobModule.process(bodyData, mockShopify);

    return new Response('Webhook processed successfully', { status: 200 });
  } catch (error) {
    // Log the error
    console.error('Error processing webhook:', error.message);

    // Return a generic error response
    return new Response('Error processing webhook', { status: 500 });
  }
}
