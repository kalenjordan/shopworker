import GetOrderById from "../../../graphql/GetOrderById.js";
import * as GoogleSheets from "../../../connectors/google-sheets.js";
import chalk from "chalk";
import { logToCli, logToWorker } from "../../../utils/log.js";
import * as SheetsHelpers from "../sheets-helpers.js";

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
export async function process({ record: orderData, shopify, env, jobConfig }) {
  logToWorker(env, "Webhook payload: " + JSON.stringify(orderData));

  // Validate required configuration
  GoogleSheets.validateSheetCredentials(secrets);

  if (!orderData.id) {
    throw new Error("No order ID provided");
  }

  let spreadsheetId = jobConfig.spreadsheet_id;
  if (!spreadsheetId) {
    throw new Error("No spreadsheet ID provided in job config.json");
  }

  // Get spreadsheet information and first sheet - using our new universal function
  const sheetsClient = await GoogleSheets.createSheetsClient(secrets.GOOGLE_SHEETS_CREDENTIALS);
  const { sheetName, spreadsheetTitle } = await GoogleSheets.getFirstSheet(sheetsClient, spreadsheetId);

  console.log(chalk.blue(`Spreadsheet title: "${spreadsheetTitle}"`));
  console.log(`Using sheet: "${sheetName}" from spreadsheet "${spreadsheetTitle}"`);

  // Convert ID to GID format and fetch full order
  const orderId = shopify.toGid(orderData.id, "Order");
  const { order } = await shopify.graphql(GetOrderById, { id: orderId });

  // Verify the sheet has headers and get them with positions map
  const { headers, headerMap } = await GoogleSheets.validateSheetHeaders(
    sheetsClient,
    spreadsheetId,
    sheetName,
    SheetsHelpers.COLUMN_MAPPINGS
  );

  // Extract data from the order
  const orderDetails = SheetsHelpers.extractOrderData(order, shopify);
  const lineItems = SheetsHelpers.extractLineItems(order);

  // Validate we have line items
  if (lineItems.length === 0) {
    console.log(chalk.yellow(`Order ${orderDetails.orderNumber} has no line items, skipping`));
    return;
  }

  // Log the data
  logToWorker(env, "Order details: ", {
    order: orderDetails,
    lineItems: lineItems
  });
  logToCli(env, "Order: " + orderDetails.orderNumber);

  // Filter line items to only include those with SKUs containing "CCS1" or "CC0"
  const filteredLineItems = SheetsHelpers.filterLineItemsBySku(lineItems);

  console.log(`Filtered from ${lineItems.length} to ${filteredLineItems.length} line items matching SKU criteria (CCS1 or CC0)`);

  if (filteredLineItems.length === 0) {
    console.log(chalk.yellow(`Order ${orderDetails.orderNumber} has no line items with matching SKUs, skipping`));
    return;
  }

  // Format data for Google Sheets using dynamic headers and header map for efficient lookups
  const rows = SheetsHelpers.createDynamicSheetRows(orderDetails, filteredLineItems, headers, headerMap);

  // Log rows being added
  console.log(`\nAdding ${rows.length} rows to sheet for order ${order.name || order.id}:`);
  for (const row of rows) {
    logToCli(env, `• ${row.join(' | ')}`);
  }

  // Append to Google Sheet
  const appendResult = await GoogleSheets.appendSheetData(sheetsClient, spreadsheetId, `${sheetName}!A1`, rows, "USER_ENTERED");

  console.log(chalk.green(`Order data added to Google Sheet at range: ${appendResult.updates?.updatedRange || "unknown"}`));
}
