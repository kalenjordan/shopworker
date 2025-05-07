import GetOrderById from "../../graphql/GetOrderById.js";
import * as GoogleSheets from "../../connectors/google-sheets.js";
import chalk from "chalk";

// Define column mappings in one place
const COLUMN_MAPPINGS = [
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
function formatDate(isoDate) {
  const date = new Date(isoDate);
  return date.toISOString().split("T")[0]; // Returns YYYY-MM-DD
}

/**
 * Extract and prepare order data for the Google Sheet
 * @param {Object} order - Shopify order data
 * @param {Object} shopify - Shopify client with utility methods
 * @returns {Object} Structured order data
 */
function extractOrderData(order, shopify) {
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
  };
}

/**
 * Extract line items from order
 * @param {Object} order - Shopify order data
 * @returns {Array} Array of line items
 */
function extractLineItems(order) {
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
function createDynamicSheetRows(orderData, lineItems, headers) {
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
 * Verify the sheet has headers
 * @param {Object} sheetsClient - Google Sheets client
 * @param {string} spreadsheetId - Google Sheets spreadsheet ID
 * @param {string} sheetName - Google Sheets sheet name
 * @returns {Array} Array of headers
 */
async function verifySheetHeaders(sheetsClient, spreadsheetId, sheetName) {
  const headerData = await GoogleSheets.getSheetData(sheetsClient, spreadsheetId, `${sheetName}!A1:Z1`);

  if (!headerData?.length || !headerData[0]?.length) {
    throw new Error(`Sheet is not initialized with headers. Please create the sheet first.`);
  }

  // Optionally validate that the headers match our expected column mappings
  const headers = headerData[0];
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
 * Process a Shopify order and add it to Google Sheets
 * @param {Object} options - Options object
 * @param {Object} options.record - Shopify order data
 * @param {Object} options.shopify - Shopify API client
 * @param {Object} options.env - Environment variables
 */
export async function process({ record: orderData, shopify, env }) {
  console.log("Webhook payload: ", orderData);

  // Validate required environment variables
  if (!env.google_sheets_credentials) {
    throw new Error("Missing required env.google_sheets_credentials configuration");
  }
  if (!orderData.id) {
    throw new Error("No order ID provided");
  }

  // Test sheet ID
  const spreadsheetId = "1vSOfDFxrv1WlO89ZSrcgeDSmIk-S2dOEEp-97BHgaZw";

  // Live sheet ID
  // "google_sheet_id": "1Ksl7UN-b-LnPOfQRxk4OgSVocD8Nfid3rLGNh1vFQrY",

  const sheetsClient = await GoogleSheets.createSheetsClient(env.google_sheets_credentials);

  // Get spreadsheet title and available sheets
  const spreadsheetTitle = await GoogleSheets.getSpreadsheetTitle(sheetsClient, spreadsheetId);
  console.log(chalk.blue(`Spreadsheet title: "${spreadsheetTitle}"`));

  const sheets = await GoogleSheets.getSheets(sheetsClient, spreadsheetId);
  console.log("Available sheets in spreadsheet:");
  sheets.forEach((sheet) => {
    console.log(`- ${sheet.title} (sheetId: ${sheet.sheetId}, index: ${sheet.index})`);
  });

  // Use the first sheet
  if (sheets.length === 0) {
    throw new Error(`No sheets found in spreadsheet "${spreadsheetTitle}"`);
  }

  const sheetName = sheets[0].title;
  console.log(`Using sheet: "${sheetName}" from spreadsheet "${spreadsheetTitle}"`);

  // Convert ID to GID format and fetch full order
  const orderId = shopify.toGid(orderData.id, "Order");
  const { order } = await shopify.graphql(GetOrderById, { id: orderId });

  // Verify the sheet has headers and get them
  const headers = await verifySheetHeaders(sheetsClient, spreadsheetId, sheetName);

  // Extract data from the order
  const orderDetails = extractOrderData(order, shopify);
  const lineItems = extractLineItems(order);

  // Validate we have line items
  if (lineItems.length === 0) {
    throw new Error("No line items found in order");
  }

  // Log the data
  console.log("Order details: ", {
    order: JSON.stringify(orderDetails, null, 2),
    lineItems: JSON.stringify(lineItems, null, 2)
  });

  // Filter line items to only include those with SKUs containing "CCS1" or "CC0"
  const filteredLineItems = lineItems.filter((item) => {
    const sku = item.sku || "";
    return sku.includes("CCS1") || sku.includes("CC0");
  });

  console.log(`Filtered from ${lineItems.length} to ${filteredLineItems.length} line items matching SKU criteria (CCS1 or CC0)`);

  // Format data for Google Sheets using dynamic headers
  const rows = createDynamicSheetRows(orderDetails, filteredLineItems, headers);

  // Log what we're doing
  console.log(`\nAdding ${rows.length} rows to sheet for order ${order.name || order.id}`);

  // Append to Google Sheet
  const appendResult = await GoogleSheets.appendSheetData(sheetsClient, spreadsheetId, `${sheetName}!A1`, rows, "USER_ENTERED");

  console.log(`Order data added to Google Sheet at range: ${appendResult.updates?.updatedRange || "unknown"}`);
}
