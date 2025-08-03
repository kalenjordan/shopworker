/**
 * Tag Product When Updated Job
 *
 * This job adds a last-modified date tag to products when they are updated
 */

import ProductUpdate from '../../graphql/productUpdate.js';

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
 * Process a product update and add a last-modified tag using workflow steps
 * This function is called by the JobDispatcher workflow
 * @param {Object} options - Options object
 * @param {Object} options.payload - Shopify product data
 * @param {Object} options.shopify - Shopify API client
 * @param {Object} options.step - Workflow step function
 */
export async function process({ payload: productData, shopify, step }) {
  console.log("====== Processing product update to add last-modified tag ======", productData);

  // Step 1: Prepare product data and tag information
  const { productId, newTag, updatedTags } = await step.do("prepare-tag-data", async () => {
    const productId = shopify.toGid(productData.id, "Product");
    console.log(`Processing product: ${productData.title} (${productId})`);

    // Create a last-modified tag with today's date
    const formattedDate = getFormattedDate();
    const newTag = `title-last-modified-${formattedDate}`;

    // Filter out any existing last-modified tags
    let existingTags = productData.tags || [];
    const filteredTags = existingTags.filter(tag => !tag.startsWith('title-last-modified-'));

    // Add the new tag
    const updatedTags = [...filteredTags, newTag];

    return {
      productId,
      newTag,
      updatedTags,
      removedCount: existingTags.length - filteredTags.length
    };
  });

  // Step 2: Update the product with the new tags
  const result = await step.do("update-product-tags", async () => {
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
      updatedTags: updatedTags,
      updateResponse: updateResponse.productUpdate
    };
  });

  return result;
}
