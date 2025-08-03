import GetOrderWithMetafields from "../../graphql/orderGetWithMetafields.js";
import OrderInvoiceSend from "../../graphql/orderInvoiceSend.js";
import OrderMetafieldUpdate from "../../graphql/orderMetafieldUpdate.js";

/**
 * Process an order update to check if the note has changed and trigger email confirmation
 * @param {Object} params - Parameters for the job
 * @param {Object} params.payload - The order object from Shopify webhook
 * @param {Object} params.shopify - Shopify API client
 */
export async function process({ payload: order, shopify }) {
  console.log(`Processing order note change check for order ${order.name || order.id}`);

  // Get the current order with full details including metafields
  const { order: fullOrder } = await shopify.graphql(GetOrderWithMetafields, {
    id: shopify.toGid(order.id, "Order")
  });

  if (!fullOrder) {
    console.error(`Could not fetch order details for ${order.id}`);
    return;
  }

  const currentNote = fullOrder.note || "";

  // Find the previous_note metafield
  let previousNote = "";
  let previousNoteMetafieldId = null;

  if (fullOrder.metafields && fullOrder.metafields.edges) {
    const metafield = fullOrder.metafields.edges.find(edge =>
      edge.node.key === "previous_note" && edge.node.namespace === "custom"
    );

    if (metafield) {
      previousNote = metafield.node.value || "";
      previousNoteMetafieldId = metafield.node.id;
    }
  }

  console.log(`Current note: "${currentNote}"`);
  console.log(`Previous note: "${previousNote}"`);

  // Compare current note with previous note
  if (currentNote === previousNote) {
    console.log(`Order note unchanged for ${fullOrder.name || fullOrder.id}. No action needed.`);
    return;
  }

  console.log(`Order note has changed for ${fullOrder.name || fullOrder.id}. Triggering email confirmation.`);

  // Send order confirmation email (using invoice send as order confirmation)
  try {
    await sendOrderConfirmationEmail(shopify, fullOrder);
    console.log(`Successfully sent order confirmation email for ${fullOrder.name || fullOrder.id}`);
  } catch (error) {
    console.error(`Failed to send order confirmation email for ${fullOrder.name || fullOrder.id}:`, error.message);
    // Continue with metafield update even if email fails
  }

  // Update the previous_note metafield with the current note
  await updatePreviousNoteMetafield(shopify, fullOrder, currentNote, previousNoteMetafieldId);

  console.log(`Successfully processed order note change for ${fullOrder.name || fullOrder.id}`);
}

/**
 * Send order confirmation email using the OrderInvoiceSend mutation
 */
async function sendOrderConfirmationEmail(shopify, order) {
  if (!order.email) {
    console.log(`No email address found for order ${order.name || order.id}. Skipping email.`);
    return;
  }

  const emailData = {
    to: order.email,
    subject: `Order Confirmation - ${order.name}`,
    customMessage: "Thank you for your order! Your order details have been updated."
  };

  const response = await shopify.graphql(OrderInvoiceSend, {
    orderId: order.id,
    email: emailData
  });

  const result = response.orderInvoiceSend;

  if (result?.userErrors?.length > 0) {
    const errors = result.userErrors.map(err => err.message).join(", ");
    throw new Error(`Failed to send order confirmation email: ${errors}`);
  }

  if (!result?.order) {
    throw new Error("Failed to get order confirmation from email send response");
  }
}

/**
 * Update the previous_note metafield with the current note value
 */
async function updatePreviousNoteMetafield(shopify, order, currentNote, existingMetafieldId) {
  const metafieldInput = {
    namespace: "custom",
    key: "previous_note",
    value: currentNote,
    type: "single_line_text_field"
  };

  // If metafield exists, include its ID for update
  if (existingMetafieldId) {
    metafieldInput.id = existingMetafieldId;
  }

  const input = {
    id: order.id,
    metafields: [metafieldInput]
  };

  const response = await shopify.graphql(OrderMetafieldUpdate, { input });
  const result = response.orderUpdate;

  if (result?.userErrors?.length > 0) {
    const errors = result.userErrors.map(err => `${err.field}: ${err.message}`).join(", ");
    throw new Error(`Failed to update previous_note metafield: ${errors}`);
  }

  if (!result?.order) {
    throw new Error("Failed to get order confirmation from metafield update response");
  }

  console.log(`Successfully updated previous_note metafield for ${result.order.name || result.order.id}`);
}
