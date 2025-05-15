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

  // Validate required configuration
  GoogleSheets.validateSheetCredentials(secrets);

  if (!orderData.id) {
    throw new Error("No order ID provided");
  }

  let spreadsheetId = jobConfig.spreadsheet_id;
  if (!spreadsheetId) {
    throw new Error("No spreadsheet ID provided in job config.json");
  }

  // Initialize Google Sheets client
  const sheetsClient = await GoogleSheets.createSheetsClient(secrets.GOOGLE_SHEETS_CREDENTIALS);

  // Get spreadsheet information and first sheet, and initialize headers
  const { sheetName, spreadsheetTitle } = await GoogleSheets.getFirstSheet(
    sheetsClient,
    spreadsheetId,
    CitySheets.COLUMN_MAPPINGS
  );

  console.log(chalk.blue(`Spreadsheet title: "${spreadsheetTitle}"`));
  console.log(`Using sheet: "${sheetName}" from spreadsheet "${spreadsheetTitle}"`);

  // Convert ID to GID format and fetch full order
  const orderId = shopify.toGid(orderData.id, "Order");
  const { order } = await shopify.graphql(GetOrderById, { id: orderId });

  // Extract data from the order
  const orderDetails = CitySheets.extractOrderData(order, shopify);
  const lineItems = CitySheets.extractLineItems(order);

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
  const filteredLineItems = CitySheets.filterLineItemsBySku(lineItems);

  console.log(`Filtered from ${lineItems.length} to ${filteredLineItems.length} line items matching SKU criteria (CCS1, CC0, or starting with QCS)`);

  if (filteredLineItems.length === 0) {
    console.log(chalk.yellow(`Order ${orderDetails.orderNumber} has no line items with matching SKUs, skipping`));
    return;
  }

  // Transform order data into row data objects
  const rowData = CitySheets.transformOrderDataToRows(orderDetails, filteredLineItems);

  // Log rows being added
  console.log(`\nAdding ${rowData.length} rows to sheet for order ${order.name || order.id}:`);
  for (const row of rowData) {
    logToCli(env, `• SKU: ${row.sku}, Qty: ${row.quantity}, Customer: ${row.firstName} ${row.lastName}`);
  }

  // Append rows directly using the client
  const appendResult = await sheetsClient.appendRows(
    spreadsheetId,
    sheetName,
    rowData
  );

  console.log(chalk.green(`Order data added to Google Sheet at range: ${appendResult.updates?.updatedRange || "unknown"}`));
}
