import { loadGraphQLQuery } from "../../utils/graphql-utils.js";

/**
 * Updates a product metafield with the last modified date
 * @param {Object} product - The product object from Shopify GraphQL API
 * @param {Object} shopify - Shopify API client
 */
export async function process(product, shopify) {
  console.log(`Processing product: ${product.title} (${product.id})`);

  // Format the current date in ISO format
  const currentDate = new Date().toISOString();

  // Load the product update mutation
  const updateMutation = loadGraphQLQuery("ProductMetafieldUpdate");

  // Define metafield input
  const metafields = [
    {
      namespace: "custom",
      key: "last_modified",
      value: currentDate,
      type: "single_line_text_field",
    },
  ];

  // Prepare the input for the mutation
  const input = {
    id: product.id,
    metafields: metafields,
  };

  console.log(`Updating metafield with value: ${currentDate}`);

  // Execute the mutation
  const response = await shopify.graphql(updateMutation, {
    input: input,
  });

  const result = response.productUpdate;

  if (result.userErrors && result.userErrors.length > 0) {
    console.error("Error updating product metafield:", result.userErrors);
    return;
  }

  console.log(`Successfully updated metafield for product: ${result.product.title}`);

  // Log the updated metafields
  if (result.product.metafields && result.product.metafields.edges) {
    console.log("Updated metafields:");
    for (const edge of result.product.metafields.edges) {
      const metafield = edge.node;
      console.log(`  ${metafield.namespace}.${metafield.key}: ${metafield.value}`);
    }
  }
}
