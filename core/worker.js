/**
 * Cloudflare Worker entry point for Shopify webhooks
 */

import { createShopifyClient } from "./shared/shopify.js";
import { hmacSha256 } from "./shared/crypto.js";
import { loadJobConfig as workerLoadJobConfig, loadJobModule, resolveJobPath } from "./worker/job-loader.js";
import { JobDispatcher } from "./workflow.js";

// Constants
const PAYLOAD_SIZE_THRESHOLD = 1024 * 1024; // 1MB
const WORKFLOW_ID_PREFIX = "job";
const PAYLOAD_ID_PREFIX = "payload";
const WEBREQUEST_TOPIC = "shopworker/webrequest";
const CONTENT_TYPE_JSON = "application/json";

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
 * Get job name from URL path and resolve to full job path
 */
function getJobPathFromUrl(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  
  // Extract job name from path (remove leading slash)
  const jobName = pathname.replace(/^\//, '');

  if (!jobName) {
    throw new Error("Job name must be specified in the URL path");
  }

  // Resolve job name to full path
  return resolveJobPath(jobName);
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
 * Get CORS headers for web requests
 */
function getCorsHeaders(origin = null) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Shopify-Topic, X-Shopify-Shop-Domain, X-Shopify-Test",
    "Access-Control-Max-Age": "86400", // 24 hours
  };

  // Allow specific origins or all origins for webrequest jobs
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
  } else {
    headers["Access-Control-Allow-Origin"] = "*";
  }

  return headers;
}

/**
 * Create a JSON response
 */
function createResponse(data, status = 200, additionalHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 
      "Content-Type": CONTENT_TYPE_JSON,
      ...additionalHeaders
    },
  });
}

/**
 * Create an error response
 */
function createErrorResponse(message, status = 500, additionalHeaders = {}) {
  return createResponse({ success: false, error: message }, status, additionalHeaders);
}

/**
 * Resolve shop configuration and domain for a given topic
 * @param {Object} shopworkerConfig - The shopworker configuration
 * @param {string} shopDomain - The shop domain from request
 * @param {string} topic - The webhook topic
 * @returns {{shopConfig: Object, resolvedShopDomain: string}}
 */
function resolveShopConfig(shopworkerConfig, shopDomain, topic) {
  // For webrequest jobs, always use the shop configuration domain
  if (topic === WEBREQUEST_TOPIC) {
    if (shopworkerConfig.shopify_domain) {
      // Single-shop configuration
      return {
        shopConfig: shopworkerConfig,
        resolvedShopDomain: shopworkerConfig.shopify_domain
      };
    } else if (shopworkerConfig.shops && shopworkerConfig.shops.length > 0) {
      // Multi-shop configuration, use first shop as default
      const firstShop = shopworkerConfig.shops[0];
      return {
        shopConfig: firstShop,
        resolvedShopDomain: firstShop.shopify_domain
      };
    } else {
      throw new Error("No shop configuration found for webrequest job");
    }
  } else {
    // Regular webhook jobs use the shop domain from headers
    return {
      shopConfig: findShopConfig(shopworkerConfig, shopDomain),
      resolvedShopDomain: shopDomain
    };
  }
}

/**
 * Parse webhook request and extract necessary data
 */
async function parseWebhookRequest(request) {
  // Handle GET requests for webrequest jobs
  if (request.method === "GET") {
    const url = new URL(request.url);
    const jobName = url.pathname.replace(/^\//, '');
    
    // Check if this is a webrequest job
    try {
      const jobPath = resolveJobPath(jobName);
      const jobConfig = await loadJobConfig(jobPath);
      if (jobConfig.trigger === "webrequest") {
        // For webrequest GET requests, use query parameters as payload
        const queryParams = {};
        for (const [key, value] of url.searchParams.entries()) {
          queryParams[key] = value;
        }
        
        return { 
          bodyText: "", 
          bodyData: queryParams, 
          shopDomain: "webrequest", // Placeholder for webrequest jobs
          topic: WEBREQUEST_TOPIC 
        };
      }
    } catch (e) {
      // If job config loading fails, continue with normal processing
    }
  }

  // Handle POST requests (original logic)
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
  if (topic === WEBREQUEST_TOPIC) {
    // No authentication required for webrequest triggers
    return;
  } else if (topic === "shopworker/webhook") {
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
  const { shopConfig, resolvedShopDomain } = resolveShopConfig(shopworkerConfig, shopDomain, topic);

  // Verify webhook authentication
  await verifyWebhookAuth(request, bodyText, topic, env, shopConfig);

  // Get job path and load config
  const jobPath = getJobPathFromUrl(request);
  const jobConfig = await loadJobConfig(jobPath);

  // Check if this is a real-time trigger
  if (jobConfig.trigger === "webrequest") {
    // Execute job synchronously and return result
    const result = await executeJobSynchronously(jobPath, jobConfig, resolvedShopDomain, bodyData, shopConfig, env);
    
    // If result has a status code, use it, otherwise default to 200
    const statusCode = result.statusCode || 200;
    
    // If result has headers, include them
    const headers = {
      "Content-Type": CONTENT_TYPE_JSON,
      ...getCorsHeaders(request.headers.get("Origin")),
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
    shopDomain: resolvedShopDomain,
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
  // Handle CORS preflight requests for webrequest jobs
  if (request.method === "OPTIONS") {
    // Check if this could be a webrequest job
    try {
      const jobPath = getJobPathFromUrl(request);
      const jobConfig = await loadJobConfig(jobPath);
      
      if (jobConfig.trigger === "webrequest") {
        return new Response(null, {
          status: 204,
          headers: getCorsHeaders(request.headers.get("Origin"))
        });
      }
    } catch (error) {
      // If job name is invalid, still return CORS headers for OPTIONS
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request.headers.get("Origin"))
      });
    }
    return new Response("Method not allowed", { status: 405 });
  }

  // Allow GET and POST requests for webrequest jobs, otherwise require POST
  if (request.method !== "POST" && request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  // For GET requests, check if it's a webrequest job
  if (request.method === "GET") {
    try {
      const jobPath = getJobPathFromUrl(request);
      const jobConfig = await loadJobConfig(jobPath);
      
      if (jobConfig.trigger !== "webrequest") {
        return new Response("GET method only allowed for webrequest jobs", { status: 405 });
      }
    } catch (error) {
      return new Response("Invalid job name for GET request", { status: 400 });
    }
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
