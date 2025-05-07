/**
 * Shared Shopify client implementation that works in both CLI and Worker environments
 * Uses GraphQL API exclusively
 */

/**
 * Recursively search for userErrors in a GraphQL response
 * @param {Object} obj - Object to search
 * @returns {Array|null} - Array of userErrors or null if none found
 */
function findUserErrors(obj) {
  // If not an object or null, return null
  if (!obj || typeof obj !== 'object') {
    return null;
  }

  // If the object has a userErrors property that's an array and not empty, return it
  if (Array.isArray(obj.userErrors) && obj.userErrors.length > 0) {
    return obj.userErrors;
  }

  // Check all properties recursively
  for (const key in obj) {
    const result = findUserErrors(obj[key]);
    if (result) {
      return result;
    }
  }

  return null;
}

/**
 * Truncate a GraphQL query for logging purposes
 * @param {string} query - The GraphQL query
 * @returns {string} - Truncated query
 */
function truncateQuery(query) {
  if (!query) return 'undefined';

  // Remove whitespace and newlines for more compact logging
  const compactQuery = query.replace(/\s+/g, ' ').trim();

  // If query is too long, truncate it
  if (compactQuery.length > 500) {
    return compactQuery.substring(0, 500) + '...';
  }

  return compactQuery;
}

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

  // Create the client with enhanced GraphQL capabilities
  const shopifyClient = {
    // GraphQL API with built-in error handling
    graphql: async (query, variables = {}) => {
      try {
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

        // Parse the response
        const jsonResponse = await response.json();

        // Check for GraphQL errors
        if (jsonResponse.errors) {
          const errorMessage = jsonResponse.errors
            .map(error => error.message)
            .join(", ");
          console.error("GraphQL errors:", errorMessage);
          throw new Error(`GraphQL errors: ${errorMessage}`);
        }

        // Get the data - it's already unwrapped from the GraphQL response
        const result = jsonResponse.data || jsonResponse;

        // Check for userErrors at any level in the response
        const userErrors = findUserErrors(result);
        if (userErrors && userErrors.length > 0) {
          // Format error messages from userErrors
          const errorMessages = userErrors
            .map(error => `${error.field ? error.field + ': ' : ''}${error.message}`)
            .join(", ");

          // Print a simplified error message
          console.error(`GraphQL Error: ${errorMessages}`);

          // Throw error instead of exiting process (appropriate for both CLI and worker environments)
          throw new Error(`GraphQL Error: ${errorMessages}`);
        }

        // Return the result data
        return result;
      } catch (error) {
        // This catches both our custom errors and request-level errors
        // Print helpful error details
        console.error('Shopify API Error:', error.message);
        console.error('Query:', truncateQuery(query));

        if (variables && Object.keys(variables).length > 0) {
          console.error('Variables:', JSON.stringify(variables, null, 2));
        }

        // Rethrow the error
        throw error;
      }
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
      return parts.length >= 4 ? parts[4] : null;
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

  return shopifyClient;
}
