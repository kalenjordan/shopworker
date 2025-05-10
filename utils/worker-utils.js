/**
 * Utility functions for Cloudflare Workers environment
 * This replaces the file-system based utilities with ones that work in Workers
 */

/**
 * Generate HMAC signature for webhook payload - Web Crypto API implementation
 * @param {string} secret - The webhook secret
 * @param {string} body - The request body as string
 * @returns {Promise<string>} The base64 encoded signature
 */
export async function generateHmacSignature(secret, body) {
  // Convert secret and body to byte arrays for Web Crypto API
  const encoder = new TextEncoder();
  const secretKeyData = encoder.encode(secret);
  const bodyData = encoder.encode(body);

  // Import the secret as a crypto key
  const key = await crypto.subtle.importKey(
    'raw',
    secretKeyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Create signature using Web Crypto API
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    bodyData
  );

  // Convert the signature to base64
  return btoa(
    String.fromCharCode(...new Uint8Array(signature))
  );
}

/**
 * Verify Shopify webhook signature
 * @param {Request} request - The incoming request
 * @param {string} body - The request body as string
 * @param {Object} [env] - Environment variables
 * @param {Object} [shopConfig] - Shop-specific configuration
 * @returns {Promise<boolean>} Whether the signature is valid
 */
export async function verifyShopifyWebhook(request, body, env, shopConfig) {
  const hmac = request.headers.get('X-Shopify-Hmac-Sha256');

  if (!hmac) {
    return false;
  }

  let secret;

  // Try to get the shop domain from headers
  const shopDomain = request.headers.get('X-Shopify-Shop-Domain');

  // First check shopConfig for the API secret key
  if (shopConfig && shopConfig.shopify_api_secret_key) {
    secret = shopConfig.shopify_api_secret_key;
  }
  // If neither has the key, throw an error
  else {
    throw new Error('Missing API secret key in shop configuration and environment variables');
  }

  try {
    // Generate HMAC signature using our common function
    const generatedHash = await generateHmacSignature(secret, body);

    // Compare the generated hash with the one from the request headers
    return hmac === generatedHash;
  } catch (error) {
    console.error('Error verifying webhook signature:', error);
    return false;
  }
}
