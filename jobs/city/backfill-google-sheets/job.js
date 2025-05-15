import GetOrdersForBackfill from "../../../graphql/GetOrdersForBackfill.js";
import * as GoogleSheets from "../../../connectors/google-sheets.js";
import chalk from "chalk";
import { logToCli, logToWorker } from "../../../utils/log.js";
import * as SheetsHelpers from "../city-sheets-common.js";

/**
 * Process an order backfill job
 * @param {Object} options - Options object
 * @param {Object} options.shopify - Shopify API client
 * @param {Object} options.env - Environment variables
 * @param {Object} options.shopConfig - Shop-specific configuration
 * @param {Object} options.jobConfig - Job-specific configuration
 * @param {Object} options.secrets - Secrets loaded from .secrets directory
 */
export async function process({ shopify, env, jobConfig, secrets }) {
  // Validate required configuration
  GoogleSheets.validateSheetCredentials(secrets);

  const spreadsheetId = jobConfig.spreadsheet_id;
  if (!spreadsheetId) {
    throw new Error("Missing required spreadsheet_id in job configuration");
  }

  // Use credentials from secrets if available, otherwise fall back to shopConfig
  const sheetsCredentials = secrets.GOOGLE_SHEETS_CREDENTIALS;
  if (!sheetsCredentials) {
    throw new Error("Missing required GOOGLE_SHEETS_CREDENTIALS in secrets");
  }

  const ordersPerPage = jobConfig.batch_size || 3;
  const orderQuery = ""; // Fetch all recent orders for SKU matching

  // Initialize Google Sheets setup
  const sheetsClient = await GoogleSheets.createSheetsClient(sheetsCredentials);

  // Get spreadsheet information and first sheet - using the universal function
  const { sheetName, spreadsheetTitle } = await GoogleSheets.getFirstSheet(
    sheetsClient,
    spreadsheetId,
    SheetsHelpers.COLUMN_MAPPINGS
  );

  console.log(chalk.blue(`Spreadsheet title: "${spreadsheetTitle}"`));
  console.log(`Using sheet: "${sheetName}" from spreadsheet "${spreadsheetTitle}"`);

  // Find the indices of order number and SKU columns for duplicate checking
  const orderNumberIndex = sheetsClient._headerMap.orderNumber;
  const skuIndex = sheetsClient._headerMap.sku;

  if (orderNumberIndex === undefined || skuIndex === undefined) {
    throw new Error("Sheet is missing required Order Number or SKU columns");
  }

  // Fetch existing data to check for duplicates
  const existingRows = await sheetsClient.readRows(spreadsheetId, sheetName);
  console.log(`Fetched ${existingRows.length} existing rows from the sheet`);

  // Convert object data back to array format for compatibility with existing code
  const existingData = existingRows.map(row => {
    return Object.values(row);
  });

  // Process orders with pagination
  const stats = await processOrderPages({
    shopify,
    sheetsClient,
    spreadsheetId,
    sheetName,
    orderNumberIndex,
    skuIndex,
    existingData,
    ordersPerPage,
    orderQuery,
    env
  });

  // Log final results
  console.log(chalk.green(`\nBackfill complete: Processed ${stats.totalProcessedOrders} orders across ${stats.pageCount} pages`));
  console.log(chalk.green(`Added ${stats.totalAddedRows} new line items to the sheet`));
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
  orderNumberIndex,
  skuIndex,
  existingData,
  ordersPerPage,
  orderQuery,
  env
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
      orderNumberIndex,
      skuIndex,
      existingData,
      pageNumber,
      env
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
  orderNumberIndex,
  skuIndex,
  existingData,
  pageNumber,
  env
}) {
  let addedCount = 0;
  let processedCount = 0;
  const rowsToAdd = [];

  // Process each order in the current page
  for (const edge of orders.edges) {
    const order = edge.node;
    processedCount++;

    const orderRows = processOrder({
      order,
      shopify,
      orderNumberIndex,
      skuIndex,
      existingData,
      env
    });

    // Track new rows and count
    rowsToAdd.push(...orderRows);
    addedCount += orderRows.length;
  }

  // Add new rows to the sheet if there are any
  if (rowsToAdd.length > 0) {
    console.log(`Adding ${rowsToAdd.length} new rows to the sheet for this page`);
    await sheetsClient.appendRows(spreadsheetId, sheetName, rowsToAdd);
    console.log(chalk.green(`Successfully added ${rowsToAdd.length} new rows to the sheet`));
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
  orderNumberIndex,
  skuIndex,
  existingData,
  env
}) {
  // Extract order data
  const orderData = SheetsHelpers.extractOrderData(order, shopify);
  const lineItems = SheetsHelpers.extractLineItems(order);

  // Filter line items to only include those with SKUs containing "CCS1", "CC0", or starting with "QCS"
  const filteredLineItems = SheetsHelpers.filterLineItemsBySku(lineItems);

  // Convert order data to row format using the helper function
  return SheetsHelpers.transformOrderDataToRows(orderData, filteredLineItems).filter(row => {
    // Check if this order line item already exists in the sheet
    return !existingData.some(existingRow =>
      existingRow[orderNumberIndex] === row.orderNumber &&
      existingRow[skuIndex] === row.sku
    );
  });
}
