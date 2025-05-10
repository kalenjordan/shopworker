import GetOrderById from "../../../graphql/GetOrderById.js";
import * as GoogleSheets from "../../../connectors/google-sheets.js";
import chalk from "chalk";
import { logToCli, logToWorker } from "../../../utils/worker-helpers.js";
import * as SheetsHelpers from "../sheets-helpers.js";

/**
 * Process a Shopify order and add it to Google Sheets
 * @param {Object} options - Options object
 * @param {Object} options.record - Shopify order data
 * @param {Object} options.shopify - Shopify API client
 * @param {Object} options.env - Environment variables
 * @param {Object} options.shopConfig - Shop-specific configuration
 */
export async function process({ record: orderData, shopify, env, shopConfig }) {
  logToWorker(env, "Webhook payload: " + JSON.stringify(orderData));

  // Validate required configuration
  if (!shopConfig.google_sheets_credentials) {
    throw new Error("Missing required google_sheets_credentials configuration in shopConfig");
  }
  if (!orderData.id) {
    throw new Error("No order ID provided");
  }

  // Test sheet ID
  // const spreadsheetId = "1vSOfDFxrv1WlO89ZSrcgeDSmIk-S2dOEEp-97BHgaZw";

  // Live sheet ID
  const spreadsheetId ="1Ksl7UN-b-LnPOfQRxk4OgSVocD8Nfid3rLGNh1vFQrY";

  const sheetsClient = await GoogleSheets.createSheetsClient(shopConfig.google_sheets_credentials);

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

  // Convert ID to GID format and fetch full order
  const orderId = shopify.toGid(orderData.id, "Order");
  const { order } = await shopify.graphql(GetOrderById, { id: orderId });

  // Verify the sheet has headers and get them
  const headers = await SheetsHelpers.verifySheetHeaders(sheetsClient, spreadsheetId, sheetName);

  // Extract data from the order
  const orderDetails = SheetsHelpers.extractOrderData(order, shopify);
  const lineItems = SheetsHelpers.extractLineItems(order);

  // Validate we have line items
  if (lineItems.length === 0) {
    throw new Error("No line items found in order");
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

  // Format data for Google Sheets using dynamic headers
  const rows = SheetsHelpers.createDynamicSheetRows(orderDetails, filteredLineItems, headers);
  for (const row of rows) {
    logToCli(env, `• ${row.join(' | ')}`);
  }

  // Log what we're doing
  console.log(`\nAdding ${rows.length} rows to sheet for order ${order.name || order.id}`);

  // Append to Google Sheet
  const appendResult = await GoogleSheets.appendSheetData(sheetsClient, spreadsheetId, `${sheetName}!A1`, rows, "USER_ENTERED");

  console.log(`Order data added to Google Sheet at range: ${appendResult.updates?.updatedRange || "unknown"}`);
}
