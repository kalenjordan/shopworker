/**
 * Tag Product When Updated Job
 *
 * This job adds a last-modified date tag to products when they are updated
 */

import ProductUpdate from '../../graphql/ProductUpdate.js';

/**
 * Formats the current date as YYYY-MM-DD
 * @returns {string} Formatted date string
 */
function getFormattedDate() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Process a product update and add a last-modified tag
 * @param {Object} options - Options object
 * @param {Object} options.record - Shopify product data
 * @param {Object} options.shopify - Shopify API client
 * @param {Object} options.env - Environment variables
 */
export async function process({ record: productData, shopify, env }) {
  console.log("====== Processing product update to add last-modified tag ======");
  console.log("Payload: ", productData);

  try {
    const productId = shopify.toGid(productData.id, "Product");
    console.log(`Processing product: ${productData.title} (${productId})`);

    // Create a last-modified tag with today's date
    const formattedDate = getFormattedDate();
    const newTag = `title-last-modified-${formattedDate}`;

    // Filter out any existing last-modified tags
    let existingTags = productData.tags || [];
    const filteredTags = existingTags.filter(tag => !tag.startsWith('last-modified-'));

    // Add the new tag
    const updatedTags = [...filteredTags, newTag];

    // Update the product with the new tags
    const updateResponse = await shopify.graphql(ProductUpdate, {
      input: {
        id: productId,
        tags: updatedTags
      }
    });

    // Check for errors
    if (updateResponse.productUpdate.userErrors && updateResponse.productUpdate.userErrors.length > 0) {
      const errors = updateResponse.productUpdate.userErrors.map(err => err.message).join(", ");
      throw new Error(`Failed to update product tags: ${errors}`);
    }

    console.log(`Successfully added/updated last-modified tag to: "${newTag}"`);
    console.log(`Updated tags: ${updatedTags.join(', ')}`);

    return {
      success: true,
      productId: productId,
      addedTag: newTag,
      removedTags: existingTags.length - filteredTags.length
    };
  } catch (error) {
    console.error(`Error updating product with last-modified tag: ${error.message}`);
    throw error;
  }
}
