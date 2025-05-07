import 'dotenv/config';
import OrderInvoiceSend from "../../graphql/OrderInvoiceSend.js";
import GetOrderWithPrice from "../../graphql/GetOrderWithPrice.js";

function validateEnvironment(env) {
  if (!env.MOLLIE_API_KEY) {
    throw new Error("MOLLIE_API_KEY is not configured in the environment.");
  }
  if (!env.SHOP) {
    throw new Error("SHOP (Shopify domain) is not configured in the environment.");
  }
}

async function getAugmentedOrderDetails(originalOrder, shopify) {
  const orderId = shopify.toGid(originalOrder.id, 'Order');
  console.log(`Fetching detailed order information for ID: ${orderId}`);
  const orderData = await shopify.graphql(GetOrderWithPrice, { id: orderId });
  const orderDetails = orderData.order;
  if (!orderDetails) {
    throw new Error(`Could not fetch order details for ID: ${orderId}`);
  }
  return { ...orderDetails, GID: orderId }; // Return GID along with details
}

function extractPricing(orderDetails) {
  let amount, currencyCode;
  if (orderDetails.currentTotalPriceSet && orderDetails.currentTotalPriceSet.presentmentMoney) {
    amount = orderDetails.currentTotalPriceSet.presentmentMoney.amount;
    currencyCode = orderDetails.currentTotalPriceSet.presentmentMoney.currencyCode;
  } else {
    console.warn(`currentTotalPriceSet.presentmentMoney not available for order ${orderDetails.name}, falling back to totalPrice.`);
    amount = orderDetails.totalPrice;
    currencyCode = orderDetails.currencyCode;
  }

  if (!amount || !currencyCode) {
    console.error("Order details for pricing error:", JSON.stringify(orderDetails, null, 2));
    throw new Error(`Order is missing required price information. Amount: ${amount}, Currency: ${currencyCode}`);
  }
  return { amount: parseFloat(amount).toFixed(2), currencyCode };
}

function buildMolliePayload(orderDetails, env, formattedAmount, currencyCode) {
  const SHOP_DOMAIN = env.SHOP;
  const WEBHOOK_URL = env.MOLLIE_WEBHOOK_URL; // Optional

  const orderNumber = orderDetails.name && orderDetails.name.startsWith('#') ? orderDetails.name.substring(1) : orderDetails.name;
  const redirectUrl = `https://${SHOP_DOMAIN}/admin/orders/${orderNumber}`;

  const payload = {
    amount: { currency: currencyCode, value: formattedAmount },
    description: `Payment for order ${orderDetails.name}`,
    redirectUrl: redirectUrl,
  };
  if (WEBHOOK_URL) {
    payload.webhookUrl = WEBHOOK_URL;
  }
  return payload;
}

async function callMollieToCreatePaymentLink(payload, apiKey) {
  console.log("Mollie API Request Body:", JSON.stringify(payload, null, 2));
  const response = await fetch("https://api.mollie.com/v2/payment-links", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify(payload)
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Mollie API responded with status: ${response.status}. Details: ${responseText}`);
  }

  const mollieData = JSON.parse(responseText);
  console.log("Mollie API Response Body:", JSON.stringify(mollieData, null, 2));

  // Use the user's specified path for the payment link
  const paymentLink = mollieData?._links?.paymentLink?.href;
  if (!paymentLink) {
    // Fallback or more specific error if the user's path also fails.
    // For now, let's assume the user's path is what they expect if primary fails.
    // Could also check mollieData?._links?.checkout?.href here as an alternative.
    console.warn("Failed to find paymentLink at mollieData?._links?.paymentLink?.href. Full Mollie response:", mollieData);
    throw new Error(`Failed to get payment link URL from Mollie API response. Expected at '_links.paymentLink.href'.`);
  }
  return paymentLink;
}

async function sendShopifyInvoiceWithLink(orderId, paymentLink, shopify) {
  const customMessage = `Thank you for your order! Please complete your payment using this link: ${paymentLink}`;
  const variables = { orderId, customMessage };
  await shopify.graphql(OrderInvoiceSend, variables);
  console.log(`Successfully sent invoice for order ${orderId} with payment link`);
}

/**
 * Process an order to create a Mollie payment link and set it as the custom message on the order invoice
 * @param {Object} order - The order object from Shopify GraphQL API (initial, might be minimal)
 * @param {Object} shopify - Shopify API client
 * @param {Object} env - Environment variables specific to the job's execution context
 */
export async function process(order, shopify, env) {
  validateEnvironment(env);

  const orderDetails = await getAugmentedOrderDetails(order, shopify);

  const { amount: formattedAmount, currencyCode } = extractPricing(orderDetails);

  console.log(`Preparing Mollie payment link for order ${orderDetails.name} with amount ${formattedAmount} ${currencyCode}`);

  const molliePayload = buildMolliePayload(orderDetails, env, formattedAmount, currencyCode);

  const paymentLink = await callMollieToCreatePaymentLink(molliePayload, env.MOLLIE_API_KEY);
  console.log(`Created Mollie payment link: ${paymentLink}`);

  await sendShopifyInvoiceWithLink(orderDetails.GID, paymentLink, shopify);
}
