/**
 * Cloudflare Worker entry point for Shopify webhooks
 */

import { getJobsConfig, verifyShopifyWebhook } from './utils/worker-utils.js';

// Map of webhook topics to job handlers
let topicToJobMap = null;

/**
 * Initialize the mapping of webhook topics to job handlers
 * This is done once on cold start
 */
async function initializeJobMapping() {
  if (topicToJobMap !== null) return;

  topicToJobMap = {};
  const jobs = await getJobsConfig();

  for (const jobName in jobs) {
    const job = jobs[jobName];
    if (job.webhookTopic) {
      topicToJobMap[job.webhookTopic] = {
        name: jobName,
        // This would dynamically import job handler modules
        // In a bundled environment, these would be included during build
        handler: { process: async (data) => console.log(`Processing ${jobName} with data:`, data) }
      };
    }
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
    await initializeJobMapping();

    // Get the request body as text and as JSON
    const bodyText = await request.clone().text();
    const bodyData = await request.json();

    // Verify webhook signature
    if (!verifyShopifyWebhook(request, bodyText)) {
      return new Response('Invalid webhook signature', { status: 401 });
    }

    // Get the webhook topic from the headers
    const topic = request.headers.get('X-Shopify-Topic');

    if (!topic || !topicToJobMap[topic]) {
      return new Response(`No handler registered for topic: ${topic}`, { status: 404 });
    }

    // Get the job handler
    const jobInfo = topicToJobMap[topic];

    // Process the webhook data with the job handler
    await jobInfo.handler.process(bodyData);

    return new Response('Webhook processed successfully', { status: 200 });
  } catch (error) {
    // Log the error (Cloudflare Workers use console.error for logging)
    console.error('Error processing webhook:', error);

    // Return a generic error response
    return new Response('Error processing webhook', { status: 500 });
  }
}
