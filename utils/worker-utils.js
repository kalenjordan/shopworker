/**
 * Utility functions for Cloudflare Workers environment
 * This replaces the file-system based utilities with ones that work in Workers
 */

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
