/**
 * Cross-runtime SHA-256 HMAC implementation
 * Works in both Node.js and Cloudflare Workers environments
 */

/**
 * Generate an HMAC-SHA256 signature
 * @param {string} secret - The secret key
 * @param {string|ArrayBuffer} payload - The payload to sign
 * @returns {Promise<string>} The base64-encoded signature
 */
export async function hmacSha256(secret, payload) {
  // Detect environment
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    // Web Crypto API (Cloudflare Workers)
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);

    // Import the key
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    // Convert payload to ArrayBuffer if it's a string
    const data = typeof payload === 'string' ? encoder.encode(payload) : payload;

    // Sign the data
    const signature = await crypto.subtle.sign('HMAC', key, data);

    // Convert to base64
    return bufferToBase64(signature);
  } else {
    // Node.js environment
    const crypto = await import('crypto');
    return crypto.default
      .createHmac('sha256', secret)
      .update(payload, typeof payload === 'string' ? 'utf8' : undefined)
      .digest('base64');
  }
}

/**
 * Convert an ArrayBuffer to a base64 string
 * @param {ArrayBuffer} buffer - The buffer to convert
 * @returns {string} The base64-encoded string
 */
function bufferToBase64(buffer) {
  // Different approach depending on the environment
  if (typeof btoa === 'function') {
    // Browser / Cloudflare Workers
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  } else {
    // Node.js
    return Buffer.from(buffer).toString('base64');
  }
}
