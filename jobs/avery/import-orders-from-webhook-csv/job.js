/**
 * Import from Webhook CSV Job
 *
 * This job processes webhook payloads for CSV import functionality.
 * Converts CSV data into structured orders where each CS order creates a single Shopify order.
 */

import { parseCSV, saveFile } from "../../../connectors/csv.js";
import { sendEmail } from "../../../connectors/resend.js";
import chalk from "chalk";
import { runJob } from "../../../utils/env.js";
import { formatInTimeZone } from "date-fns-tz";
import { format, parseISO } from "date-fns";
import { process as processSingleOrder } from "../process-single-order/job.js";

// Configuration flag to control how sub jobs are executed
const RUN_SUB_JOB_DIRECTLY = false; // Set to false to use runJob wrapper

// Module-level variables to avoid passing around
let shopify;
let jobConfig;
let env;
let shopConfig;

export async function process({ payload, shopify: shopifyClient, jobConfig: config, env: environment, shopConfig: shop }) {
  // Set module-level variables
  shopify = shopifyClient;
  jobConfig = config;
  env = environment;
  shopConfig = shop;

  const decodedContent = validateAndDecodeAttachment(payload);
  const parsedData = parseCSVContent(decodedContent);
  if (typeof parsedData.rows[0]["Password"] !== "undefined") {
    console.log("This is the customer csv not the orders csv - skipping");
    return;
  }

  await saveDecodedCSV(decodedContent, payload);

  if (parsedData.rows.length === 0) {
    console.log("No data rows found");
    return;
  }

  // Extract processed date from first row for email link
  const processedDate = extractProcessedDate(parsedData.rows[0]);

  const filteredRows = applyEmailFilter(parsedData.rows);
  const csOrders = buildCsOrdersFromRows(filteredRows, parsedData.rows.length);

  const results = await processShopifyOrdersViaSubJobs(csOrders);

  // Send simplified email summary
  await sendSimplifiedEmail(results.length, processedDate);
}

function validateAndDecodeAttachment(payload) {
  if (!payload.attachments || payload.attachments.length === 0 || !payload.attachments[0].content) {
    throw new Error("No attachments found or attachment content is empty");
  }

  console.log("Decoding Base64 Attachment Content");
  const decodedContent = atob(payload.attachments[0].content);

  return decodedContent;
}

async function saveDecodedCSV(decodedContent, record) {
  const timestamp = formatInTimeZone(new Date(), "America/Chicago", "yyyy-MM-dd-HH-mm-ss");
  const filename = `avery-orders-${timestamp}.csv`;

  console.log("Saving decoded CSV file");

  try {
    await saveFile(
      decodedContent,
      {
        filename,
        contentType: "text/csv",
        metadata: {
          source: "avery-webhook-import",
          originalFilename: record.attachments?.[0]?.filename || "unknown",
        },
      },
      env
    );
  } catch (error) {
    console.error(chalk.red(`Failed to save CSV file: ${error.message}`));
  }
}

function parseCSVContent(decodedContent) {
  const parsedData = parseCSV(decodedContent, { hasHeaders: true });
  console.log(`Parsed ${parsedData.rows.length} data rows`);
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
  const results = [];

  if (limit > 0) {
    console.log(`Limiting processing to ${limit} orders`);
  }

  for (const csOrder of csOrders) {
    if (limit > 0 && orderCounter >= limit) {
      console.log(`\nReached order limit of ${limit}, stopping processing`);
      break;
    }

    orderCounter++;

    console.log(chalk.cyan(`\n${orderCounter}/${csOrders.length} Processing order ${csOrder.csOrderId}`));

    try {
      console.log(chalk.green(`  ✓ Running ${orderCounter}`));
      const result = await runSingleOrderSubJob(csOrder, orderCounter);
      results.push(result);
    } catch (error) {
      console.error(chalk.red(`  ✗ Order ${orderCounter} failed: ${error.message}`));
      // Add error result to the results array
      results.push({
        status: 'error',
        orderCounter: orderCounter,
        csOrderIds: [csOrder.csOrderId],
        customerEmail: csOrder.lines[0]?.["Customer: Email"] || 'Unknown',
        customerName: csOrder.customer_name || 'Unknown',
        error: error.message
      });
    }
  }

  console.log(`\nCompleted processing ${orderCounter} Shopify orders`);
  return results;
}

/**
 * Run a single order processing sub job
 * Uses the RUN_SUB_JOB_DIRECTLY flag to determine execution method
 */
async function runSingleOrderSubJob(csOrder, orderCounter) {
  const payload = {
    csOrder,
    name: `Shopify Order #${orderCounter}`,
    orderCounter,
  };

  if (RUN_SUB_JOB_DIRECTLY) {
    // Call process-single-order directly
    return await processSingleOrder({ payload, shopify, jobConfig, env, shopConfig });
  } else {
    // Use the runJob wrapper
    const result = await runJob({
      jobPath: "avery/process-single-order",
      payload,
      shopify,
      jobConfig,
      env,
      shopConfig,
    });
    return result;
  }
}

// Helper function to get the limit from job config
function getLimit() {
  return jobConfig.test.limit || 0;
}

// Helper function to get the filter email from job config
function getFilterEmail() {
  return jobConfig.test.filterEmail;
}

/**
 * Extract and format the processed date from the first CSV row
 * @param {Object} firstRow - First row of CSV data
 * @returns {string} Date formatted as YYYY-MM-DD
 */
function extractProcessedDate(firstRow) {
  try {
    const processedAt = firstRow["Processed At"];
    if (!processedAt) {
      console.log("No 'Processed At' column found, using current date");
      return format(new Date(), 'yyyy-MM-dd');
    }

    // Parse the date and format as YYYY-MM-DD
    const date = parseISO(processedAt);
    return format(date, 'yyyy-MM-dd');
  } catch (error) {
    console.log(`Error parsing processed date: ${error.message}, using current date`);
    return format(new Date(), 'yyyy-MM-dd');
  }
}

/**
 * Send simplified email summary
 * @param {number} orderCount - Number of processed orders
 * @param {string} processedDate - Date processed in YYYY-MM-DD format
 */
async function sendSimplifiedEmail(orderCount, processedDate) {
  try {
    // Check if email configuration is available
    if (!shopConfig.resend_api_key || !shopConfig.email_to || !shopConfig.email_from) {
      console.log(chalk.yellow("Email configuration not available, skipping email notification"));
      return;
    }

    // Create email subject
    const subject = `Avery Order Import Summary - ${orderCount} orders processed (${processedDate})`;

    // Create HTML content
    const htmlContent = createHtmlSummary(orderCount, processedDate);

    await sendEmail({
      to: shopConfig.email_to,
      from: shopConfig.email_from,
      subject: subject,
      html: htmlContent
    }, shopConfig.resend_api_key);

    console.log(chalk.green("✓ Email summary sent successfully"));
  } catch (error) {
    console.error(chalk.red(`Failed to send email summary: ${error.message}`));
  }
}

/**
 * Create HTML email content
 */
function createHtmlSummary(orderCount, processedDate) {
  let html = `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #1f2937; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">
      📊 Avery Order Import Summary
    </h2>

    <div style="background-color: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0;">
      <p style="margin: 0; color: #6b7280; font-size: 14px;">Processed at: ${processedDate} CT</p>
    </div>

    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin: 20px 0;">
      <div style="background-color: #f0f9ff; padding: 15px; border-radius: 8px; text-align: center;">
        <div style="font-size: 24px; font-weight: bold; color: #0369a1;">${orderCount}</div>
        <div style="color: #0369a1; font-size: 14px;">Total Orders</div>
      </div>
    </div>

    <div style="margin: 20px 0;">
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background-color: #f0fdf4; border-radius: 6px; margin: 5px 0;">
        <span style="color: #166534;">Orders Processed:</span>
        <strong style="color: #166534;">${orderCount}</strong>
      </div>
    </div>`;

  // Create Shopify admin URL with tag filter
  const tag = `cs-${processedDate}`;
  const encodedTag = encodeURIComponent(tag);
  const shopifyUrl = `https://admin.shopify.com/store/835a20-6c/orders?start=MQ%3D%3D&tag=${encodedTag}`;

  html += `
    <div style="margin: 20px 0;">
      <div style="background-color: #f0f9ff; padding: 15px; border-radius: 8px; text-align: center;">
        <h3 style="color: #0369a1; margin-bottom: 15px;">View Orders in Shopify</h3>
        <a href="${shopifyUrl}" style="display: inline-block; background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
          View Orders with Tag: ${tag}
        </a>
      </div>
    </div>
  </div>`;

  return html;
}
