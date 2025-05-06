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
      console.log(`Registering handler for topic: ${job.webhookTopic}, job: ${jobName}`);

      // In production, you would dynamically import these modules
      // Here we're using a placeholder handler for demonstration
      topicToJobMap[job.webhookTopic] = {
        name: jobName,
        handler: {
          process: async (data) => {
            console.log(`[${jobName}] Processing webhook data:`, JSON.stringify(data).substring(0, 200) + '...');
            return `Processed ${jobName}`;
          }
        }
      };
    }
  }

  console.log('Job mapping initialized:', Object.keys(topicToJobMap).join(', '));
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
    console.log('Rejected non-POST method:', request.method);
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
      console.error('Failed to parse request body as JSON:', bodyText.substring(0, 200));
      return new Response('Invalid JSON body', { status: 400 });
    }

    // Verify webhook signature
    if (!verifyShopifyWebhook(request, bodyText)) {
      console.error('Invalid webhook signature');
      return new Response('Invalid webhook signature', { status: 401 });
    }

    // Get the webhook topic from the headers
    const topic = request.headers.get('X-Shopify-Topic');
    console.log(`Received webhook for topic: ${topic}`);

    if (!topic || !topicToJobMap[topic]) {
      console.warn(`No handler registered for topic: ${topic}`);
      return new Response(`No handler registered for topic: ${topic}`, { status: 404 });
    }

    // Get the job handler
    const jobInfo = topicToJobMap[topic];
    console.log(`Processing webhook with job: ${jobInfo.name}`);

    // Process the webhook data with the job handler
    const result = await jobInfo.handler.process(bodyData);
    console.log(`Successfully processed webhook: ${result}`);

    return new Response('Webhook processed successfully', { status: 200 });
  } catch (error) {
    // Log the error (Cloudflare Workers use console.error for logging)
    console.error('Error processing webhook:', error.message, error.stack);

    // Return a generic error response
    return new Response('Error processing webhook: ' + error.message, { status: 500 });
  }
}
