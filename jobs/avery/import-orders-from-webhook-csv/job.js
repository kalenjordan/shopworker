/**
 * Import from Webhook CSV Job
 *
 * This job processes webhook payloads for CSV import functionality.
 * Converts CSV data into structured orders grouped by customer and pre-order status.
 */

import { parseCSV } from "../../../connectors/csv.js";
import chalk from "chalk";

export async function process({ record, shopify, jobConfig }) {
  let limit = jobConfig.test.limit;
  const dryRun = jobConfig.test.dryRun || false;

  const decodedContent = validateAndDecodeAttachment(record);
  const parsedData = parseCSVContent(decodedContent);

  if (parsedData.rows.length === 0) {
    console.log("No data rows found");
    return;
  }

  const filteredRows = applyEmailFilter(parsedData.rows, jobConfig.test.filterEmail);
  const csOrders = buildCsOrdersFromRows(filteredRows, parsedData.rows.length);
  const customerGroups = groupOrdersByCustomer(csOrders);
  const shopifyOrderGroups = createShopifyOrderGroups(customerGroups, limit);

  await processShopifyOrders(shopifyOrderGroups, dryRun);
}

function validateAndDecodeAttachment(record) {
  if (!record.attachments || record.attachments.length === 0 || !record.attachments[0].content) {
    throw new Error("No attachments found or attachment content is empty");
  }

  console.log("\n=== Decoding Base64 Attachment Content ===");
  return atob(record.attachments[0].content);
}

function parseCSVContent(decodedContent) {
  console.log(`Processing entire CSV content`);

  const parsedData = parseCSV(decodedContent, { hasHeaders: true });

  console.log(`Processed ${parsedData.rows.length} data rows`);
  return parsedData;
}

function applyEmailFilter(rows, filterEmail) {
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

  console.log(`\nBuilt ${csOrders.length} CS orders from ${totalRowsCount} rows`);
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

function groupOrdersByCustomer(csOrders) {
  const customerGroups = {};

  for (const csOrder of csOrders) {
    const csCustomerId = csOrder.csCustomerId;
    if (!customerGroups[csCustomerId]) {
      customerGroups[csCustomerId] = [];
    }
    customerGroups[csCustomerId].push(csOrder);
  }

  console.log(`Total customer groups count: ${Object.keys(customerGroups).length}`);
  return customerGroups;
}

function createShopifyOrderGroups(customerGroups, limit) {
  const shopifyOrderGroups = {};
  let processedCustomerGroups = 0;

  if (limit > 0) {
    console.log(`Limiting processing to ${limit} customer groups`);
  }

  for (const [csCustomerId, customerCsOrders] of Object.entries(customerGroups)) {
    processedCustomerGroups++;

    if (limit > 0 && processedCustomerGroups > limit) {
      console.log(`\nReached customer group limit of ${limit}, stopping processing`);
      break;
    }

    processCustomerOrders(customerCsOrders, csCustomerId, shopifyOrderGroups);
  }

  console.log(`Total Shopify orders to create: ${Object.keys(shopifyOrderGroups).length}`);
  return shopifyOrderGroups;
}

function processCustomerOrders(customerCsOrders, csCustomerId, shopifyOrderGroups) {
  for (const csOrder of customerCsOrders) {
    const { preOrderLines, regularLines } = splitLinesByPreOrderStatus(csOrder.lines);

    if (preOrderLines.length > 0) {
      addOrderToGroup(csOrder, preOrderLines, `${csCustomerId}-pre-order`, "preorder", shopifyOrderGroups);
    }

    if (regularLines.length > 0) {
      addOrderToGroup(csOrder, regularLines, csCustomerId, "regular", shopifyOrderGroups);
    }
  }
}

function splitLinesByPreOrderStatus(lines) {
  const preOrderLines = lines.filter((line) => line["Line: Title"] && line["Line: Title"].startsWith("PRE-ORDER"));
  const regularLines = lines.filter((line) => !line["Line: Title"] || !line["Line: Title"].startsWith("PRE-ORDER"));

  return { preOrderLines, regularLines };
}

function addOrderToGroup(csOrder, lines, shopifyOrderKey, orderType, shopifyOrderGroups) {
  const modifiedCsOrder = {
    ...csOrder,
    csOrderId: `${csOrder.csOrderId}-${orderType}`,
    lines: lines,
  };

  if (!shopifyOrderGroups[shopifyOrderKey]) {
    shopifyOrderGroups[shopifyOrderKey] = [];
  }
  shopifyOrderGroups[shopifyOrderKey].push(modifiedCsOrder);
}

async function processShopifyOrders(shopifyOrderGroups, dryRun) {
  let shopifyOrderNumber = 0;
  const shopifyOrderEntries = Object.entries(shopifyOrderGroups);

  for (const [shopifyOrderKey, csOrdersInGroup] of shopifyOrderEntries) {
    shopifyOrderNumber++;
    const shopifyOrderData = buildShopifyOrderData(csOrdersInGroup, shopifyOrderNumber);

    if (dryRun) {
      logDryRunOrder(shopifyOrderKey, shopifyOrderData);
    } else {
      await createShopifyOrder(shopifyOrderData, shopifyOrderNumber);
    }
  }

  console.log(`\nProcessed ${shopifyOrderNumber} Shopify orders`);
}

function buildShopifyOrderData(csOrdersInGroup, shopifyOrderNumber) {
  const allLineItems = [];
  const allDiscounts = [];
  const allShipping = [];
  const allTransactions = [];
  const csOrderIds = [];

  for (const csOrder of csOrdersInGroup) {
    csOrderIds.push(csOrder.csOrderId);
    allLineItems.push(...csOrder.lines);

    if (csOrder.discount) allDiscounts.push(csOrder.discount);
    if (csOrder.shipping) allShipping.push(csOrder.shipping);
    if (csOrder.transaction) allTransactions.push(csOrder.transaction);
  }

  return {
    name: csOrdersInGroup[0].lines[0]["Shipping: Name"],
    email: csOrdersInGroup[0].lines[0]["Customer: Email"],
    shopifyOrderNumber: shopifyOrderNumber,
    csCustomerId: csOrdersInGroup[0].csCustomerId,
    csOrderIds: csOrderIds,
    csOrderCount: csOrdersInGroup.length,
    lineItems: allLineItems,
    discounts: allDiscounts,
    shipping: allShipping,
    transactions: allTransactions,
  };
}

function logDryRunOrder(shopifyOrderKey, shopifyOrderData) {
  console.log(chalk.yellow(`\n=== DRY RUN CREATE SHOPIFY ORDER ===`));
  console.log(`Shopify Order Key: ${shopifyOrderKey}`);
  console.log(`Customer: ${shopifyOrderData.name} (${shopifyOrderData.email}) (CS Customer ID: ${shopifyOrderData.csCustomerId})`);
  console.log(`CS Order IDs: ${shopifyOrderData.csOrderIds.join(", ")}`);

  logOrderLineItems(shopifyOrderData.lineItems);
  logOrderDiscounts(shopifyOrderData.discounts);
  logOrderShipping(shopifyOrderData.shipping);
  logOrderTransactions(shopifyOrderData.transactions);
}

function logOrderLineItems(lineItems) {
  if (lineItems.length > 0) {
    console.log(`\n  Merged Line Items:`);
    lineItems.forEach((line, lineIdx) => {
      const sku = line["Line: SKU"] || "MISSING SKU";
      const price = line["Line: Price"] || "No Price";
      console.log(
        `    ${lineIdx + 1}. ${line["Line: Title"]} (${line["Line: Variant Title"] || "N/A"}) - ${chalk.gray(sku)} - ${chalk.green("$" + price)}`
      );
    });
  }
}

function logOrderDiscounts(discounts) {
  if (discounts.length > 0) {
    console.log(`\n  Discounts (${discounts.length}):`);
    discounts.forEach((discount, discountIdx) => {
      console.log(`    ${discountIdx + 1}. ${discount["Line: Discount"]} - ${discount["Line: Title"]}`);
    });
  }
}

function logOrderShipping(shipping) {
  if (shipping.length > 0) {
    console.log(`\n  Shipping (${shipping.length}):`);
    shipping.forEach((shippingItem, shippingIdx) => {
      console.log(`    ${shippingIdx + 1}. ${shippingItem["Line: Title"]} - ${shippingItem["Line: Price"]}`);
    });
  }
}

function logOrderTransactions(transactions) {
  if (transactions.length > 0) {
    console.log(`\n  Transactions (${transactions.length}):`);
    transactions.forEach((transaction, transactionIdx) => {
      console.log(`    ${transactionIdx + 1}. ${transaction["Line: Title"]} - ${transaction["Line: Price"]}`);
    });
  }
}

async function createShopifyOrder(shopifyOrderData, shopifyOrderNumber) {
  console.log(`\n=== CREATE SHOPIFY ORDER ${shopifyOrderNumber} ===`);
  console.log(`Customer: ${shopifyOrderData.name} (${shopifyOrderData.email})`);
  console.log(`CS Order IDs: ${shopifyOrderData.csOrderIds.join(", ")}`);
  console.log(`Total Line Items: ${shopifyOrderData.lineItems.length}`);
  console.log(`CS Customer ID: ${shopifyOrderData.csCustomerId}`);

  // TODO: Implement actual Shopify order creation logic here
  // This would replace the Liquid "action event" with actual Shopify API calls
}
