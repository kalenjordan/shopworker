/**
 * Import from Webhook CSV Job
 *
 * This job processes webhook payloads for CSV import functionality.
 * Converts CSV data into structured orders where each CS order creates a single Shopify order.
 */

import { parseCSV, saveFile } from "../../../connectors/csv.js";
import { sendEmail } from "../../../connectors/resend.js";
import chalk from "chalk";
import { runJob, isWorkerEnvironment } from "../../../utils/env.js";
import { formatInTimeZone } from "date-fns-tz";
import { format, parseISO } from "date-fns";
import { processBatch, continueBatchProcessing } from "../../../utils/batch-processor.js";

// Export flag to indicate this job supports batch processing
export const supportsBatchProcessing = true;

export async function process({ payload, shopify: shopifyClient, jobConfig: config, env: environment, shopConfig: shop, durableObjectState }) {
  // Create context object to pass around instead of module-level variables
  const ctx = {
    shopify: shopifyClient,
    jobConfig: config,
    env: environment,
    shopConfig: shop
  };

  console.log("kj job config: ", config);

  const decodedContent = validateAndDecodeAttachment(payload);
  const parsedData = parseCSVContent(decodedContent);
  if (typeof parsedData.rows[0]["Password"] !== "undefined") {
    console.log("This is the customer csv not the orders csv - skipping");
    return;
  }

  await saveDecodedCSV(decodedContent, payload, ctx);

  if (parsedData.rows.length === 0) {
    console.log("No data rows found");
    return;
  }

  // Extract processed date from first row for email link and tagging
  const processedDate = extractProcessedDate(parsedData.rows[0]);

  const filteredRows = applyEmailFilter(parsedData.rows, ctx);
  let csOrders = buildCsOrdersFromRows(filteredRows, parsedData.rows.length);

  let limit = getLimit(ctx);
  if (limit >= 1) {
    console.log(`Limiting processing to ${limit} orders`);
    csOrders = csOrders.slice(0, limit);
  }

  // For troubleshooting, filter to a specific order ID
  // csOrders = filterOrdersForDebugging(csOrders, 'CS-649354')

  // Process orders using the batch processor abstraction
  const results = await processBatch({
    items: csOrders,
    processor: async (csOrder, index, metadata) => {
      const orderCounter = index + 1;
      console.log(chalk.cyan(`Processing order ${csOrder.csOrderId}`));

      try {
        // Reconstruct ctx with current environment (metadata.ctx may have serialized/missing env)
        const currentCtx = {
          shopify: shopifyClient,
          jobConfig: metadata.ctx ? metadata.ctx.jobConfig : config,
          env: environment, // Use current environment, not serialized one
          shopConfig: metadata.ctx ? metadata.ctx.shopConfig : shop
        };

        const result = await runSingleOrderSubJob(csOrder, orderCounter, metadata.processedDate, currentCtx);
        console.log(chalk.green(`  ✓ Order ${orderCounter} completed`));
        return result;
      } catch (error) {
        console.error(chalk.red(`  ✗ Order ${orderCounter} failed: ${error.message}`));
        return {
          status: 'error',
          orderCounter: orderCounter,
          csOrderIds: [csOrder.csOrderId],
          customerEmail: csOrder.lines[0]?.["Customer: Email"] || 'Unknown',
          customerName: csOrder.customer_name || 'Unknown',
          error: error.message
        };
      }
    },
    batchSize: 15,
    metadata: { processedDate, ctx },
    durableObjectState,
    env: environment,
    onProgress: (completed, total) => {
      if (completed % 10 === 0 || completed === total) {
        console.log(`📊 Progress: ${completed}/${total} orders processed`);
      }
    },
    onBatchComplete: async (batchResults, batchNum, totalBatches) => {
      console.log(`✅ Batch ${batchNum}/${totalBatches} completed`);

      // Send email summary only after all batches complete and in worker environment
      if (batchNum === totalBatches && isWorkerEnvironment(environment)) {
        await sendSimplifiedEmail(completed, processedDate, ctx);
      }
    }
  });

  // Summarize results if we have them (CLI environment)
  if (results && results.length > 0 && !isWorkerEnvironment(environment)) {
    summarizeResults(results);
  }
}

function validateAndDecodeAttachment(payload) {
  if (!payload.attachments || payload.attachments.length === 0 || !payload.attachments[0].content) {
    throw new Error("No attachments found or attachment content is empty");
  }

  console.log("Decoding Base64 Attachment Content");
  const decodedContent = atob(payload.attachments[0].content);

  return decodedContent;
}

async function saveDecodedCSV(decodedContent, record, ctx) {
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
      ctx.env
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

function applyEmailFilter(rows, ctx) {
  const filterEmail = getFilterEmail(ctx);

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

  // First, filter out malformed rows where Name column contains garbled data
  const validRows = filteredRows.filter((row) => {
    const csOrderId = row["Name"];
    return isValidOrderId(csOrderId);
  });

  for (const row of validRows) {
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

async function processShopifyOrdersViaSubJobs(csOrders, processedDate, ctx) {
  let orderCounter = 0;
  const limit = getLimit(ctx);
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
      const result = await runSingleOrderSubJob(csOrder, orderCounter, processedDate, ctx);
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

  // Summarize results if running in CLI environment (results have status)
  if (results.length > 0 && results[0] && typeof results[0].status !== 'undefined') {
    summarizeResults(results);
  }

  return results;
}

/**
 * Run a single order processing sub job
 * Uses the RUN_SUB_JOB_DIRECTLY flag to determine execution method
 */
async function runSingleOrderSubJob(csOrder, orderCounter, processedDate, ctx) {
  const payload = {
    csOrder,
    name: `Shopify Order #${orderCounter}`,
    orderCounter,
    processedDate,
  };

  const result = await runJob({
    jobPath: "avery/process-single-order",
    payload,
    shopify: ctx.shopify,
    jobConfig: ctx.jobConfig,
    env: ctx.env,
    shopConfig: ctx.shopConfig,
  });
  return result;
}

// Helper function to get the limit from job config
function getLimit(ctx) {
  return ctx.jobConfig.test.limit || 0;
}

// Helper function to get the filter email from job config
function getFilterEmail(ctx) {
  return ctx.jobConfig.test.filterEmail;
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
async function sendSimplifiedEmail(orderCount, processedDate, ctx) {
  try {
    // Check if email configuration is available
    if (!ctx.shopConfig.resend_api_key || !ctx.shopConfig.email_to || !ctx.shopConfig.email_from) {
      console.log(chalk.yellow("Email configuration not available, skipping email notification"));
      return;
    }

    // Create email subject
    const subject = `Avery Order Import Summary - ${orderCount} orders processed (${processedDate})`;

    // Create HTML content
    const htmlContent = createHtmlSummary(orderCount, processedDate);

    // Prepare email options
    const emailOptions = {
      to: ctx.shopConfig.email_to,
      from: ctx.shopConfig.email_from,
      subject: subject,
      html: htmlContent
    };

    // Add reply-to if configured
    if (ctx.shopConfig.email_reply_to) {
      emailOptions.replyTo = ctx.shopConfig.email_reply_to;
    }

    if (isWorkerEnvironment(ctx.env)) {
      await sendEmail(emailOptions, ctx.shopConfig.resend_api_key);
    } else {
      console.log(chalk.yellow("Skipping email summary in CLI environment"));
    }

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

/**
 * Summarize the results from processing orders (CLI environment only)
 * @param {Array} results - Array of results from processing orders
 */
function summarizeResults(results) {
  console.log(chalk.cyan('\n📊 Processing Summary:'));

  const summary = {
    total: results.length,
    created: 0,
    'already exists': 0,
    error: 0
  };

  const errors = [];

  for (const result of results) {
    if (result.status === 'created') {
      summary.created++;
    } else if (result.status === 'already exists') {
      summary['already exists']++;
    } else if (result.status === 'error') {
      summary.error++;
      errors.push({
        orderCounter: result.orderCounter,
        csOrderIds: result.csOrderIds,
        error: result.error
      });
    }
  }

  // Print summary counts
  console.log(chalk.green(`✓ Created: ${summary.created}`));
  if (summary['already exists'] > 0) {
    console.log(chalk.yellow(`⚠ Already Exists: ${summary['already exists']}`));
  }
  if (summary.error > 0) {
    console.log(chalk.red(`✗ Errors: ${summary.error}`));
  }
  console.log(chalk.cyan(`📈 Total: ${summary.total}`));

  // Print error details if any
  if (errors.length > 0) {
    console.log(chalk.red('\n❌ Error Details:'));
    for (const error of errors) {
      console.log(chalk.red(`  Order ${error.orderCounter} (${error.csOrderIds?.join(', ') || 'Unknown'}): ${error.error}`));
    }
  }

  console.log(''); // Add blank line at end
}

/**
 * Validate if a string looks like a valid order ID
 * @param {any} orderId - The potential order ID to validate
 * @returns {boolean} - True if it looks like a valid order ID
 */
function isValidOrderId(orderId) {
  if (!orderId || typeof orderId !== 'string') {
    return false;
  }

  // Check if order ID starts with "CS-" followed by a number
  return /^CS-\d+$/.test(orderId);
}

function filterOrdersForDebugging(csOrders, orderId) {
  csOrders = csOrders.filter((csOrder) => csOrder.csOrderId === orderId);
  console.log(`Filtered ${csOrders.length} CS orders to ${orderId}`);
  return csOrders;
}

/**
 * Continue batch processing from stored state (called by alarm)
 */
export async function continueBatch({ state, durableObjectState, shopify: shopifyClient, env: environment, shopConfig: shop }) {
  console.log('🔄 Continuing avery batch processing from alarm');

  // Get batch state to access stored metadata
  const batchState = await durableObjectState.storage.get('batch:processor:state');
  if (!batchState) {
    throw new Error('No batch processor state found');
  }

  // Reconstruct the ctx object from stored metadata and current parameters
  const ctx = {
    shopify: shopifyClient,
    jobConfig: batchState.metadata.ctx ? batchState.metadata.ctx.jobConfig : state,
    env: environment,
    shopConfig: batchState.metadata.ctx ? batchState.metadata.ctx.shopConfig : shop
  };

  // Reconstruct the processor function
  const processor = async (csOrder, index, metadata) => {
    const orderCounter = index + 1;
    console.log(chalk.cyan(`Processing order ${csOrder.csOrderId}`));

    try {
      // Reconstruct ctx for the processor call
      const processorCtx = {
        shopify: shopifyClient,
        jobConfig: metadata.ctx ? metadata.ctx.jobConfig : state,
        env: environment,
        shopConfig: metadata.ctx ? metadata.ctx.shopConfig : shop
      };

      const result = await runSingleOrderSubJob(csOrder, orderCounter, metadata.processedDate, processorCtx);
      console.log(chalk.green(`  ✓ Order ${orderCounter} completed`));
      return result;
    } catch (error) {
      console.error(chalk.red(`  ✗ Order ${orderCounter} failed: ${error.message}`));
      return {
        status: 'error',
        orderCounter: orderCounter,
        csOrderIds: [csOrder.csOrderId],
        customerEmail: csOrder.lines[0]?.["Customer: Email"] || 'Unknown',
        customerName: csOrder.customer_name || 'Unknown',
        error: error.message
      };
    }
  };

  // Continue batch processing
  await continueBatchProcessing({
    processor,
    durableObjectState,
    onProgress: (completed, total) => {
      if (completed % 10 === 0 || completed === total) {
        console.log(`📊 Progress: ${completed}/${total} orders processed`);
      }
    },
    onBatchComplete: async (batchResults, batchNum, totalBatches) => {
      console.log(`✅ Batch ${batchNum}/${totalBatches} completed`);

      // Send email summary only after all batches complete
      if (batchNum === totalBatches && isWorkerEnvironment(environment)) {
        const batchState = await durableObjectState.storage.get('batch:processor:state');
        if (batchState && batchState.metadata) {
          await sendSimplifiedEmail(batchState.processedCount, batchState.metadata.processedDate, ctx);
        }
      }
    }
  });
}
