/**
 * City client-specific Google Sheets helper functions
 */
import * as GoogleSheets from "../../connectors/google-sheets.js";
import { format, parseISO } from "date-fns";

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
 * @returns {Array} Array of data objects ready for the sheet
 */
export function transformOrderDataToRows(orderData, lineItems) {
  return lineItems.map(item => ({
    ...orderData,
    sku: item.sku || "",
    quantity: item.quantity || "",
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

/**
 * Process an order and add it to the specified Google Sheet
 * @param {Object} order - Shopify order data
 * @param {Object} shopify - Shopify client
 * @param {Object} sheetsClient - Google Sheets client
 * @returns {Promise<Object>} Result of the append operation
 *
 * @example
 * // Example usage in a job file:
 * import * as CitySheets from '../../jobs/city/city-sheets-common.js';
 * import * as GoogleSheets from '../../connectors/google-sheets.js';
 *
 * export async function process(shopify, data) {
 *   const { order } = data;
 *
 *   // Get credentials from secrets and create pre-configured client
 *   const sheetsClient = await GoogleSheets.createSheetsClient(
 *     JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS),
 *     process.env.SPREADSHEET_ID,
 *     null, // Sheet name will be auto-detected
 *     CitySheets.COLUMN_MAPPINGS // Pass column mappings during creation
 *   );
 *
 *   // Initialize sheet (gets first sheet if not specified)
 *   await GoogleSheets.getFirstSheet(sheetsClient);
 *
 *   // Process the order and add it to the sheet
 *   return CitySheets.processOrderForSheet(order, shopify, sheetsClient);
 * }
 */
export async function processOrderForSheet(order, shopify, sheetsClient) {
  // Initialize headers if not already done
  if (!sheetsClient._headers) {
    await sheetsClient.initializeHeaders();
  }

  // Extract order data
  const orderData = extractOrderData(order, shopify);

  // Extract and filter line items
  const lineItems = extractLineItems(order);
  const filteredItems = filterLineItemsBySku(lineItems);

  // Skip if no matching line items
  if (filteredItems.length === 0) {
    return { skipped: true, reason: "No matching line items" };
  }

  // Transform order data into row data
  const rowData = transformOrderDataToRows(orderData, filteredItems);

  // Use the client's appendRows method to add data to the sheet
  return sheetsClient.appendRows(rowData);
}
