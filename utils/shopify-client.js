/**
 * Shared Shopify client implementation that works in both CLI and Worker environments
 * Uses GraphQL API exclusively
 */

import { wrapShopifyClient } from './shopify-utils.js';

/**
 * Creates a Shopify admin API client using GraphQL
 * @param {Object} options - Configuration options
 * @param {string} options.shopDomain - The Shopify shop domain
 * @param {string} options.accessToken - The Shopify admin API access token
 * @param {string} [options.apiVersion='2024-07'] - The Shopify API version to use
 * @returns {Object} A Shopify client with GraphQL capabilities
 */
export function createShopifyClient({ shopDomain, accessToken, apiVersion = '2024-07' }) {
  // Format shop name (remove .myshopify.com if present)
  const shopName = shopDomain.replace('.myshopify.com', '');
  const graphqlUrl = `https://${shopName}.myshopify.com/admin/api/${apiVersion}/graphql.json`;

  // Create raw client with GraphQL capabilities
  const rawClient = {
    // GraphQL API
    graphql: async (query, variables = {}) => {
      const response = await fetch(graphqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken
        },
        body: JSON.stringify({ query, variables })
      });

      if (!response.ok) {
        // Handle non-JSON responses
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          const text = await response.text();
          throw new Error(`Shopify GraphQL request failed with non-JSON response: ${response.status} ${response.statusText}`);
        }

        // Handle JSON error responses
        throw new Error(`Shopify GraphQL request failed: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    }
  };

  // Wrap client with error handling
  return wrapShopifyClient(rawClient);
}
