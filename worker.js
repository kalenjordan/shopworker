/**
 * Cloudflare Worker entry point for Shopify webhooks
 */

import { createShopifyClient } from './utils/shopify.js';
import { logToWorker } from './utils/env.js';
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
 * Get the size of a payload in bytes
 */
function getPayloadSize(data) {
  return new TextEncoder().encode(JSON.stringify(data)).length;
}

/**
 * Store large payload in R2 and return a reference
 */
async function handleLargePayload(payload, env) {
  const payloadSize = getPayloadSize(payload);
  const sizeThreshold = 1024 * 1024; // 1MB

  if (payloadSize > sizeThreshold) {
    const payloadId = `payload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const r2Key = `payloads/${payloadId}`;

    await env.R2_BUCKET.put(r2Key, JSON.stringify(payload));

    return {
      r2Key,
      isLargePayload: true,
      originalSize: payloadSize
    };
  }

  return {
    payload,
    isLargePayload: false,
    originalSize: payloadSize
  };
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

  // Handle GET requests for job status/stats
  if (request.method === 'GET') {
    return await handleGetRequest(request, env);
  }

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
    console.log("Shop config loaded for shop: " + shopConfig.name);

    // Get the webhook topic from the headers
    const topic = request.headers.get('X-Shopify-Topic');
    if (!topic) {
      return createErrorResponse('Missing X-Shopify-Topic header', 400);
    }

    // Verify the webhook signature (skip verification for shopworker/webhook topic)
    if (topic === 'shopworker/webhook') {
      const shopworkerWebhookSecret = request.headers.get('X-Shopworker-Webhook-Secret');
      if (shopworkerWebhookSecret != shopConfig.shopworker_webhook_secret) {
        console.log("Invalid shopworker webhook secret: " + shopworkerWebhookSecret);
        console.log("Expected shopworker webhook secret: " + shopConfig.shopworker_webhook_secret);
        return createErrorResponse('Invalid shopworker webhook secret: ' + shopworkerWebhookSecret, 401);
      }
    } else {
      console.log("Verifying webhook signature for topic: " + topic);
      if (!await verifyShopifyWebhook(request, bodyText, env, shopConfig)) {
        return createErrorResponse('Invalid webhook signature', 401);
      }
    }

    // Get job path from URL parameter
    const jobPath = getJobPathFromUrl(request);

    // Handle large payloads by storing in R2
    const payloadInfo = await handleLargePayload(bodyData, env);


    // Load job config
    const jobConfig = await loadJobConfig(jobPath);

    // Start the job dispatcher workflow
    const workflowId = `job-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    const workflowParams = {
      shopDomain,
      jobPath,
      ...(payloadInfo.isLargePayload ?
        { r2Key: payloadInfo.r2Key, isLargePayload: true } :
        { payload: payloadInfo.payload, isLargePayload: false }
      ),
      shopConfig,
      jobConfig,
      topic,
      timestamp: new Date().toISOString()
    };

    const workflowInstance = await env.JOB_DISPATCHER.create({
      id: workflowId,
      params: workflowParams
    });

    console.log(`Workflow ${workflowId} started for shop ${shopDomain}, job ${jobPath}`);

    // Return immediately with workflow ID
    return new Response(JSON.stringify({
      success: true,
      message: 'Job workflow started successfully',
      workflowId: workflowId
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error processing webhook:', error.message, error.stack);
    return createErrorResponse(error.message);
  }
}

/**
 * Handle GET requests for workflow status
 */
async function handleGetRequest(request, env) {
  try {
    const url = new URL(request.url);
    const workflowId = url.searchParams.get('workflow');
    const action = url.searchParams.get('action') || 'status';

    switch (action) {
      case 'status':
        if (!workflowId) {
          return createErrorResponse('Missing workflowId parameter for status request', 400);
        }

        try {
          const workflow = await env.JOB_DISPATCHER.get(workflowId);
          const status = await workflow.status();

          return new Response(JSON.stringify({
            success: true,
            workflow: {
              id: workflowId,
              status: status.status,
              output: status.output,
              error: status.error
            }
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          return createErrorResponse(`Workflow ${workflowId} not found`, 404);
        }

      default:
        return createErrorResponse('Unknown action. Valid actions: status', 400);
    }
  } catch (error) {
    console.error('Error handling GET request:', error.message);
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

// JobDispatcher Workflow class - defined inline for proper binding
import { WorkflowEntrypoint } from "cloudflare:workers";

export class JobDispatcher extends WorkflowEntrypoint {
  async run(event, step) {
    // Parameters are passed via event.payload according to Cloudflare docs
    const { shopDomain, jobPath, payload, r2Key, isLargePayload, shopConfig, jobConfig, topic, timestamp } = event.payload;

    // Step 1: Retrieve payload if it's stored in R2
    const jobData = await step.do("retrieve-payload", async () => {
      if (isLargePayload && r2Key) {
        const r2Object = await this.env.R2_BUCKET.get(r2Key);
        if (!r2Object) {
          throw new Error(`Large payload not found in R2: ${r2Key}`);
        }
        return await r2Object.json();
      } else {
        return payload;
      }
    });

    // Step 2: Load job configuration
    const finalJobConfig = await step.do("load-job-config", async () => {
      try {
        // Load job config
        const jobConfigModule = await import(`./jobs/${jobPath}/config.json`);
        let config = jobConfigModule.default;

        // Check for config overrides in the payload
        if (jobData._configOverrides) {
          config = {
            ...config,
            test: {
              ...config.test,
              ...jobData._configOverrides
            }
          };
        }

        return config;
      } catch (error) {
        throw new Error(`Failed to load job config for ${jobPath}: ${error.message}`);
      }
    });

    // Step 3: Create Shopify client (not serializable, so create outside of workflow step)
    const accessToken = shopConfig?.shopify_token || this.env.SHOPIFY_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error('Shopify API access token not configured');
    }

    const { createShopifyClient } = await import('./utils/shopify.js');
    const shopify = createShopifyClient({
      shop: shopDomain,
      accessToken,
      apiVersion: finalJobConfig?.apiVersion
    });

    // Step 4: Load job module (not a workflow step, just load the module)
    const jobModule = await import(`./jobs/${jobPath}/job.js`);
    if (!jobModule.process) {
      throw new Error(`Job ${jobPath} does not export a process function`);
    }

    // Execute the job directly - let it create its own workflow steps
    const result = await jobModule.process({
      shopify,
      payload: jobData,
      shopConfig,
      jobConfig: finalJobConfig,
      env: this.env,
      secrets: this.loadSecretsFromEnv(this.env),
      step // Pass the step function so jobs can create their own workflow steps at the top level
    });

    // Step 5: Clean up large payload if needed
    await step.do("cleanup", async () => {
      if (isLargePayload && r2Key) {
        try {
          await this.env.R2_BUCKET.delete(r2Key);
          console.log(`Cleaned up large payload: ${r2Key}`);
        } catch (error) {
          console.warn(`Failed to clean up large payload ${r2Key}:`, error.message);
        }
      }
      return { cleanup: "completed" };
    });

    return result;
  }

  /**
   * Load secrets from environment variables
   */
  loadSecretsFromEnv(env) {
    const secrets = {};
    for (const key in env) {
      if (key.startsWith('SECRET_')) {
        const secretKey = key.substring(7);
        try {
          secrets[secretKey] = JSON.parse(env[key]);
        } catch (e) {
          secrets[secretKey] = env[key];
        }
      }
    }
    return secrets;
  }
}
