import ProductMetafieldUpdate from "../../graphql/ProductMetafieldUpdate.js";
/**
 * Updates a product metafield with the last modified date
 * @param {Object} product - The product object from Shopify GraphQL API
 * @param {Object} shopify - Shopify API client
 */
export async function process(product, shopify) {
  console.log(`Processing product: ${product.title} (${product.id})`);

  // Format the current date in ISO format
  const currentDate = new Date().toISOString();

  // Define metafield input
  const metafields = [
    {
      namespace: "custom",
      key: "last_modified",
      value: currentDate,
      type: "date_time",
    },
  ];

  // Prepare the input for the mutation
  const input = {
    id: product.id,
    metafields: metafields,
  };

  console.log(`Updating metafield with value: ${currentDate}`);

  // Execute the mutation
  const response = await shopify.graphql(ProductMetafieldUpdate, {
    input: input,
  });

  const result = response.productUpdate;

  if (result.userErrors && result.userErrors.length > 0) {
    console.error("Error updating product metafield:", result.userErrors);
    return;
  }

  console.log(`Successfully updated metafield for product: ${result.product.title}`);
}
