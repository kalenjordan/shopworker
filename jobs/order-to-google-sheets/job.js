import GetOrderById from '../../graphql/GetOrderById.js';
import * as GoogleSheets from '../../connectors/google-sheets.js';

/**
 * Format date as YYYY-MM-DD
 * @param {string} isoDate - ISO format date
 * @returns {string} Formatted date
 */
function formatDate(isoDate) {
  const date = new Date(isoDate);
  return date.toISOString().split('T')[0]; // Returns YYYY-MM-DD
}

/**
 * Format order data for the Google Sheet
 * @param {Object} order - Shopify order data
 * @param {Object} shopify - Shopify client with utility methods
 * @returns {Array} Array of rows for the sheet (one per line item)
 */
function formatOrderForSheet(order, shopify) {
  if (!order) return [];

  // Get shipping address information
  const shippingAddress = order.shippingAddress || {};

  // Get customer information
  const customer = order.customer || {};

  // Format tags properly - ensure it's a string
  const tags = Array.isArray(order.tags) ? order.tags.join(', ') : (order.tags || '');

  // Get tracking number if available
  let trackingNumber = '';
  if (order.fulfillments && order.fulfillments.length > 0) {
    const fulfillment = order.fulfillments[0];
    if (fulfillment.trackingInfo && fulfillment.trackingInfo.length > 0) {
      trackingNumber = fulfillment.trackingInfo[0].number || '';
    }
  }

  // Format order number - remove '#' if present
  const orderNumber = order.name ? order.name.replace('#', '') : (order.id || '');

  // Extract regular ID from GID
  const orderId = shopify.fromGid(order.id);

  // Common order data
  const orderData = {
    date: formatDate(order.createdAt || new Date()),
    orderNumber,
    tags,
    firstName: shippingAddress.firstName || customer.firstName || '',
    lastName: shippingAddress.lastName || customer.lastName || '',
    company: shippingAddress.company || customer.company || '',
    shippingAddress: shippingAddress.address1 || '',
    shippingZipCode: shippingAddress.zip || '',
    shippingCity: shippingAddress.city || '',
    shippingCountry: shippingAddress.country || '',
    phone: shippingAddress.phone || customer.phone || order.phone || '',
    totalPrice: order.totalPrice ? `${order.totalPrice}` : '',
    email: customer.email || order.email || '',
    trackingNumber,
    row: '',
    reminderEmail: '',
    id: orderId || ''
  };

  // Log order data with headers
  console.log("\nOrder data:");
  Object.entries(orderData).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`);
  });

  // Extract line items from the GraphQL response
  const lineItems = [];
  if (order.lineItems && order.lineItems.edges) {
    order.lineItems.edges.forEach(edge => {
      if (edge.node) {
        const item = {
          ...edge.node,
          sku: edge.node.variant?.sku || '',
          variantTitle: edge.node.variant?.title || ''
        };
        lineItems.push(item);
      }
    });
  }

  // Log line items
  console.log(`Line Items (${lineItems.length}):`);
  lineItems.forEach((item, index) => {
    console.log(`  Item ${index + 1}:`);
    // Log only key properties we care about
    ['sku', 'quantity', 'title', 'variantTitle'].forEach(prop => {
      console.log(`    ${prop}: ${item[prop] || ''}`);
    });
  });

  // Throw error if no line items
  if (lineItems.length === 0) {
    throw new Error('No line items found in order');
  }

  // Create a row for each line item
  return lineItems.map(item => [
    orderData.date,                // Date
    orderData.orderNumber,         // Order Number
    item.sku || '',                // SKU
    item.quantity || '',           // Quantity
    orderData.tags,                // Tags
    orderData.firstName,           // First Name
    orderData.lastName,            // Last Name
    orderData.company,             // Company
    orderData.shippingAddress,     // Shipping Address
    orderData.shippingZipCode,     // Shipping ZipCode
    orderData.shippingCity,        // Shipping City
    orderData.shippingCountry,     // Shipping Country
    orderData.phone,               // Phone
    orderData.totalPrice,          // Total Price
    orderData.email,               // Email
    orderData.trackingNumber,      // Tracking number
    orderData.row,                 // Row
    orderData.reminderEmail,       // reminder email
    orderData.id                   // ID
  ]);
}

/**
 * Process a Shopify order and add it to Google Sheets
 * @param {Object} options - Options object
 * @param {Object} options.record - Shopify order data
 * @param {Object} options.shopify - Shopify API client
 * @param {Object} options.env - Environment variables
 */
export async function process({ record: orderData, shopify, env }) {
  // Set the spreadsheet ID from environment
  if (!env.google_sheet_id) {
    throw new Error('Missing required env.google_sheet_id configuration');
  }
  const spreadsheetId = env.google_sheet_id;

  // Default sheet name
  const sheetName = 'Blad1';

  // Make sure we have Google Sheets credentials
  if (!env.google_sheets_credentials) {
    throw new Error('Missing required env.google_sheets_credentials configuration');
  }

  // Create Google Sheets client once
  const sheetsClient = await GoogleSheets.createSheetsClient(env.google_sheets_credentials);

  // Make sure we have a valid order ID
  if (!orderData.id) {
    throw new Error('No order ID provided');
  }

  let orderId = shopify.toGid(orderData.id);

  // Query the order details via GraphQL
  const { order } = await shopify.graphql(GetOrderById, {
    id: orderId
  });

  // Check if sheet is initialized with headers
  const headerData = await GoogleSheets.getSheetData(
    sheetsClient,
    spreadsheetId,
    `${sheetName}!A1:Z1`
  );

  // Throw error if sheet is not initialized
  if (!headerData || headerData.length === 0 || !headerData[0] || headerData[0].length === 0) {
    throw new Error(`Sheet is not initialized with headers. Please create the sheet first.`);
  }

  // Format the order data for the sheet - now returns array of rows
  // Pass the shopify client to use its utility methods like fromGid
  const orderRows = formatOrderForSheet(order, shopify);
  if (!orderRows.length) {
    throw new Error('Failed to format order data');
  }

  console.log(`\nAdding ${orderRows.length} rows to sheet for order ${order.name || order.id}`);

  // Append the order data to the sheet
  const appendResult = await GoogleSheets.appendSheetData(
    sheetsClient,
    spreadsheetId,
    `${sheetName}!A1`,
    orderRows,
    'USER_ENTERED'
  );

  console.log(`Order data added to Google Sheet at range: ${appendResult.updates?.updatedRange || 'unknown'}`);
}
