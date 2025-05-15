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

  // Before processing, preview what we'll be working with
  const lineItems = CitySheets.extractLineItems(order);
  const filteredLineItems = CitySheets.filterLineItemsBySku(lineItems);
  console.log(`Filtered from ${lineItems.length} to ${filteredLineItems.length} line items matching SKU criteria (CCS1, CC0, or starting with QCS)`);

  if (filteredLineItems.length === 0) {
    console.log(chalk.yellow(`Order ${order.name || order.id} has no line items with matching SKUs, skipping`));
    return;
  }

  // Preview what will be added
  console.log(`\nProcessing ${filteredLineItems.length} line items for order ${order.name || order.id}:`);
  for (const item of filteredLineItems) {
    logToCli(env, `• SKU: ${item.sku}, Qty: ${item.quantity}, Title: ${item.title}`);
  }

  // Use the processOrderForSheet function to handle the common logic
  const result = await CitySheets.processOrderForSheet(order, shopify, sheetsClient);

  if (result.skipped) {
    console.log(chalk.yellow(`Order processing skipped: ${result.reason}`));
    return;
  }

  console.log(chalk.green(`Order data added to Google Sheet at range: ${result.updates?.updatedRange || "unknown"}`));
}
