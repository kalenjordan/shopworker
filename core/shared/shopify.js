/**
 * Shared Shopify client implementation that works in both CLI and Worker environments
 * Uses GraphQL API exclusively
 */
import fs from 'fs';
import path from 'path';

// Track if we've already logged the API version
let apiVersionLogged = false;

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
 * @param {string} options.shop - The Shopify shop domain
 * @param {string} options.accessToken - The Shopify admin API access token
 * @param {string} [options.apiVersion='2025-04'] - The Shopify API version to use
 * @param {number} [options.retries=3] - Number of retries for failed requests
 * @param {number} [options.timeout=30000] - Timeout in ms for requests
 * @returns {Object} A Shopify client with GraphQL capabilities
 */
export function createShopifyClient({ shop, accessToken, apiVersion = '2025-04', retries = 3, timeout = 30000 }) {
  // Log API version only once
  if (!apiVersionLogged) {
    console.log("Using shopify API version " + apiVersion);
    apiVersionLogged = true;
  }
  // Format shop name (remove .myshopify.com if present)
  const shopName = shop.replace('.myshopify.com', '');
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
      if (!type) {
        throw new Error('Type is required for toGid');
      }

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

/**
 * Initialize Shopify API client for a specific job
 * @param {string} cliDir - The directory where cli.js is located (project root)
 * @param {string} jobPath - The job path relative to jobs/
 * @param {string} shopParam - Optional shop domain or name to override the one in job config
 * @returns {Object} The Shopify client
 */
export async function initShopify(cliDir, jobPath, shopParam) {
  try {
    if (!jobPath) {
      throw new Error('jobPath is required to initialize Shopify client.');
    }

    // Use the job-discovery module to load config (supports both .js and .json)
    const { loadJobConfig } = await import('../cli/job-discovery.js');
    const jobConfig = await loadJobConfig(jobPath);

    if (!jobConfig) {
      throw new Error(`Could not load job configuration for: ${jobPath}`);
    }

    // Get shop identifier from job config
    let shopIdentifier = jobConfig.shop;

    const shopworkerFilePath = path.join(cliDir, '.shopworker.json');
    if (!fs.existsSync(shopworkerFilePath)) {
      throw new Error('.shopworker.json file not found. Please create one.');
    }
    const shopworkerFileContent = fs.readFileSync(shopworkerFilePath, 'utf8');
    const shopworkerData = JSON.parse(shopworkerFileContent);

    let shopDetails = null;
    
    // Check if using new format (direct shop config)
    if (shopworkerData.shopify_domain && shopworkerData.shopify_token) {
      shopDetails = shopworkerData;
    } else {
      // Legacy format support
      if (!shopworkerData.shops || !Array.isArray(shopworkerData.shops)) {
        throw new Error('Invalid .shopworker.json format: Missing shop configuration.');
      }

      // If shopParam is provided, look it up in .shopworker.json
      if (shopParam) {
        // Try to find shop by domain or name
        shopDetails = shopworkerData.shops.find(s =>
          s.shopify_domain === shopParam || s.name === shopParam
        );

        if (!shopDetails) {
          throw new Error(`Shop with domain or name '${shopParam}' not found in .shopworker.json.`);
        }
      } else {
        // Use shop from job config
        if (!shopIdentifier) {
          throw new Error(`'shop' not defined in job configuration: ${jobConfigPath}`);
        }

        shopDetails = shopworkerData.shops.find(s => s.name === shopIdentifier);
        if (!shopDetails) {
          throw new Error(`Shop configuration for '${shopIdentifier}' not found in .shopworker.json.`);
        }
      }
    }

    const shopDomain = shopDetails.shopify_domain;
    const accessToken = shopDetails.shopify_token;

    if (!shopDomain) {
      throw new Error(`'shopify_domain' not set for shop '${shopDetails.name}' in .shopworker.json`);
    }
    if (!accessToken) {
      throw new Error(`'shopify_token' not set for shop '${shopDetails.name}' in .shopworker.json`);
    }

    return createShopifyClient({
      shop: shopDomain,
      accessToken,
      apiVersion: jobConfig.apiVersion // Let createShopifyClient handle the default
    });
  } catch (error) {
    console.error(`Failed to initialize Shopify API for job '${jobPath}': ${error.message}`);
    if (error.cause) console.error('Cause:', error.cause);
    process.exit(1); // Critical failure
  }
}
