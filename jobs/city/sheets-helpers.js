/**
 * City client-specific Google Sheets helper functions
 */
import * as GoogleSheets from "../../connectors/google-sheets.js";

// Define column mappings specific to City's spreadsheet
export const COLUMN_MAPPINGS = [
  { key: "date", label: "Date" },
  { key: "orderNumber", label: "Order Number" },
  { key: "sku", label: "SKU" },
  { key: "quantity", label: "Quantity" },
  { key: "tags", label: "Tags" },
  { key: "firstName", label: "First Name" },
  { key: "lastName", label: "Last Name" },
  { key: "company", label: "Company" },
  { key: "shippingAddress", label: "Shipping Address" },
  { key: "shippingZipCode", label: "Shipping ZipCode" },
  { key: "shippingCity", label: "Shipping City" },
  { key: "shippingCountry", label: "Shipping Country" },
  { key: "phone", label: "Phone" },
  { key: "totalPrice", label: "Total Price" },
  { key: "email", label: "Email" },
  { key: "trackingNumber", label: "Tracking number" },
  { key: "row", label: "Row" },
  { key: "reminderEmail", label: "reminder email" },
  { key: "id", label: "ID" },
  { key: "note", label: "Note" },
];

/**
 * Format date as YYYY-MM-DD
 * @param {string} isoDate - ISO format date
 * @returns {string} Formatted date
 */
export function formatDate(isoDate) {
  const date = new Date(isoDate);
  return date.toISOString().split("T")[0]; // Returns YYYY-MM-DD
}

/**
 * Extract and prepare order data for the Google Sheet
 * @param {Object} order - Shopify order data
 * @param {Object} shopify - Shopify client with utility methods
 * @returns {Object} Structured order data
 */
export function extractOrderData(order, shopify) {
  // Get essential data objects
  const shippingAddress = order.shippingAddress || {};
  const customer = order.customer || {};

  // Get tracking number
  let trackingNumber = "";
  if (order.fulfillments?.length > 0) {
    const trackingInfo = order.fulfillments[0].trackingInfo?.[0];
    if (trackingInfo) {
      trackingNumber = trackingInfo.number || "";
    }
  }

  // Format order number without '#' prefix
  const orderNumber = order.name ? order.name.replace("#", "") : "";

  // Extract regular ID from GID
  const orderId = shopify.fromGid(order.id);

  // Format tags as comma-separated string
  const tags = Array.isArray(order.tags) ? order.tags.join(", ") : order.tags || "";

  // Return structured order data
  return {
    date: formatDate(order.createdAt || new Date()),
    orderNumber,
    tags,
    firstName: shippingAddress.firstName || customer.firstName || "",
    lastName: shippingAddress.lastName || customer.lastName || "",
    company: shippingAddress.company || customer.company || "",
    shippingAddress: shippingAddress.address1 || "",
    shippingZipCode: shippingAddress.zip || "",
    shippingCity: shippingAddress.city || "",
    shippingCountry: shippingAddress.country || "",
    phone: shippingAddress.phone || customer.phone || order.phone || "",
    totalPrice: order.totalPrice ? `${order.totalPrice}` : "",
    email: customer.email || order.email || "",
    trackingNumber,
    row: "",
    reminderEmail: "",
    id: orderId || "",
    note: order.note || "",
  };
}

/**
 * Extract line items from a Shopify order
 * @param {Object} order - Shopify order data
 * @returns {Array} Array of line items
 */
export function extractLineItems(order) {
  const lineItems = [];

  if (order.lineItems?.edges) {
    order.lineItems.edges.forEach((edge) => {
      if (edge.node) {
        lineItems.push({
          ...edge.node,
          sku: edge.node.variant?.sku || "",
          variantTitle: edge.node.variant?.title || "",
        });
      }
    });
  }

  return lineItems;
}

/**
 * Create rows for Google Sheet from order data and line items based on actual sheet headers
 * @param {Object} orderData - Structured order data
 * @param {Array} lineItems - Array of line items
 * @param {Array} headers - Actual headers from the Google Sheet
 * @returns {Array} Array of rows for the sheet (one per line item)
 */
export function createDynamicSheetRows(orderData, lineItems, headers) {
  // Create a mapping from header labels to data keys
  const headerToKeyMap = {};
  COLUMN_MAPPINGS.forEach((mapping) => {
    headerToKeyMap[mapping.label] = mapping.key;
  });

  return lineItems.map((item) => {
    // Create a merged data object with order data and line item data
    const rowData = {
      ...orderData,
      sku: item.sku || "",
      quantity: item.quantity || "",
    };

    // Map the data to columns based on the actual headers from the sheet
    return headers.map((header) => {
      const dataKey = headerToKeyMap[header];
      if (!dataKey) {
        return ""; // Return empty string for unknown headers
      }
      const value = rowData[dataKey] || "";
      return value;
    });
  });
}

/**
 * Verify the sheet has headers and validate against City's expected columns
 * @param {Object} sheetsClient - Google Sheets client
 * @param {string} spreadsheetId - Google Sheets spreadsheet ID
 * @param {string} sheetName - Google Sheets sheet name
 * @returns {Array} Array of headers
 */
export async function verifySheetHeaders(sheetsClient, spreadsheetId, sheetName) {
  const headers = await GoogleSheets.getSheetHeaders(sheetsClient, spreadsheetId, sheetName);

  // Optionally validate that the headers match our expected column mappings
  const expectedHeaders = COLUMN_MAPPINGS.map((column) => column.label);

  // Instead of requiring exact matches, we just log a warning if columns don't match
  if (headers.length !== expectedHeaders.length) {
    console.error(`\nWarning: Sheet has ${headers.length} columns, but we expected ${expectedHeaders.length}.`);
    console.error(`Sheet headers: ${headers.join(", ")}`);
    console.error(`Expected headers: ${expectedHeaders.join(", ")}`);
    throw new Error(`Sheet has ${headers.length} columns, but we expected ${expectedHeaders.length}.`);
  }

  return headers;
}

/**
 * Filter line items to only include those with SKUs containing "CCS1" or "CC0"
 * @param {Array} lineItems - Array of line items to filter
 * @returns {Array} Filtered array of line items
 */
export function filterLineItemsBySku(lineItems) {
  return lineItems.filter((item) => {
    const sku = item.sku || "";
    return sku.includes("CCS1") || sku.includes("CC0");
  });
}

/**
 * Check if an order line item already exists in the sheet
 * @param {Array} sheetData - Existing sheet data
 * @param {string} orderNumber - Order number to check
 * @param {string} sku - SKU to check
 * @param {number} orderNumberIndex - Index of the order ID column
 * @param {number} skuIndex - Index of the SKU column
 * @returns {boolean} True if the order line item exists, false otherwise
 */
export function orderLineItemExists(sheetData, orderNumber, sku, orderNumberIndex, skuIndex) {
  return sheetData.some(row =>
    row[orderNumberIndex] === orderNumber &&
    row[skuIndex] === sku
  );
}
