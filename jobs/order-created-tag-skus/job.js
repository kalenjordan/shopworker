import { loadGraphQLQuery } from '../../utils/graphql-utils.js';

/**
 * Process an order to tag it with the SKUs from its line items
 * @param {Object} order - The order object from Shopify GraphQL API
 * @param {Object} shopify - Shopify API client
 */
export async function process(order, shopify) {
  try {
    // Extract SKUs from line items
    const skus = [];
    if (order.lineItems && order.lineItems.edges) {
      for (const edge of order.lineItems.edges) {
        const item = edge.node;
        // Try to get SKU from variant first, then from line item
        const sku = (item.variant && item.variant.sku) || item.sku;
        if (sku && !skus.includes(sku)) {
          skus.push(sku);
        }
      }
    }

    if (skus.length === 0) {
      console.log('No SKUs found in order');
      return;
    }

    console.log(`Found SKUs: ${skus.join(', ')}`);

    // Current tags should be available in the order response
    const currentTags = order.tags || [];

    // Add SKUs as tags if they don't already exist
    const newTags = [...currentTags];
    for (const sku of skus) {
      if (!newTags.includes(sku)) {
        newTags.push(sku);
      }
    }

    // If no new tags to add, skip the update
    if (newTags.length === currentTags.length) {
      console.log('No new tags to add');
      return;
    }

    // Load the order update mutation
    const updateMutation = loadGraphQLQuery('orderUpdate');

    const response = await shopify.graphql(updateMutation, {
      input: {
        id: order.id,
        tags: newTags
      }
    });

    const result = response.orderUpdate;

    if (result.userErrors && result.userErrors.length > 0) {
      console.error('Error updating order tags:', result.userErrors);
      return;
    }

    console.log(`Successfully updated order tags: ${result.order.tags.join(', ')}`);
  } catch (error) {
    console.error('Error processing order:', error);
  }
}
