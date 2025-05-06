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
