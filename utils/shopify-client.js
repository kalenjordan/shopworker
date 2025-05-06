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

      // Parse the response and unwrap the data property
      const jsonResponse = await response.json();

      // Check for GraphQL errors
      if (jsonResponse.errors) {
        const errorMessage = jsonResponse.errors
          .map(error => error.message)
          .join(", ");
        console.error("GraphQL errors:", errorMessage);
        throw new Error(`GraphQL errors: ${errorMessage}`);
      }

      // Return just the data property to simplify response handling
      // If data is missing, return the whole response to help with debugging
      return jsonResponse.data || jsonResponse;
    },

    // ID Utility methods
    /**
     * Converts an ID to a Shopify GraphQL global ID (gid) format if it's not already
     * @param {string} id - The ID to convert
     * @param {string} type - The resource type (e.g., 'Product', 'Variant', 'Order', 'Customer')
     * @returns {string} - The ID in gid format
     */
    toGid: (id, type) => {
      if (!id) return null;

      // If already a gid, return as is
      if (typeof id === 'string' && id.startsWith('gid://')) {
        return id;
      }

      // Convert to gid format
      return `gid://shopify/${type}/${id}`;
    },

    /**
     * Extracts the numeric ID from a Shopify GraphQL global ID (gid)
     * @param {string} gid - The global ID
     * @returns {string|null} - The extracted ID or null if invalid
     */
    fromGid: (gid) => {
      if (!gid || typeof gid !== 'string' || !gid.startsWith('gid://')) {
        return gid; // Return as is if not a gid
      }

      const parts = gid.split('/');
      return parts.length >= 4 ? parts[3] : null;
    },

    /**
     * Gets the resource type from a Shopify GraphQL global ID (gid)
     * @param {string} gid - The global ID
     * @returns {string|null} - The resource type or null if invalid
     */
    getTypeFromGid: (gid) => {
      if (!gid || typeof gid !== 'string' || !gid.startsWith('gid://')) {
        return null;
      }

      const parts = gid.split('/');
      return parts.length >= 3 ? parts[2] : null;
    }
  };

  // Wrap client with error handling
  return wrapShopifyClient(rawClient);
}
