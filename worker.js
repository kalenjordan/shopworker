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
      // Store job configs by topic for lookup
      if (!topicToJobMap[job.webhookTopic]) {
        topicToJobMap[job.webhookTopic] = [];
      }
      topicToJobMap[job.webhookTopic].push({
        name: jobName
      });
    }
  }
}

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
    await initializeJobMapping();

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

    if (!topic || !topicToJobMap[topic]) {
      return new Response(`No handler registered for topic: ${topic}`, { status: 404 });
    }

    // Get job name from URL parameter
    const url = new URL(request.url);
    const jobNameFromUrl = url.searchParams.get('job');

    // If we have a job name from URL, use that specific job
    let jobInfo = null;

    if (jobNameFromUrl) {
      // Find the job with the matching name
      jobInfo = topicToJobMap[topic].find(job => job.name === jobNameFromUrl);

      if (!jobInfo) {
        return new Response(`Job '${jobNameFromUrl}' not found for topic: ${topic}`, { status: 404 });
      }
    } else if (topicToJobMap[topic].length === 1) {
      // If no job name specified but only one job for this topic, use that
      jobInfo = topicToJobMap[topic][0];
    } else {
      // Multiple jobs for this topic but no job name specified
      return new Response(`Multiple handlers for topic '${topic}', job name required in URL`, { status: 400 });
    }

    // Dynamically load the job handler
    const jobModule = await loadJobHandler(jobInfo.name);

    if (!jobModule) {
      return new Response(`Job handler not found for: ${jobInfo.name}`, { status: 500 });
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
