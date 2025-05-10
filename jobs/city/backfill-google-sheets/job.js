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
 */
export async function process({ shopify, env, shopConfig }) {
  // Validate required configuration
  if (!shopConfig.google_sheets_credentials) {
    throw new Error("Missing required google_sheets_credentials configuration in shopConfig");
  }

  // Test sheet ID
  const spreadsheetId = "1vSOfDFxrv1WlO89ZSrcgeDSmIk-S2dOEEp-97BHgaZw";

  // Number of orders to fetch per page
  const ordersPerPage = 100;

  // Fetch all recent orders since we need to do partial SKU matching
  const orderQuery = "";

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

  // Fetch all existing data from the sheet to check for duplicates
  const existingData = await GoogleSheets.getSheetData(sheetsClient, spreadsheetId, `${sheetName}!A2:Z`);
  console.log(`Fetched ${existingData.length} existing rows from the sheet`);

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

      console.log(`Processing batch ${batchIndex + 1}/${totalBatches} of page ${pageNumber} (orders ${batchStart + 1}-${batchEnd})`);

      // Process each order in the current batch
      for (const edge of currentBatch) {
        const order = edge.node;
        processedCount++;

        // Extract order data
        const orderData = SheetsHelpers.extractOrderData(order, shopify);
        const lineItems = SheetsHelpers.extractLineItems(order);

        // Filter line items to only include those with SKUs containing "CCS1" or "CC0"
        const filteredLineItems = SheetsHelpers.filterLineItemsBySku(lineItems);

        if (filteredLineItems.length === 0) {
          console.log(`Order ${orderData.orderNumber} has no line items with matching SKUs, skipping`);
          continue;
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
            newRows.push(row);
            addedCount++;

            // Also add to existingData to prevent duplicates within the current run
            existingData.push(row);
          }
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

    // Update counters and progress
    totalProcessedOrders += processedCount;
    totalAddedRows += addedCount;

    console.log(chalk.yellow(`\nPage ${pageNumber} complete: Processed ${processedCount} orders, added ${addedCount} rows`));
    console.log(chalk.yellow(`Running total: Processed ${totalProcessedOrders} orders, added ${totalAddedRows} rows`));

    // Move to next page
    pageNumber++;

    // Optionally add a small delay between pages to avoid rate limiting
    if (hasNextPage) {
      console.log("Waiting 1 second before fetching next page...");
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(chalk.green(`\nBackfill complete: Processed ${totalProcessedOrders} orders across ${pageNumber - 1} pages`));
  console.log(chalk.green(`Added ${totalAddedRows} new line items to the sheet`));
}
