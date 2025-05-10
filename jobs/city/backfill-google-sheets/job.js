import GetOrdersForBackfill from "../../../graphql/GetOrdersForBackfill.js";
import * as GoogleSheets from "../../../connectors/google-sheets.js";
import chalk from "chalk";
import { logToCli, logToWorker } from "../../../utils/worker-helpers.js";

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
    note: order.note || "",
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
 * Check if an order line item already exists in the sheet
 * @param {Array} sheetData - Existing sheet data
 * @param {string} orderNumber - Order number to check
 * @param {string} sku - SKU to check
 * @param {number} orderNumberIndex - Index of the order ID column
 * @param {number} skuIndex - Index of the SKU column
 * @returns {boolean} True if the order line item exists, false otherwise
 */
function orderLineItemExists(sheetData, orderNumber, sku, orderNumberIndex, skuIndex) {
  return sheetData.some(row =>
    row[orderNumberIndex] === orderNumber &&
    row[skuIndex] === sku
  );
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
 * Process an order backfill job
 * @param {Object} options - Options object
 * @param {Object} options.shopify - Shopify API client
 * @param {Object} options.env - Environment variables
 * @param {Object} options.shopConfig - Shop-specific configuration
 */
export async function process({ shopify, env, shopConfig }) {
  // Use shopConfig if available, otherwise fall back to env
  const config = shopConfig || env;

  // Validate required environment variables
  if (!config.google_sheets_credentials) {
    throw new Error("Missing required google_sheets_credentials configuration");
  }

  // Test sheet ID
  const spreadsheetId = "1vSOfDFxrv1WlO89ZSrcgeDSmIk-S2dOEEp-97BHgaZw";

  // Number of orders to fetch
  const ordersToFetch = 100;

  // Fetch all recent orders since we need to do partial SKU matching
  const orderQuery = "";

  // Initialize Google Sheets client
  const sheetsClient = await GoogleSheets.createSheetsClient(config.google_sheets_credentials);

  // Get spreadsheet title and available sheets
  const spreadsheetTitle = await GoogleSheets.getSpreadsheetTitle(sheetsClient, spreadsheetId);
  console.log(chalk.blue(`Spreadsheet title: "${spreadsheetTitle}"`));

  const sheets = await GoogleSheets.getSheets(sheetsClient, spreadsheetId);

  // Use the first sheet
  if (sheets.length === 0) {
    throw new Error(`No sheets found in spreadsheet "${spreadsheetTitle}"`);
  }

  const sheetName = sheets[0].title;
  console.log(`Using sheet: "${sheetName}" from spreadsheet "${spreadsheetTitle}"`);

  // Verify the sheet has headers and get them
  const headers = await verifySheetHeaders(sheetsClient, spreadsheetId, sheetName);

  // Find the indices of order number and SKU columns
  const orderNumberIndex = headers.findIndex(header => header === "Order Number");
  const skuIndex = headers.findIndex(header => header === "SKU");

  if (orderNumberIndex === -1 || skuIndex === -1) {
    throw new Error("Sheet is missing required Order Number or SKU columns");
  }

  // Fetch all existing data from the sheet to check for duplicates
  const existingData = await GoogleSheets.getSheetData(sheetsClient, spreadsheetId, `${sheetName}!A2:Z`);
  console.log(`Fetched ${existingData.length} existing rows from the sheet`);

  // Fetch recent orders from Shopify with all the necessary data in a single query
  console.log(`Fetching ${ordersToFetch} recent orders...`);
  const { orders } = await shopify.graphql(GetOrdersForBackfill, {
    first: ordersToFetch,
    query: orderQuery
  });

  if (!orders?.edges?.length) {
    console.log("No orders found matching the query criteria");
    return;
  }

  console.log(`Found ${orders.edges.length} orders to process`);

  // Process each order
  let addedCount = 0;
  const newRows = [];
  let processedCount = 0;

  // Process orders in batches to avoid memory issues
  const orderBatchSize = 20;
  const totalBatches = Math.ceil(orders.edges.length / orderBatchSize);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const batchStart = batchIndex * orderBatchSize;
    const batchEnd = Math.min(batchStart + orderBatchSize, orders.edges.length);
    const currentBatch = orders.edges.slice(batchStart, batchEnd);

    console.log(`Processing batch ${batchIndex + 1}/${totalBatches} (orders ${batchStart + 1}-${batchEnd})`);

    // Process each order in the current batch
    for (const edge of currentBatch) {
      const order = edge.node;
      processedCount++;

      // Extract order data
      const orderData = extractOrderData(order, shopify);
      const lineItems = extractLineItems(order);

      // Filter line items to only include those with SKUs containing "CCS1" or "CC0"
      const filteredLineItems = lineItems.filter(item => {
        const sku = item.sku || "";
        return sku.includes("CCS1") || sku.includes("CC0");
      });

      if (filteredLineItems.length === 0) {
        console.log(`Order ${orderData.orderNumber} has no line items with matching SKUs, skipping`);
        continue;
      }

      console.log(`Processing order ${orderData.orderNumber} with ${filteredLineItems.length} matching line items`);

      // Create rows for each filtered line item
      const rows = createDynamicSheetRows(orderData, filteredLineItems, headers);

      // Check each row to see if it already exists in the sheet
      for (const row of rows) {
        const orderNumber = row[orderNumberIndex];
        const sku = row[skuIndex];

        if (!orderLineItemExists(existingData, orderNumber, sku, orderNumberIndex, skuIndex)) {
          // This order line item doesn't exist in the sheet, add it
          newRows.push(row);
          addedCount++;

          // Also add to existingData to prevent duplicates within the current run
          existingData.push(row);
        }
      }

      // Log progress
      if (processedCount % 10 === 0 || processedCount === orders.edges.length) {
        console.log(`Processed ${processedCount}/${orders.edges.length} orders (${Math.round(processedCount/orders.edges.length*100)}%)`);
      }
    }

    // Add new rows to the sheet in batches if there are any
    if (newRows.length > 0) {
      console.log(`Adding ${newRows.length} new rows to the sheet for this batch`);
      await GoogleSheets.appendSheetData(sheetsClient, spreadsheetId, `${sheetName}!A1:Z1`, newRows);
      console.log(chalk.green(`Successfully added ${newRows.length} new rows to the sheet`));

      // Clear newRows array to free memory after adding the batch
      newRows.length = 0;
    }
  }

  console.log(chalk.green(`Backfill complete: Processed ${processedCount} orders, added ${addedCount} new line items`));
}
