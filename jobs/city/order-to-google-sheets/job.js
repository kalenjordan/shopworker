import GetOrderById from "../../../graphql/GetOrderById.js";
import * as GoogleSheets from "../../../connectors/google-sheets.js";
import chalk from "chalk";
import { logToCli, logToWorker } from "../../../utils/log.js";
import * as CitySheets from "../city-sheets-common.js";

/**
 * Process a Shopify order and add it to Google Sheets
 * @param {Object} options - Options object
 * @param {Object} options.record - Shopify order data
 * @param {Object} options.shopify - Shopify API client
 * @param {Object} options.env - Environment variables
 * @param {Object} options.shopConfig - Shop-specific configuration
 * @param {Object} options.jobConfig - Job-specific configuration from config.json
 * @param {Object} options.secrets - Secrets loaded from files or environment
 */
export async function process({ record: orderData, shopify, env, jobConfig, secrets }) {
  logToWorker(env, "Webhook payload: " + JSON.stringify(orderData));

  if (!orderData.id) {
    throw new Error("No order ID provided");
  }

  let spreadsheetId = jobConfig.spreadsheet_id;
  if (!spreadsheetId) {
    throw new Error("No spreadsheet ID provided in job config.json");
  }

  // Initialize Google Sheets client with spreadsheet ID and column mappings
  const sheetsClient = await GoogleSheets.createSheetsClient(
    secrets.GOOGLE_SHEETS_CREDENTIALS,
    spreadsheetId,
    null, // Let getFirstSheet determine the sheet name
    CitySheets.COLUMN_MAPPINGS
  );

  // Get spreadsheet information
  const { sheetName, spreadsheetTitle } = await GoogleSheets.getFirstSheet(sheetsClient);

  console.log(chalk.blue(`Spreadsheet title: "${spreadsheetTitle}"`));
  console.log(`Using sheet: "${sheetName}" from spreadsheet "${spreadsheetTitle}"`);

  // Convert ID to GID format and fetch full order
  const orderId = shopify.toGid(orderData.id, "Order");
  const { order } = await shopify.graphql(GetOrderById, { id: orderId });

  // Log webhook data
  logToWorker(env, "Order details from API: ", order);
  logToCli(env, "Processing Order: " + (order.name || order.id));

  // Use the processOrderForSheet function to handle the common logic
  const result = await processOrderForSheet(order, shopify, sheetsClient);

  if (result.skipped) {
    console.log(chalk.yellow(`Order processing skipped: ${result.reason}`));
    return;
  }

  console.log(chalk.green(`Order data added to Google Sheet at range: ${result.updates?.updatedRange || "unknown"}`));
}

/**
 * Process an order and add it to the specified Google Sheet
 * @param {Object} order - Shopify order data
 * @param {Object} shopify - Shopify client
 * @param {Object} sheetsClient - Google Sheets client
 * @returns {Promise<Object>} Result of the append operation
 */
async function processOrderForSheet(order, shopify, sheetsClient) {
  // Extract order data
  const orderData = CitySheets.extractOrderData(order, shopify);

  // Extract and filter line items
  const lineItems = CitySheets.extractLineItems(order);
  const filteredItems = CitySheets.filterLineItemsBySku(lineItems);

  // Log preview information
  console.log(`Filtered from ${lineItems.length} to ${filteredItems.length} line items matching SKU criteria (CCS1, CC0, or starting with QCS)`);

  // Skip if no matching line items
  if (filteredItems.length === 0) {
    console.log(chalk.yellow(`Order ${order.name || order.id} has no line items with matching SKUs, skipping`));
    return { skipped: true, reason: "No matching line items" };
  }

  // Preview what will be added
  console.log(`\nProcessing ${filteredItems.length} line items for order ${order.name || order.id}:`);
  for (const item of filteredItems) {
    console.log(`• SKU: ${item.sku}, Qty: ${item.quantity}, Title: ${item.title}`);
  }

  // Transform order data into row data
  const rowData = CitySheets.transformOrderDataToRows(orderData, filteredItems, false);

  // Use the client's appendRows method to add data to the sheet
  return sheetsClient.appendRows(rowData);
}
