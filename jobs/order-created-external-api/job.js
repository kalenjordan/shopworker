import OrderInvoiceSend from "../../graphql/OrderInvoiceSend.js";

/**
 * Process an order to fetch data from an external API and set it as the custom message on the order invoice
 * @param {Object} order - The order object from Shopify GraphQL API
 * @param {Object} shopify - Shopify API client
 */
export async function process(order, shopify) {
  // Fetch data from the external API
  const response = await fetch("https://jsonplaceholder.typicode.com/posts/1");

  if (!response.ok) {
    throw new Error(`External API responded with status: ${response.status}`);
  }

  const data = await response.json();

  // Use the body from the API response as the custom message
  const customMessage = data.body;

  console.log(`Custom message from API: ${customMessage}`);

  // Extract orderId and ensure it's in the correct GID format
  const orderId = shopify.toGid(order.id, 'Order');

  console.log(`Using order ID: ${orderId}`);

  // Use the imported GraphQL mutation with proper variables structure
  const variables = {
    orderId: orderId,
    customMessage: customMessage
  };

  await shopify.graphql(OrderInvoiceSend, variables);
  console.log(`Successfully sent invoice for order ${orderId} with custom message`);
}
