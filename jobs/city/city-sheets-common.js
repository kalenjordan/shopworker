/**
 * City client-specific Google Sheets helper functions
 */
import * as GoogleSheets from "../../connectors/google-sheets.js";
import { format, parseISO } from "date-fns";
import chalk from "chalk";

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
  { key: "backfill", label: "Backfill" },
];

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
    date: format(parseISO(order.createdAt), 'yyyy-MM-dd'),
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
 * @param {Object} headerMap - Optional map of keys to column indices
 * @returns {Array} Array of rows for the sheet (one per line item)
 * @deprecated Use transformOrderDataToRows with sheetsClient.appendRows instead
 */
export function createDynamicSheetRows(orderData, lineItems, headers, headerMap = null) {
  console.warn('createDynamicSheetRows is deprecated. Use transformOrderDataToRows with sheetsClient.appendRows instead.');

  if (headerMap) {
    // Convert items into row format
    const rowDataObjects = transformOrderDataToRows(orderData, lineItems);

    // Format them for the sheet
    return rowDataObjects.map(dataObject => {
      const row = new Array(headers.length).fill("");

      for (const key in headerMap) {
        const columnIndex = headerMap[key];
        const value = dataObject[key] || "";
        row[columnIndex] = value;
      }

      return row;
    });
  } else {
    // Legacy approach: map based on header labels
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
}

/**
 * Transform order and line items into row data for sheets
 * @param {Object} orderData - Structured order data
 * @param {Array} lineItems - Array of line items
 * @param {boolean} isBackfill - Whether this is a backfill operation
 * @returns {Array} Array of data objects ready for the sheet
 */
export function transformOrderDataToRows(orderData, lineItems, isBackfill = false) {
  return lineItems.map(item => ({
    ...orderData,
    sku: item.sku || "",
    quantity: item.quantity || "",
    backfill: isBackfill ? "true" : "false",
  }));
}

/**
 * Filter line items to only include those with SKUs containing "CCS1", "CC0", or starting with "QCS"
 * @param {Array} lineItems - Array of line items to filter
 * @returns {Array} Filtered array of line items
 */
export function filterLineItemsBySku(lineItems) {
  return lineItems.filter((item) => {
    const sku = item.sku || "";
    return sku.includes("CCS1") || sku.includes("CC0") || sku.startsWith("QCS");
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
