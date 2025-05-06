import ProductMetafieldUpdate from "../../graphql/ProductMetafieldUpdate.js";
/**
 * Updates a product metafield with the last modified date
 * @param {Object} product - The product object from Shopify GraphQL API
 * @param {Object} shopify - Shopify API client
 */
export async function process(product, shopify) {
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
    id: "gid://shopify/Product/" + product.id,
    metafields: metafields,
  };

  console.log(`Updating metafield with value: ${currentDate}`);

  // Execute the mutation
  const response = await shopify.graphql(ProductMetafieldUpdate, {
    input: input,
  });

  const result = response.productUpdate;

  console.log(`Successfully updated metafield for product: ${result.product.title}`);
}
