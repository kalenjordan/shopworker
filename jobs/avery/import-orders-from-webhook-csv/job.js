/**
 * Import from Webhook CSV Job
 *
 * This job processes webhook payloads for CSV import functionality.
 * Converts CSV data into structured orders where each CS order creates a single Shopify order.
 */

import { parseCSV } from "../../../connectors/csv.js";
import chalk from "chalk";
import { runSubJob } from "../../../utils/env.js";
// import fs from "fs";

// Module-level variables to avoid passing around
let shopify;
let jobConfig;
let env;
let shopConfig;

export async function process({ record, shopify: shopifyClient, jobConfig: config, env: environment, shopConfig: shop }) {
  // Set module-level variables
  shopify = shopifyClient;
  jobConfig = config;
  env = environment;
  shopConfig = shop;

  const decodedContent = validateAndDecodeAttachment(record);
  const parsedData = parseCSVContent(decodedContent);

  if (parsedData.rows.length === 0) {
    console.log("No data rows found");
    return;
  }

  const filteredRows = applyEmailFilter(parsedData.rows);
  const csOrders = buildCsOrdersFromRows(filteredRows, parsedData.rows.length);

  await processShopifyOrdersViaSubJobs(csOrders);
}

function validateAndDecodeAttachment(record) {
  if (!record.attachments || record.attachments.length === 0 || !record.attachments[0].content) {
    throw new Error("No attachments found or attachment content is empty");
  }

  console.log("\n=== Decoding Base64 Attachment Content ===");
  const decodedContent = atob(record.attachments[0].content);

  return decodedContent;
}

function parseCSVContent(decodedContent) {
  console.log(`Processing entire CSV content`);

  const parsedData = parseCSV(decodedContent, { hasHeaders: true });

  console.log(`Processed ${parsedData.rows.length} data rows`);
  return parsedData;
}

function applyEmailFilter(rows) {
  const filterEmail = getFilterEmail();

  if (!filterEmail) {
    return rows;
  }

  console.log(`\nFiltering rows by email: ${filterEmail}`);
  const filteredRows = rows.filter((row) => row["Customer: Email"] === filterEmail);
  console.log(`Found ${filteredRows.length} rows matching email filter`);

  if (filteredRows.length === 0) {
    console.log(`No rows found for email: ${filterEmail}`);
  }

  return filteredRows;
}

function buildCsOrdersFromRows(filteredRows, totalRowsCount) {
  let lastCsOrderId = null;
  let csOrderIndex = -1;
  const csOrders = [];

  for (const row of filteredRows) {
    const lineType = row["Line: Type"];
    const csOrderId = row["Name"];

    // Start new CS order when we encounter a new order ID
    if (csOrderId && csOrderId !== lastCsOrderId) {
      csOrderIndex++;
      csOrders[csOrderIndex] = createNewCsOrder(row, csOrderId);
      lastCsOrderId = csOrderId;
    }

    // Group different line types into the current CS order
    categorizeRowIntoOrder(csOrders[csOrderIndex], row, lineType);
  }

  console.log("\n");
  console.log(`Built ${csOrders.length} CS orders from ${totalRowsCount} rows`);
  return csOrders;
}

function createNewCsOrder(row, csOrderId) {
  return {
    csOrderId: csOrderId,
    csCustomerId: row["Metafield: commentsold.user"],
    customer_name: row["Shipping: Name"],
    lines: [],
    discount: null,
    shipping: null,
    transaction: null,
  };
}

function categorizeRowIntoOrder(csOrder, row, lineType) {
  if (lineType === "Line Item") {
    csOrder.lines.push(row);
  } else if (lineType === "Discount" && row["Line: Discount"] !== "") {
    csOrder.discount = row;
  } else if (lineType === "Shipping Line") {
    csOrder.shipping = row;
  } else if (lineType === "Transaction") {
    csOrder.transaction = row;
  }
}

async function processShopifyOrdersViaSubJobs(csOrders) {
  let orderCounter = 0;
  const limit = getLimit();

  console.log(`\n=== Processing ${csOrders.length} Shopify orders via sub-jobs ===`);

  if (limit > 0) {
    console.log(`Limiting processing to ${limit} orders`);
  }

  for (const csOrder of csOrders) {
    orderCounter++;

    if (limit > 0 && orderCounter > limit) {
      console.log(`\nReached order limit of ${limit}, stopping processing`);
      break;
    }

    console.log(chalk.cyan(`\nProcessing order ${orderCounter}/${csOrders.length}: ${csOrder.csOrderId}`));

    try {
      // Use the unified runSubJob interface - handles environment detection automatically
      console.log(chalk.green(`  ✓ Running ${orderCounter}`));
      await runSubJob({
        jobPath: 'avery/process-single-order',
        record: {
          csOrder,
          subJobIndex: orderCounter,
          orderCounter
        },
        shopify,
        jobConfig,
        env,
        shopConfig
      });
    } catch (error) {
      console.error(chalk.red(`  ✗ Order ${orderCounter} failed: ${error.message}`));
    }
  }

  console.log(`\nCompleted processing ${orderCounter} Shopify orders`);
}

// Helper function to get the limit from job config
function getLimit() {
  return jobConfig.test.limit || 0;
}

// Helper function to get the filter email from job config
function getFilterEmail() {
  return jobConfig.test.filterEmail;
}
