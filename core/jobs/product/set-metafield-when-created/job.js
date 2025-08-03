import ProductMetafieldUpdate from "../../graphql/productMetafieldUpdate.js";
/**
 * Updates a product metafield with the last modified date
 * @param {Object} params - Parameters for the job
 * @param {Object} params.product - The product object from Shopify GraphQL API
 * @param {Object} params.shopify - Shopify API client
 * @param {Object} [params.env] - Environment variables (not used by this job)
 */
export async function process({ payload: product, shopify, step }) {
  // Format the current date in ISO format
  const currentDate = new Date().toISOString();

  // Define metafield input
  const metafields = [
    {
      namespace: "custom",
      key: "created_at",
      value: currentDate,
      type: "date_time",
    },
  ];

  // Prepare the input for the mutation
  const input = {
    id: shopify.toGid(product.id, 'Product'),
    metafields: metafields,
  };

  // Execute the mutation within a workflow step
  const result = await step.do("update-product-metafield", async () => {
    console.log(`Updating metafield with value: ${currentDate} for product ID: ${input.id}`);
    
    const response = await shopify.graphql(ProductMetafieldUpdate, {
      input: input,
    });

    // Check for errors
    if (response.productUpdate?.userErrors?.length > 0) {
      const errors = response.productUpdate.userErrors.map(err => `${err.field}: ${err.message}`).join(", ");
      console.error(`Failed to update metafield for product ${input.id}: ${errors}`);
      throw new Error(`Failed to update metafield: ${errors}`);
    }

    const updateResult = response.productUpdate;

    if (!updateResult || !updateResult.product) {
      console.error("Unexpected response structure from productUpdate mutation:", response);
      throw new Error("Failed to get product details from update response.");
    }

    console.log(`Successfully updated metafield for product: ${updateResult.product.title}`);
    
    return updateResult;
  });

  return result;
}
