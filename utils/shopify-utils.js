/**
 * Creates a wrapped graphql client that automatically checks for and handles Shopify userErrors
 * @param {Function} graphqlFn - The original graphql function to wrap
 * @param {Object} logger - Logger object for reporting errors
 * @returns {Function} - Wrapped graphql function that returns the API response data
 */
export function createGraphQLClient(graphqlFn, logger) {
  return async (query, options) => {
    // Make the original GraphQL call
    const result = await graphqlFn(query, options);

    // Check if response contains any userErrors field at any level
    const userErrors = findUserErrors(result.data);

    if (userErrors && userErrors.length > 0) {
      // Format error messages from userErrors
      const errorMessages = userErrors
        .map(error => `${error.field ? error.field + ': ' : ''}${error.message}`)
        .join(", ");

      // Log the error
      if (logger) {
        logger.error(`GraphQL Error: ${errorMessages}`);
      }

      // Throw error with formatted message
      throw new Error(errorMessages);
    }

    // Return the result data directly
    return result;
  };
}

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
 * Wraps a Shopify client instance to handle GraphQL user errors automatically
 * @param {Object} shopifyClient - The original Shopify client to wrap
 * @returns {Object} - Wrapped Shopify client with error handling
 */
export function wrapShopifyClient(shopifyClient) {
  // Store the original graphql method
  const originalGraphql = shopifyClient.graphql.bind(shopifyClient);

  // Replace with wrapped version that uses console.log directly
  shopifyClient.graphql = async (query, options) => {
    try {
      // Make the original GraphQL call
      const result = await originalGraphql(query, options);

      // Check if response contains any userErrors field at any level
      const userErrors = findUserErrors(result.data);

      if (userErrors && userErrors.length > 0) {
        // Format error messages from userErrors
        const errorMessages = userErrors
          .map(error => `${error.field ? error.field + ': ' : ''}${error.message}`)
          .join(", ");

        // Print a simplified error message
        console.error(`GraphQL Error: ${errorMessages}`);

        // Exit the process with error code
        console.error('Terminating process due to Shopify API error');
        process.exit(1);
      }

      // Return the result data directly
      return result;
    } catch (error) {
      // This catches both our custom errors and request-level errors

      // Print helpful error details without the stack trace
      console.error('Shopify API Error:', error.message);
      console.error('Query:', truncateQuery(query));

      if (options && Object.keys(options).length > 0) {
        console.error('Variables:', JSON.stringify(options, null, 2));
      }

      // Exit the process with error code
      console.error('Terminating process due to Shopify API error');
      process.exit(1);
    }
  };

  return shopifyClient;
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
