import GetOrdersForBackfill from "../../../graphql/GetOrdersForBackfill.js";
import * as GoogleSheets from "../../../connectors/google-sheets.js";
import chalk from "chalk";
import * as CitySheets from "../city-sheets-common.js";

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
  const rowLimit = jobConfig.limit || null; // Get the optional row limit
  const orderQuery = ""; // Fetch all recent orders for SKU matching

  // Initialize Google Sheets client with spreadsheet ID and column mappings
  const sheetsClient = await GoogleSheets.createSheetsClient(
    sheetsCredentials,
    spreadsheetId,
    null, // Let getFirstSheet determine the sheet name
    CitySheets.COLUMN_MAPPINGS
  );

  // Get spreadsheet information
  const { sheetName, spreadsheetTitle } = await GoogleSheets.getFirstSheet(sheetsClient);

  console.log(chalk.blue(`Spreadsheet title: "${spreadsheetTitle}"`));
  console.log(`Using sheet: "${sheetName}" from spreadsheet "${spreadsheetTitle}"`);

  // Fetch existing data to check for duplicates
  const existingRows = await sheetsClient.readRows();
  console.log(`Fetched ${existingRows.length} existing rows from the sheet`);

  // Log if a row limit is in effect
  if (rowLimit) {
    console.log(chalk.yellow(`A row limit of ${rowLimit} is set. Backfill will stop after adding this many rows.`));
  }

  // Process orders with pagination
  const stats = await processOrderPages({
    shopify,
    sheetsClient,
    existingRows,
    ordersPerPage,
    orderQuery,
    env,
    rowLimit
  });

  // Log final results
  console.log(chalk.green(`\nBackfill complete: Processed ${stats.totalProcessedOrders} orders across ${stats.pageCount} pages`));
  console.log(chalk.green(`Added ${stats.totalAddedRows} new line items to the sheet`));
  if (rowLimit && stats.totalAddedRows >= rowLimit) {
    console.log(chalk.green(`Reached the configured row limit of ${rowLimit}. Stopping backfill.`));
  }
}

/**
 * Process orders in paginated batches
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} - Statistics about processed orders
 */
async function processOrderPages({
  shopify,
  sheetsClient,
  existingRows,
  ordersPerPage,
  orderQuery,
  env,
  rowLimit
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
      existingRows,
      pageNumber,
      env
    });

    // Update counters and progress
    totalProcessedOrders += pageStats.processedCount;
    totalAddedRows += pageStats.addedCount;

    console.log(chalk.yellow(`\nPage ${pageNumber} complete: Processed ${pageStats.processedCount} orders, added ${pageStats.addedCount} rows`));
    console.log(chalk.yellow(`Running total: Processed ${totalProcessedOrders} orders, added ${totalAddedRows} rows`));

    // Check if we've reached the row limit
    if (rowLimit && totalAddedRows >= rowLimit) {
      console.log(chalk.yellow(`Reached the configured row limit of ${rowLimit}. Stopping backfill.`));
      hasNextPage = false;
    }

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
  existingRows,
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

    // Log the order name/number being processed
    console.log(`Processing order: ${order.name}`);

    // Use the same processing logic from city-sheets-common
    const result = await processOrderForBackfill(order, shopify, sheetsClient, existingRows);

    if (result && result.rows) {
      rowsToAdd.push(...result.rows);
      addedCount += result.rows.length;
    }
  }

  // Add new rows to the sheet if there are any
  if (rowsToAdd.length > 0) {
    console.log(`Adding ${rowsToAdd.length} new rows to the sheet for this page`);
    await sheetsClient.appendRows(rowsToAdd);
    console.log(chalk.green(`Successfully added ${rowsToAdd.length} new rows to the sheet`));
  }

  return { processedCount, addedCount };
}

/**
 * Process a single order for backfill and check for duplicates
 * @param {Object} order - Order data
 * @param {Object} shopify - Shopify API client
 * @param {Object} sheetsClient - Google Sheets client
 * @param {Array} existingRows - Existing rows in the sheet
 * @returns {Object} - New rows to add to the sheet
 */
async function processOrderForBackfill(order, shopify, sheetsClient, existingRows) {
  // Extract order data
  const orderData = CitySheets.extractOrderData(order, shopify);
  const lineItems = CitySheets.extractLineItems(order);

  // Filter line items to only include those with SKUs matching the pattern
  const filteredLineItems = CitySheets.filterLineItemsBySku(lineItems);

  if (filteredLineItems.length === 0) {
    return { rows: [] };
  }

  // Convert order data to row format
  const newRows = CitySheets.transformOrderDataToRows(orderData, filteredLineItems, true);

  // Check for duplicates by comparing order number and SKU
  const dedupedRows = newRows.filter(newRow => {
    return !existingRows.some(existingRow =>
      existingRow.orderNumber === newRow.orderNumber &&
      existingRow.sku === newRow.sku
    );
  });

  return { rows: dedupedRows };
}
