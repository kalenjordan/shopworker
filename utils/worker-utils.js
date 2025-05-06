/**
 * Utility functions for Cloudflare Workers environment
 * This replaces the file-system based utilities with ones that work in Workers
 */

// Import GraphQL queries
import { queries } from '../graphql/index.js';

// Store job configurations in global variable to persist across requests
let cachedJobs = null;

/**
 * Get job configurations from environment variables or KV storage
 * During deployment we'll bundle these into environment variables
 * @returns {Object} Map of job names to their configurations
 */
export async function getJobsConfig() {
  // Return cached config if available
  if (cachedJobs !== null) {
    return cachedJobs;
  }

  // Hard-coded job configuration for testing
  cachedJobs = {
    "order-created-tag-skus": {
      "name": "order-created-tag-skus",
      "description": "Tags customers with SKUs from their order",
      "version": "1.0.0",
      "trigger": "order-created",
      "webhookTopic": "orders/create"
    }
  };

  return cachedJobs;
}

/**
 * Verify Shopify webhook signature
 * @param {Request} request - The incoming request
 * @param {string} body - The request body as string
 * @returns {boolean} Whether the signature is valid
 */
export function verifyShopifyWebhook(request, body) {
  const hmac = request.headers.get('X-Shopify-Hmac-Sha256');

  if (!hmac) {
    return false;
  }

  // In a real implementation, we would verify the HMAC signature here
  // using crypto.createHmac with the webhook secret from environment variables
  // This simplified version just checks if the header exists
  return true;
}
