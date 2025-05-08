/**
 * Tag Product When Updated Job
 *
 * This job adds a timestamp tag to products when they are updated
 */

const GET_PRODUCT_BY_ID = `
  query getProductById($id: ID!) {
    product(id: $id) {
      id
      title
      tags
    }
  }
`;

const UPDATE_PRODUCT_TAGS = `
  mutation productUpdate($input: ProductUpdateInput!) {
    productUpdate(input: $input) {
      product {
        id
        title
        tags
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Formats a date as YYYY-MM-DD-HH-MM-SS
 * @returns {string} Formatted date string
 */
function getFormattedTimestamp() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `updated-${year}-${month}-${day}-${hours}-${minutes}-${seconds}`;
}

/**
 * Process a product update and add a timestamp tag
 * @param {Object} options - Options object
 * @param {Object} options.record - Shopify product data
 * @param {Object} options.shopify - Shopify API client
 * @param {Object} options.env - Environment variables
 */
export async function process({ record: productData, shopify, env }) {
  console.log("Payload: ", productData);

  // try {
  //   // Convert ID to GID format if needed
  //   let productId = productData.id;
  //   if (!productId.startsWith('gid://')) {
  //     productId = shopify.toGid(productId, "Product");
  //   }

  //   // Get current product data including existing tags
  //   const { product } = await shopify.graphql(GET_PRODUCT_BY_ID, { id: productId });

  //   // Create a timestamp tag
  //   const timestampTag = getFormattedTimestamp();

  //   // Combine existing tags with new timestamp tag
  //   const existingTags = product.tags || [];
  //   const updatedTags = [...existingTags, timestampTag];

  //   // Update the product with the new tags
  //   const updateResponse = await shopify.graphql(UPDATE_PRODUCT_TAGS, {
  //     input: {
  //       id: productId,
  //       tags: updatedTags
  //     }
  //   });

  //   // Check for errors
  //   if (updateResponse.productUpdate.userErrors && updateResponse.productUpdate.userErrors.length > 0) {
  //     const errors = updateResponse.productUpdate.userErrors.map(err => err.message).join(", ");
  //     throw new Error(`Failed to update product tags: ${errors}`);
  //   }

  //   console.log(`Successfully added timestamp tag "${timestampTag}" to product ${product.title}`);
  //   console.log(`Updated tags: ${updatedTags.join(', ')}`);

    return {
      success: true,
      productId: productData.id,
  };
}
