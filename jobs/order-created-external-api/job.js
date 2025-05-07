import OrderInvoiceSend from "../../graphql/OrderInvoiceSend.js";

/**
 * Process an order to fetch data from an external API and set it as the custom message on the order invoice
 * @param {Object} params - Parameters for the job
 * @param {Object} params.order - The order object from Shopify GraphQL API
 * @param {Object} params.shopify - Shopify API client
 * @param {Object} [params.env] - Environment variables (not used by this job)
 */
export async function process({ record: order, shopify }) {
  // Fetch data from the external API
  console.log("Fetching data from external API...");
  const externalApiResponse = await fetch("https://jsonplaceholder.typicode.com/posts/1");

  if (!externalApiResponse.ok) {
    throw new Error(`External API responded with status: ${externalApiResponse.status}`);
  }

  const externalData = await externalApiResponse.json();

  // Use the body from the API response as the custom message
  const customMessage = externalData.body;

  if (!customMessage) {
    console.warn("External API did not return a 'body' field.", externalData);
    throw new Error("Could not extract custom message from external API response.");
  }

  console.log(`Custom message from API: ${customMessage}`);

  // Extract orderId and ensure it's in the correct GID format
  // Use destructured 'order' and 'shopify'
  const orderId = shopify.toGid(order.id, 'Order');

  console.log(`Using order ID: ${orderId} to send invoice`);

  // Use the imported GraphQL mutation with proper variables structure
  const variables = {
    orderId: orderId,
    customMessage: customMessage
  };

  await shopify.graphql(OrderInvoiceSend, variables);
  console.log(`Successfully sent invoice for order ${orderId} with custom message`);
}
