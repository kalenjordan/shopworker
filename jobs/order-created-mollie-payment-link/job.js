import 'dotenv/config';
import OrderInvoiceSend from "../../graphql/OrderInvoiceSend.js";
import GetOrderWithPrice from "../../graphql/GetOrderWithPrice.js";

/**
 * Process an order to create a Mollie payment link and set it as the custom message on the order invoice
 * @param {Object} order - The order object from Shopify GraphQL API
 * @param {Object} shopify - Shopify API client
 * @param {Object} env - Environment variables specific to the job's execution context
 */
export async function process(order, shopify, env) {
  // Ensure required environment variables are passed
  if (!env.MOLLIE_API_KEY) {
    throw new Error("MOLLIE_API_KEY is not configured in the environment.");
  }
  if (!env.SHOP) {
    throw new Error("SHOP (Shopify domain) is not configured in the environment.");
  }
  // MOLLIE_WEBHOOK_URL can be optional

  // 1. Fetch complete order details
  const orderId = shopify.toGid(order.id, 'Order');
  console.log(`Fetching detailed order information for ID: ${orderId}`);

  const orderData = await shopify.graphql(GetOrderWithPrice, { id: orderId });
  const orderDetails = orderData.order;

  if (!orderDetails) {
    throw new Error(`Could not fetch order details for ID: ${orderId}`);
  }

  // 2. Extract price and currency information
  let amount, currencyCode;
  if (orderDetails.currentTotalPriceSet && orderDetails.currentTotalPriceSet.presentmentMoney) {
    amount = orderDetails.currentTotalPriceSet.presentmentMoney.amount;
    currencyCode = orderDetails.currentTotalPriceSet.presentmentMoney.currencyCode;
  } else {
    console.warn(`currentTotalPriceSet.presentmentMoney not available for order ${orderDetails.name}, falling back to totalPrice.`);
    amount = orderDetails.totalPrice; // This is a scalar Money value
    currencyCode = orderDetails.currencyCode; // Top-level currencyCode corresponds to scalar money fields
  }

  if (!amount || !currencyCode) {
    console.error("Order details:", JSON.stringify(orderDetails, null, 2));
    throw new Error(`Order is missing required price information. Amount: ${amount}, Currency: ${currencyCode}`);
  }
  const formattedAmount = parseFloat(amount).toFixed(2);

  // 3. Prepare Mollie payment link payload
  const MOLLIE_API_KEY = env.MOLLIE_API_KEY;
  const SHOP_DOMAIN = env.SHOP; // Using env.SHOP for the domain
  const WEBHOOK_URL = env.MOLLIE_WEBHOOK_URL; // Get from env, can be undefined if optional

  // Ensure orderDetails.name is valid, typically like '#1234'
  const orderNumber = orderDetails.name && orderDetails.name.startsWith('#') ? orderDetails.name.substring(1) : orderDetails.name;
  const redirectUrl = `https://${SHOP_DOMAIN}/admin/orders/${orderNumber}`;

  const molliePayload = {
    amount: {
      currency: currencyCode,
      value: formattedAmount
    },
    description: `Payment for order ${orderDetails.name}`,
    redirectUrl: redirectUrl,
  };
  // Conditionally add webhookUrl if it exists
  if (WEBHOOK_URL) {
    molliePayload.webhookUrl = WEBHOOK_URL;
  }

  console.log(`Creating Mollie payment link for order ${orderDetails.name} with amount ${formattedAmount} ${currencyCode}`);
  console.log("Mollie API Request Body:", JSON.stringify(molliePayload, null, 2));

  // 4. Create Mollie payment link
  const response = await fetch("https://api.mollie.com/v2/payment-links", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${MOLLIE_API_KEY}`
    },
    body: JSON.stringify(molliePayload)
  });

  const mollieResponseText = await response.text(); // Get text for logging in all cases
  if (!response.ok) {
    throw new Error(`Mollie API responded with status: ${response.status}. Details: ${mollieResponseText}`);
  }

  const mollieData = JSON.parse(mollieResponseText);
  console.log("Mollie API Response Body:", JSON.stringify(mollieData, null, 2));

  const paymentLink = mollieData?._links?.paymentLink?.href;

  if (!paymentLink) {
    throw new Error(`Failed to get payment link from Mollie API response. Checkout URL not found in _links.checkout.href.`);
  }
  console.log(`Created Mollie payment link: ${paymentLink}`);

  // 5. Send invoice with payment link via Shopify
  const customMessage = `Thank you for your order! Please complete your payment using this link: ${paymentLink}`;
  const variables = {
    orderId: orderId,
    customMessage: customMessage
  };

  await shopify.graphql(OrderInvoiceSend, variables);
  console.log(`Successfully sent invoice for order ${orderId} with payment link`);
}
