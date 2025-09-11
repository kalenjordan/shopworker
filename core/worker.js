/**
 * Cloudflare Worker entry point for Shopify webhooks
 */

import { createShopifyClient } from "./shared/shopify.js";
import { hmacSha256 } from "./shared/crypto.js";
import { loadJobConfig as workerLoadJobConfig, loadJobModule } from "./worker/job-loader.js";
import { JobDispatcher } from "./workflow.js";

// Constants
const PAYLOAD_SIZE_THRESHOLD = 1024 * 1024; // 1MB
const WORKFLOW_ID_PREFIX = "job";
const PAYLOAD_ID_PREFIX = "payload";

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
    if (!shopConfig) {
      console.error("Shop configuration not found. Make sure the shop is configured in .shopworker.json");
      return false;
    }
    
    if (!shopConfig.shopify_api_secret_key) {
      console.error("Missing shopify_api_secret_key in shop configuration. Cannot verify webhook.");
      return false;
    }

    const hmac = req.headers.get("X-Shopify-Hmac-Sha256");
    if (!hmac) {
      console.error("Missing HMAC signature in webhook request");
      return false;
    }

    const secret = shopConfig.shopify_api_secret_key;
    const generatedHmac = await hmacSha256(secret, body);

    if (generatedHmac !== hmac) {
      console.error("HMAC verification failed for webhook");
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error verifying webhook:", error);
    return false;
  }
}

/**
 * Dynamically load a job config
 */
async function loadJobConfig(jobPath) {
  return workerLoadJobConfig(jobPath);
}

/**
 * Parse the Shopworker configuration from environment
 */
function parseShopworkerConfig(env) {
  if (!env.SHOPWORKER_CONFIG) {
    throw new Error("SHOPWORKER_CONFIG secret not found. Please run `shopworker put-secrets` to configure the worker.");
  }
  return JSON.parse(env.SHOPWORKER_CONFIG);
}

/**
 * Find shop configuration for the given domain
 */
function findShopConfig(shopworkerConfig, shopDomain) {
  // Handle single-shop configuration (flat structure)
  if (shopworkerConfig.shopify_domain && shopworkerConfig.shopify_domain === shopDomain) {
    return shopworkerConfig;
  }
  
  // Handle multi-shop configuration (shops array)
  if (shopworkerConfig.shops && Array.isArray(shopworkerConfig.shops)) {
    return shopworkerConfig.shops.find((shop) => shop.shopify_domain === shopDomain);
  }
  
  // No matching configuration found
  console.error(`No configuration found for shop domain: ${shopDomain}`);
  return null;
}

/**
 * Get job path from URL parameters
 */
function getJobPathFromUrl(request) {
  const url = new URL(request.url);
  const jobPath = url.searchParams.get("job");

  if (!jobPath) {
    throw new Error("Job path must be specified in the URL");
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

  if (payloadSize > PAYLOAD_SIZE_THRESHOLD) {
    const payloadId = `${PAYLOAD_ID_PREFIX}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    const r2Key = `payloads/${payloadId}`;

    await env.R2_BUCKET.put(r2Key, JSON.stringify(payload));

    return {
      r2Key,
      isLargePayload: true,
      originalSize: payloadSize,
    };
  }

  return {
    payload,
    isLargePayload: false,
    originalSize: payloadSize,
  };
}

/**
 * Create a JSON response
 */
function createResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Create an error response
 */
function createErrorResponse(message, status = 500) {
  return createResponse({ success: false, error: message }, status);
}

/**
 * Parse webhook request and extract necessary data
 */
async function parseWebhookRequest(request) {
  const bodyText = await request.clone().text();
  let bodyData;

  try {
    bodyData = await request.json();
  } catch (e) {
    throw new Error("Invalid JSON body");
  }

  const shopDomain = request.headers.get("X-Shopify-Shop-Domain");
  if (!shopDomain) {
    throw new Error("Missing X-Shopify-Shop-Domain header");
  }

  const topic = request.headers.get("X-Shopify-Topic");
  if (!topic) {
    throw new Error("Missing X-Shopify-Topic header");
  }

  return { bodyText, bodyData, shopDomain, topic };
}

/**
 * Verify webhook authentication based on topic
 */
async function verifyWebhookAuth(request, bodyText, topic, env, shopConfig) {
  if (topic === "shopworker/webhook") {
    const shopworkerWebhookSecret = request.headers.get("X-Shopworker-Webhook-Secret");
    if (shopworkerWebhookSecret != shopConfig.shopworker_webhook_secret) {
      throw new Error("Invalid shopworker webhook secret");
    }
  } else {
    if (!(await verifyShopifyWebhook(request, bodyText, env, shopConfig))) {
      throw new Error("Invalid webhook signature");
    }
  }
}

/**
 * Create and start workflow for job processing
 */
async function createJobWorkflow(env, params) {
  const workflowId = `${WORKFLOW_ID_PREFIX}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

  console.log(`Creating workflow with ID: ${workflowId}`);
  
  await env.JOB_DISPATCHER.create({
    id: workflowId,
    params,
  });

  console.log(`Workflow ${workflowId} created successfully`);
  
  return workflowId;
}

/**
 * Execute job synchronously for real-time triggers
 */
async function executeJobSynchronously(jobPath, jobConfig, shopDomain, bodyData, shopConfig, env) {
  // Create Shopify client
  const accessToken = shopConfig?.shopify_token || env.SHOPIFY_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("Shopify API access token not configured");
  }

  const shopify = createShopifyClient({
    shop: shopDomain,
    accessToken,
    apiVersion: jobConfig?.apiVersion,
  });

  // Load job module
  const jobModule = await loadJobModule(jobPath);

  // Load secrets from environment
  const secrets = {};
  for (const key in env) {
    if (key.startsWith("SECRET_")) {
      const secretKey = key.substring(7);
      try {
        secrets[secretKey] = JSON.parse(env[key]);
      } catch (e) {
        secrets[secretKey] = env[key];
      }
    }
  }

  // Execute job directly (synchronously)
  const result = await jobModule.process({
    shopify,
    payload: bodyData,
    shopConfig,
    jobConfig,
    env,
    secrets,
    // Note: No 'step' parameter for synchronous execution
  });

  return result;
}

/**
 * Process the webhook request
 */
async function _handleRequest(request, env) {
  // Parse webhook request
  const { bodyText, bodyData, shopDomain, topic } = await parseWebhookRequest(request);

  // Get shop configuration
  const shopworkerConfig = parseShopworkerConfig(env);
  const shopConfig = findShopConfig(shopworkerConfig, shopDomain);

  // Verify webhook authentication
  await verifyWebhookAuth(request, bodyText, topic, env, shopConfig);

  // Get job path and load config
  const jobPath = getJobPathFromUrl(request);
  const jobConfig = await loadJobConfig(jobPath);

  // Check if this is a real-time trigger
  if (jobConfig.trigger === "webrequest" || (jobConfig.triggerConfig && jobConfig.triggerConfig.realtime)) {
    // Execute job synchronously and return result
    const result = await executeJobSynchronously(jobPath, jobConfig, shopDomain, bodyData, shopConfig, env);
    
    // If result has a status code, use it, otherwise default to 200
    const statusCode = result.statusCode || 200;
    
    // If result has headers, include them
    const headers = {
      "Content-Type": "application/json",
      ...(result.headers || {})
    };
    
    // Return the job result as the HTTP response
    return new Response(JSON.stringify(result.body || result), {
      status: statusCode,
      headers
    });
  }

  // Handle large payloads for async processing
  const payloadInfo = await handleLargePayload(bodyData, env);

  // Create workflow parameters
  const workflowParams = {
    shopDomain,
    jobPath,
    ...(payloadInfo.isLargePayload
      ? { r2Key: payloadInfo.r2Key, isLargePayload: true }
      : { payload: payloadInfo.payload, isLargePayload: false }),
    shopConfig,
    jobConfig,
    topic,
    timestamp: new Date().toISOString(),
  };

  // Start workflow
  const workflowId = await createJobWorkflow(env, workflowParams);

  // Return success response
  return createResponse({
    success: true,
    message: "Job workflow started successfully",
    workflowId: workflowId,
  });
}

/**
 * Handle incoming webhook requests
 */
async function handleRequest(request, env) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    return await _handleRequest(request, env);
  } catch (error) {
    console.error("Error processing webhook:", error.message, error.stack);

    // Map specific errors to appropriate status codes
    if (error.message.includes("Missing") || error.message.includes("Invalid JSON")) {
      return createErrorResponse(error.message, 400);
    }
    if (error.message.includes("webhook secret") || error.message.includes("webhook signature")) {
      return createErrorResponse(error.message, 401);
    }

    return createErrorResponse(error.message);
  }
}

/**
 * Main event handler for the Cloudflare Worker
 */
export default {
  async fetch(request, env, ctx) {
    return await handleRequest(request, env);
  },
};

// Export the JobDispatcher workflow class from the separate file
export { JobDispatcher } from "./workflow.js";
