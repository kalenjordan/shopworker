import GetOrdersForBackfill from "../../../graphql/GetOrdersForBackfill.js";
import * as GoogleSheets from "../../../connectors/google-sheets.js";
import chalk from "chalk";
import { logToCli, logToWorker } from "../../../utils/worker-helpers.js";
import * as SheetsHelpers from "../sheets-helpers.js";

/**
 * Process an order backfill job
 * @param {Object} options - Options object
 * @param {Object} options.shopify - Shopify API client
 * @param {Object} options.env - Environment variables
 * @param {Object} options.shopConfig - Shop-specific configuration
 * @param {Object} options.jobConfig - Job-specific configuration
 */
export async function process({ shopify, env, shopConfig, jobConfig }) {
  // Validate required configuration
  validateConfig(shopConfig, jobConfig);

  const spreadsheetId = jobConfig.spreadsheet_id;
  const ordersPerPage = 100;
  const orderQuery = ""; // Fetch all recent orders for SKU matching

  // Initialize Google Sheets setup
  const { sheetsClient, sheetName, headers, orderNumberIndex, skuIndex } =
    await setupGoogleSheets(shopConfig, spreadsheetId);

  // Fetch existing data to check for duplicates
  const existingData = await GoogleSheets.getSheetData(sheetsClient, spreadsheetId, `${sheetName}!A2:Z`);
  console.log(`Fetched ${existingData.length} existing rows from the sheet`);

  // Process orders with pagination
  const stats = await processOrderPages({
    shopify,
    sheetsClient,
    spreadsheetId,
    sheetName,
    headers,
    orderNumberIndex,
    skuIndex,
    existingData,
    ordersPerPage,
    orderQuery
  });

  // Log final results
  console.log(chalk.green(`\nBackfill complete: Processed ${stats.totalProcessedOrders} orders across ${stats.pageCount} pages`));
  console.log(chalk.green(`Added ${stats.totalAddedRows} new line items to the sheet`));
}

/**
 * Validate required configuration
 * @param {Object} shopConfig - Shop configuration
 * @param {Object} jobConfig - Job configuration
 */
function validateConfig(shopConfig, jobConfig) {
  if (!shopConfig.google_sheets_credentials) {
    throw new Error("Missing required google_sheets_credentials configuration in shopConfig");
  }

  if (!jobConfig.spreadsheet_id) {
    throw new Error("Missing required spreadsheet_id in job configuration");
  }
}

/**
 * Set up Google Sheets connection and verify sheet structure
 * @param {Object} shopConfig - Shop configuration
 * @param {string} spreadsheetId - Google Sheets spreadsheet ID
 * @returns {Promise<Object>} - Sheet configuration details
 */
async function setupGoogleSheets(shopConfig, spreadsheetId) {
  // Initialize Google Sheets client
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

  // Verify the sheet has headers and get them
  const headers = await SheetsHelpers.verifySheetHeaders(sheetsClient, spreadsheetId, sheetName);

  // Find the indices of order number and SKU columns
  const orderNumberIndex = headers.findIndex(header => header === "Order Number");
  const skuIndex = headers.findIndex(header => header === "SKU");

  if (orderNumberIndex === -1 || skuIndex === -1) {
    throw new Error("Sheet is missing required Order Number or SKU columns");
  }

  return { sheetsClient, sheetName, headers, orderNumberIndex, skuIndex };
}

/**
 * Process orders in paginated batches
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} - Statistics about processed orders
 */
async function processOrderPages({
  shopify,
  sheetsClient,
  spreadsheetId,
  sheetName,
  headers,
  orderNumberIndex,
  skuIndex,
  existingData,
  ordersPerPage,
  orderQuery
}) {
  // Initialize tracking variables
  let hasNextPage = true;
  let cursor = null;
  let totalProcessedOrders = 0;
  let totalAddedRows = 0;
  let pageNumber = 1;

  // Process orders with pagination
  while (hasNextPage) {
    console.log(chalk.blue(`\nFetching page ${pageNumber} of orders (${ordersPerPage} per page)...`));

    // Fetch a page of orders
    const response = await shopify.graphql(GetOrdersForBackfill, {
      first: ordersPerPage,
      query: orderQuery,
      after: cursor
    });

    // Extract orders and pagination info
    const { orders } = response;

    if (!orders?.edges?.length) {
      console.log("No orders found in this page.");
      break;
    }

    hasNextPage = orders.pageInfo.hasNextPage;
    cursor = orders.pageInfo.endCursor;

    console.log(`Found ${orders.edges.length} orders on page ${pageNumber}`);

    // Process the current page of orders
    const pageStats = await processOrderPage({
      orders,
      shopify,
      sheetsClient,
      spreadsheetId,
      sheetName,
      headers,
      orderNumberIndex,
      skuIndex,
      existingData,
      pageNumber
    });

    // Update counters and progress
    totalProcessedOrders += pageStats.processedCount;
    totalAddedRows += pageStats.addedCount;

    console.log(chalk.yellow(`\nPage ${pageNumber} complete: Processed ${pageStats.processedCount} orders, added ${pageStats.addedCount} rows`));
    console.log(chalk.yellow(`Running total: Processed ${totalProcessedOrders} orders, added ${totalAddedRows} rows`));

    // Move to next page
    pageNumber++;

    // Optionally add a small delay between pages to avoid rate limiting
    if (hasNextPage) {
      console.log("Waiting 1 second before fetching next page...");
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return {
    totalProcessedOrders,
    totalAddedRows,
    pageCount: pageNumber - 1
  };
}

/**
 * Process a single page of orders
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} - Statistics for this page
 */
async function processOrderPage({
  orders,
  shopify,
  sheetsClient,
  spreadsheetId,
  sheetName,
  headers,
  orderNumberIndex,
  skuIndex,
  existingData,
  pageNumber
}) {
  let addedCount = 0;
  let processedCount = 0;
  const newRows = [];

  // Process each order in the current page
  for (const edge of orders.edges) {
    const order = edge.node;
    processedCount++;

    const orderRows = processOrder({
      order,
      shopify,
      headers,
      orderNumberIndex,
      skuIndex,
      existingData
    });

    // Track new rows and count
    newRows.push(...orderRows);
    addedCount += orderRows.length;
  }

  // Add new rows to the sheet if there are any
  if (newRows.length > 0) {
    console.log(`Adding ${newRows.length} new rows to the sheet for this page`);
    await GoogleSheets.appendSheetData(sheetsClient, spreadsheetId, `${sheetName}!A1:Z1`, newRows);
    console.log(chalk.green(`Successfully added ${newRows.length} new rows to the sheet`));
  }

  return { processedCount, addedCount };
}

/**
 * Process a single order and return new rows to add
 * @param {Object} options - Processing options
 * @returns {Array} - New rows to add to the sheet
 */
function processOrder({
  order,
  shopify,
  headers,
  orderNumberIndex,
  skuIndex,
  existingData
}) {
  const newOrderRows = [];

  // Extract order data
  const orderData = SheetsHelpers.extractOrderData(order, shopify);
  const lineItems = SheetsHelpers.extractLineItems(order);

  // Filter line items to only include those with SKUs containing "CCS1" or "CC0"
  const filteredLineItems = SheetsHelpers.filterLineItemsBySku(lineItems);

  if (filteredLineItems.length === 0) {
    console.log(`Order ${orderData.orderNumber} has no line items with matching SKUs, skipping`);
    return newOrderRows;
  }

  console.log(`Processing order ${orderData.orderNumber} with ${filteredLineItems.length} matching line items`);

  // Create rows for each filtered line item
  const rows = SheetsHelpers.createDynamicSheetRows(orderData, filteredLineItems, headers);

  // Check each row to see if it already exists in the sheet
  for (const row of rows) {
    const orderNumber = row[orderNumberIndex];
    const sku = row[skuIndex];

    if (!SheetsHelpers.orderLineItemExists(existingData, orderNumber, sku, orderNumberIndex, skuIndex)) {
      // This order line item doesn't exist in the sheet, add it
      newOrderRows.push(row);

      // Also add to existingData to prevent duplicates within the current run
      existingData.push(row);
    }
  }

  return newOrderRows;
}
