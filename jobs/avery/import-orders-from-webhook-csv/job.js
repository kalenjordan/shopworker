/**
 * Import from Webhook CSV Job
 *
 * This job processes webhook payloads for CSV import functionality.
 * Converts CSV data into structured orders grouped by customer and pre-order status.
 */

import { parseCSV } from "../../../connectors/csv.js";

export async function process({ record, shopify, jobConfig }) {
  let limit = jobConfig.test.limit;
  const dryRun = jobConfig.test.dryRun || false;

  // Decode base64 content from first attachment if available
  if (!record.attachments || record.attachments.length === 0 || !record.attachments[0].content) {
    throw new Error("No attachments found or attachment content is empty");
  }

  console.log("\n=== Decoding Base64 Attachment Content ===");
  const decodedContent = atob(record.attachments[0].content);

  console.log(`Processing entire CSV content`);

  // Parse CSV using the connector
  const parsedData = parseCSV(decodedContent, {
    hasHeaders: true,
  });

  if (parsedData.rows.length === 0) {
    console.log("No data rows found");
    return;
  }

  console.log(`Processed ${parsedData.rows.length} data rows`);
  const totalRowsCount = parsedData.rows.length;

  // Filter rows by email if filterEmail is specified in jobConfig
  let filteredRows = parsedData.rows;
  if (jobConfig.test.filterEmail) {
    console.log(`\nFiltering rows by email: ${jobConfig.test.filterEmail}`);
    filteredRows = parsedData.rows.filter(row => row["Customer: Email"] === jobConfig.test.filterEmail);
    console.log(`Found ${filteredRows.length} rows matching email filter`);

    if (filteredRows.length === 0) {
      console.log(`No rows found for email: ${jobConfig.test.filterEmail}`);
      return;
    }
  }

  // Build CS orders by grouping rows by order ID (Name field)
  let lastCsOrderId = null;
  let csOrderIndex = -1;
  const csOrders = [];

  for (const row of filteredRows) {
    const lineType = row['Line: Type'];
    const csOrderId = row['Name'];

    // Start new CS order when we encounter a new order ID
    if (csOrderId && csOrderId !== lastCsOrderId) {
      csOrderIndex++;
      csOrders[csOrderIndex] = {
        csOrderId: csOrderId,
        csCustomerId: row['Metafield: commentsold.user'],
        customer_name: row['Shipping: Name'],
        lines: [],
        discount: null,
        shipping: null,
        transaction: null
      };
      lastCsOrderId = csOrderId;
    }

    // Group different line types into the current CS order
    if (lineType === 'Line Item') {
      csOrders[csOrderIndex].lines.push(row);
    } else if (lineType === 'Discount' && row['Line: Discount'] !== "") {
      csOrders[csOrderIndex].discount = row;
    } else if (lineType === 'Shipping Line') {
      csOrders[csOrderIndex].shipping = row;
    } else if (lineType === 'Transaction') {
      csOrders[csOrderIndex].transaction = row;
    }
  }

  console.log(`\nBuilt ${csOrders.length} CS orders from ${totalRowsCount} rows`);

  // Group CS orders by customer ID
  const customerGroups = {};
  for (const csOrder of csOrders) {
    const csCustomerId = csOrder.csCustomerId;
    if (!customerGroups[csCustomerId]) {
      customerGroups[csCustomerId] = [];
    }
    customerGroups[csCustomerId].push(csOrder);
  }

  const customerGroupsCount = Object.keys(customerGroups).length;
  console.log(`Total customer groups count: ${customerGroupsCount}`);

  // Further group by pre-order status to create Shopify orders (split line items)
  const shopifyOrderGroups = {};
  for (const [csCustomerId, customerCsOrders] of Object.entries(customerGroups)) {
    for (const csOrder of customerCsOrders) {
      // Split line items by pre-order status
      const preOrderLines = csOrder.lines.filter(line =>
        line['Line: Title'] && line['Line: Title'].startsWith('PRE-ORDER')
      );
      const regularLines = csOrder.lines.filter(line =>
        !line['Line: Title'] || !line['Line: Title'].startsWith('PRE-ORDER')
      );

      // Create separate CS order parts if both types exist
      if (preOrderLines.length > 0) {
        const preOrderCsOrder = {
          ...csOrder,
          csOrderId: `${csOrder.csOrderId}-preorder`,
          lines: preOrderLines
        };

        const shopifyOrderKey = `${csCustomerId}-pre-order`;
        if (!shopifyOrderGroups[shopifyOrderKey]) {
          shopifyOrderGroups[shopifyOrderKey] = [];
        }
        shopifyOrderGroups[shopifyOrderKey].push(preOrderCsOrder);
      }

      if (regularLines.length > 0) {
        const regularCsOrder = {
          ...csOrder,
          csOrderId: `${csOrder.csOrderId}-regular`,
          lines: regularLines
        };

        const shopifyOrderKey = csCustomerId;
        if (!shopifyOrderGroups[shopifyOrderKey]) {
          shopifyOrderGroups[shopifyOrderKey] = [];
        }
        shopifyOrderGroups[shopifyOrderKey].push(regularCsOrder);
      }
    }
  }

  const shopifyOrderCount = Object.keys(shopifyOrderGroups).length;
  console.log(`Total Shopify orders to create: ${shopifyOrderCount}`);

  // Process each Shopify order (apply customer limit here)
  let shopifyOrderNumber = 0;
  const shopifyOrderEntries = Object.entries(shopifyOrderGroups);

  if (limit > 0) {
    console.log(`Limiting processing to ${limit} Shopify orders`);
  }

  for (const [shopifyOrderKey, csOrdersInGroup] of shopifyOrderEntries) {
    shopifyOrderNumber++;

    // Apply customer limit
    if (limit > 0 && shopifyOrderNumber > limit) {
      console.log(`\nReached Shopify order limit of ${limit}, stopping processing`);
      break;
    }

    const customerName = csOrdersInGroup[0].customer_name;
    const csOrderCount = csOrdersInGroup.length;

    const shopifyOrderData = {
      name: csOrdersInGroup[0].lines[0]['Shipping: Name'],
      email: csOrdersInGroup[0].lines[0]['Customer: Email'],
      shopifyOrderNumber: shopifyOrderNumber,
      csCustomerId: csOrdersInGroup[0].csCustomerId,
      csOrderCount: csOrderCount,
      csOrders: csOrdersInGroup
    };

    if (dryRun) {
      console.log(`\n=== DRY RUN CREATE SHOPIFY ORDER ===`);
      console.log(`Shopify Order Key: ${shopifyOrderKey}`);
      console.log(`Customer: ${shopifyOrderData.name} (${shopifyOrderData.email})`);
      console.log(`CS Customer ID: ${shopifyOrderData.csCustomerId}`);
      console.log(`CS Order Count: ${shopifyOrderData.csOrderCount}`);

      // Log key details for each CS order in the Shopify order
      shopifyOrderData.csOrders.forEach((csOrder, csOrderIdx) => {
        console.log(`\n  CS Order ${csOrderIdx + 1} - CS Order ID: ${csOrder.csOrderId}`);

        // Log line items
        if (csOrder.lines && csOrder.lines.length > 0) {
          console.log(`    Line Items (${csOrder.lines.length}):`);
          csOrder.lines.forEach((line, lineIdx) => {
            console.log(`      ${lineIdx + 1}. ${line['Line: Title']} (${line['Line: Variant Title'] || 'N/A'})`);
          });
        }

        // Log discount if present
        if (csOrder.discount) {
          console.log(`    Discount: ${csOrder.discount['Line: Discount']} - ${csOrder.discount['Line: Title']}`);
        }

        // Log shipping if present
        if (csOrder.shipping) {
          console.log(`    Shipping: ${csOrder.shipping['Line: Title']} - ${csOrder.shipping['Line: Price']}`);
        }

        // Log transaction if present
        if (csOrder.transaction) {
          console.log(`    Transaction: ${csOrder.transaction['Line: Title']} - ${csOrder.transaction['Line: Price']}`);
        }
      });
    } else {
      console.log(`\n=== CREATE SHOPIFY ORDER ${shopifyOrderNumber} ===`);
      console.log(`Customer: ${shopifyOrderData.name} (${shopifyOrderData.email})`);
      console.log(`CS Orders: ${csOrderCount}`);
      console.log(`CS Customer ID: ${shopifyOrderData.csCustomerId}`);

      // TODO: Implement actual Shopify order creation logic here
      // This would replace the Liquid "action event" with actual Shopify API calls
    }
  }

  console.log(`\nProcessed ${shopifyOrderNumber} Shopify orders`);
}
