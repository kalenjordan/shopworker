import OrderUpdate from "../../graphql/orderUpdate.js";

/**
 * Process an order to tag it with the SKUs from its line items
 * @param {Object} params - Parameters for the job
 * @param {Object} params.order - The order object from Shopify GraphQL API
 * @param {Object} params.shopify - Shopify API client
 * @param {Object} [params.env] - Environment variables (not used by this job)
 */
export async function process({ payload: order, shopify }) {
  // Extract SKUs from line items
  const skus = [];

  if (order.lineItems && order.lineItems.edges) {
    for (const edge of order.lineItems.edges) {
      const item = edge.node;
      // Try to get SKU from variant first, then from line item
      const sku = item?.variant?.sku || item?.sku; // Added optional chaining
      if (sku && !skus.includes(sku)) {
        skus.push(sku);
      }
    }
  }

  if (skus.length === 0) {
    console.log(`No SKUs found in order ${order.name || order.id}`);
    return; // No SKUs to add, so exit early
  }

  console.log(`Found SKUs for order ${order.name || order.id}: ${skus.join(", ")}`);

  // Current tags should be available in the order response
  const currentTags = order.tags || [];

  // Add SKUs as tags if they don't already exist
  let tagsChanged = false;
  const newTags = [...currentTags];
  for (const sku of skus) {
    if (!newTags.includes(sku)) {
      newTags.push(sku);
      tagsChanged = true;
    }
  }

  // If no new tags to add, skip the update
  if (!tagsChanged) {
    console.log(`SKU tags already present on order ${order.name || order.id}`);
    return;
  }

  // Prepare variables for the OrderUpdate mutation
  const variables = {
    input: {
      id: order.id, // Assuming order.id is the GID from the webhook payload
      tags: newTags,
    },
  };

  console.log(`Updating order ${order.name || order.id} with tags: ${newTags.join(", ")}`);

  // Use destructured 'shopify' client
  const response = await shopify.graphql(OrderUpdate, variables);
  const result = response.orderUpdate;

  if (result?.userErrors?.length > 0) {
    const errors = result.userErrors.map(err => `${err.field}: ${err.message}`).join(", ");
    throw new Error(`Failed to update order tags for order ${order.id}: ${errors}`);
  }

  if (!result?.order) {
    throw new Error(`Failed to get order details from update response for order ${order.id}. Response: ${JSON.stringify(response)}`);
  }

  console.log(`Successfully updated order tags for ${result.order.name || result.order.id}: ${result.order.tags.join(", ")}`);
}
