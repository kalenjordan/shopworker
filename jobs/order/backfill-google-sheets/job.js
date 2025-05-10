import GetOrderById from "../../../graphql/GetOrderById.js";
/**
 * Process an order to tag it with the SKUs from its line items
 * @param {Object} params - Parameters for the job
 * @param {Object} params.order - The order object from Shopify GraphQL API
 * @param {Object} params.shopify - Shopify API client
 * @param {Object} [params.env] - Environment variables (not used by this job)
 */
export async function process({ record, shopify }) {
  // Convert ID to GID format and fetch full order
  const orderId = shopify.toGid(record.id, "Order");
  const { order } = await shopify.graphql(GetOrderById, { id: orderId });

  console.log(order);
}
