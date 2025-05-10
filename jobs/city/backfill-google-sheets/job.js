import GetOrderById from "../../../graphql/GetOrderById.js";
/**
 * Process an order to tag it with the SKUs from its line items
 * @param {Object} params - Parameters for the job
 * @param {Object} params.record - The order object from Shopify GraphQL API
 * @param {Object} params.shopify - Shopify API client
 * @param {Object} [params.env] - Environment variables (not used by this job)
 */
export async function process({ record, shopify }) {
  // For manual testing, if no order ID is provided, use a default test order ID
  // or fetch a recent order
  let orderId;

  if (record && record.id) {
    // If we have a record with an ID, use it
    orderId = shopify.toGid(record.id, "Order");
  } else {
    // For manual testing, provide a test order ID or fetch one
    console.log("No order ID provided. Using a default test order ID.");
    // Replace this with an actual order ID from your store for testing
    orderId = "gid://shopify/Order/5469955293434"; // Example ID - replace with a real one
  }

  const { order } = await shopify.graphql(GetOrderById, { id: orderId });

  console.log(order);
}
