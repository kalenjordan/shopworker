import OrderInvoiceSend from "../../graphql/OrderInvoiceSend.js";

/**
 * Process an order to fetch data from an external API and set it as the custom message on the order invoice
 * @param {Object} order - The order object from Shopify GraphQL API
 * @param {Object} shopify - Shopify API client
 */
export async function process(order, shopify) {
  console.log(`Processing order ${order.id}`);

  // Fetch data from the external API
  const response = await fetch("https://jsonplaceholder.typicode.com/posts/1");

  if (!response.ok) {
    throw new Error(`External API responded with status: ${response.status}`);
  }

  const data = await response.json();

  // Use the body from the API response as the custom message
  const customMessage = data.body;

  console.log(`Custom message from API: ${customMessage}`);

  // Extract orderId
  const orderId = order.id;

  console.log(`Using order ID: ${orderId}`);

  // Use the imported GraphQL mutation with proper variables structure
  const variables = {
    orderId: orderId,
    customMessage: customMessage
  };

  console.log(`Using variables: ${JSON.stringify(variables, null, 2)}`);

  console.log("graphql: ", OrderInvoiceSend);
  const result = await shopify.graphql(OrderInvoiceSend, variables);

  if (result.orderInvoiceSend.userErrors && result.orderInvoiceSend.userErrors.length > 0) {
    console.error("Error sending invoice:", result.orderInvoiceSend.userErrors);
    return;
  }

  console.log(`Successfully sent invoice for order ${orderId} with custom message`);
}
