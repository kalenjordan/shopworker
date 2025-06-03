/**
 * Import from Webhook CSV Job
 *
 * This job processes webhook payloads for CSV import functionality.
 * Converts CSV data into structured orders grouped by customer and pre-order status.
 */

import { parseCSV } from "../../../connectors/csv.js";
import chalk from "chalk";
import { format, parseISO, addHours } from "date-fns";
// import fs from "fs";

// GraphQL imports
import FindOrdersByTag from "../../../graphql/FindOrdersByTag.js";
import FindVariantBySku from "../../../graphql/FindVariantBySku.js";
import FindCustomerByEmail from "../../../graphql/FindCustomerByEmail.js";
import FindCustomerByTag from "../../../graphql/FindCustomerByTag.js";
import FindCustomerByPhone from "../../../graphql/FindCustomerByPhone.js";
import CreateOrder from "../../../graphql/CreateOrder.js";
import AddCustomerTags from "../../../graphql/AddCustomerTags.js";

// Module-level variables to avoid passing around
let shopify;
let jobConfig;

export async function process({ record, shopify: shopifyClient, jobConfig: config }) {
  // Set module-level variables
  shopify = shopifyClient;
  jobConfig = config;

  const decodedContent = validateAndDecodeAttachment(record);
  const parsedData = parseCSVContent(decodedContent);

  if (parsedData.rows.length === 0) {
    console.log("No data rows found");
    return;
  }

  const filteredRows = applyEmailFilter(parsedData.rows);
  const csOrders = buildCsOrdersFromRows(filteredRows, parsedData.rows.length);
  const customerGroups = groupOrdersByCustomer(csOrders);
  const shopifyOrderGroups = createShopifyOrderGroups(customerGroups);

  await processShopifyOrders(shopifyOrderGroups);
}

// Helper function to check if we're in dry run mode
function isDryRun() {
  return jobConfig.test.dryRun || false;
}

// Helper function to get the limit from job config
function getLimit() {
  return jobConfig.test.limit || 0;
}

// Helper function to get the filter email from job config
function getFilterEmail() {
  return jobConfig.test.filterEmail;
}

function validateAndDecodeAttachment(record) {
  if (!record.attachments || record.attachments.length === 0 || !record.attachments[0].content) {
    throw new Error("No attachments found or attachment content is empty");
  }

  console.log("\n=== Decoding Base64 Attachment Content ===");
  const decodedContent = atob(record.attachments[0].content);

  // For testing - save decoded CSV content to file
  // const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
  // const filename = `decoded-csv-${timestamp}.csv`;

  // try {
  //   fs.writeFileSync(filename, decodedContent, 'utf8');
  //   console.log(`CSV content saved to: ${filename}`);
  // } catch (error) {
  //   console.warn(`Warning: Could not save CSV file: ${error.message}`);
  // }

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

function createShopifyOrderGroups(customerGroups) {
  const shopifyOrderGroups = {};
  let processedCustomerGroups = 0;
  const limit = getLimit();

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

async function processShopifyOrders(shopifyOrderGroups) {
  let shopifyOrderNumber = 0;
  const shopifyOrderEntries = Object.entries(shopifyOrderGroups);

  for (const [shopifyOrderKey, csOrdersInGroup] of shopifyOrderEntries) {
    shopifyOrderNumber++;
    const shopifyOrderData = buildShopifyOrderData(csOrdersInGroup, shopifyOrderNumber);

    logOrder(shopifyOrderKey, shopifyOrderData);
    try {
      await createShopifyOrder(shopifyOrderData, shopifyOrderNumber);
    } catch (error) {
      console.error(chalk.red(`  Error creating Shopify order: ${error.message}`));
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

function logOrder(shopifyOrderKey, shopifyOrderData) {
  console.log(chalk.yellow(`\n=== SHOPIFY ORDER ${shopifyOrderData.shopifyOrderNumber} ===`));
  console.log(`Shopify Order Key: ${shopifyOrderKey}`);
  console.log(`Customer: ${shopifyOrderData.name} (${shopifyOrderData.email}) (CS Customer ID: ${shopifyOrderData.csCustomerId})`);
  console.log(`CS Order IDs: ${shopifyOrderData.csOrderIds.join(", ")}`);

  logOrderLineItems(shopifyOrderData.lineItems);
  logOrderDiscounts(shopifyOrderData.discounts);
  logOrderShipping(shopifyOrderData.shipping);
  logOrderTransactions(shopifyOrderData.transactions);
  logOrderTotals(shopifyOrderData);
}

function logOrderLineItems(lineItems) {
  if (lineItems.length > 0) {
    console.log(`\n  Merged Line Items:`);
    lineItems.forEach((line, lineIdx) => {
      const sku = line["Line: SKU"] || "MISSING SKU";
      const price = line["Line: Price"] || "No Price";
      const tax = line["Tax: Total"] || "No Tax";
      console.log(
        `    ${lineIdx + 1}. ${line["Line: Title"]} (${line["Line: Variant Title"] || "N/A"}) - ${chalk.gray(sku)} - ${chalk.green("$" + price)} - ${chalk.cyan("$" + tax)}`
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
      const amount = transaction['Transaction: Amount'] ? `$${parseFloat(transaction['Transaction: Amount']).toFixed(2)}` : 'No Amount';
      console.log(`    ${transactionIdx + 1}. ${transaction["Line: Title"]} - ${transaction["Line: Price"]} - ${chalk.blue(amount)}`);
    });
  }
}

function logOrderTotals(shopifyOrderData) {
  const { lineItems, shipping, discounts, transactions } = shopifyOrderData;

  // Calculate line items total
  const lineItemsTotal = lineItems.reduce((sum, line) => {
    return sum + (parseFloat(line['Line: Price'] || 0) * parseInt(line['Line: Quantity'] || 1));
  }, 0);

  // Calculate shipping total
  const shippingTotal = shipping.reduce((sum, shippingItem) => {
    return sum + parseFloat(shippingItem['Line: Price'] || 0);
  }, 0);

  // Calculate discount total
  const discountTotal = discounts.reduce((sum, discount) => {
    return sum + parseFloat(discount['Line: Discount'] || 0);
  }, 0);

  // Calculate transaction total
  const transactionTotal = transactions.reduce((sum, transaction) => {
    return sum + parseFloat(transaction['Transaction: Amount'] || 0);
  }, 0);

  // Calculate tax totals
  const taxTotal = lineItems.reduce((sum, line) => {
    return sum + parseFloat(line['Tax: Total'] || 0);
  }, 0);

  // Calculate order total (line items + shipping + tax - discounts)
  const orderTotal = lineItemsTotal + shippingTotal + taxTotal - discountTotal;

  console.log(`\n  Order Totals:`);
  console.log(`    Line Items: ${chalk.green("$" + lineItemsTotal.toFixed(2))}`);
  console.log(`    Shipping: ${chalk.green("$" + shippingTotal.toFixed(2))}`);
  console.log(`    Tax: ${chalk.cyan("$" + taxTotal.toFixed(2))}`);
  if (discountTotal > 0) {
    console.log(`    Discounts: ${chalk.red("-$" + discountTotal.toFixed(2))}`);
  }
  console.log(`    ${chalk.bold.green("Order Total: $" + orderTotal.toFixed(2))}`);

  if (transactionTotal > 0) {
    console.log(`    Transaction Amount: ${chalk.blue("$" + transactionTotal.toFixed(2))}`);

    // Show difference if transaction doesn't match order total
    const difference = Math.abs(orderTotal - transactionTotal);
    if (difference > 0.01) { // Allow for small rounding differences
      console.log(`    ${chalk.yellow("⚠️  Difference: $" + difference.toFixed(2))}`);
    }
  }
}

async function createShopifyOrder(shopifyOrderData, shopifyOrderNumber) {
  console.log(chalk.green(`\n  Creating Shopify Order ${shopifyOrderNumber}`));
  console.log(`  Customer: ${shopifyOrderData.name} (${shopifyOrderData.email})`);
  console.log(`  CS Order IDs: ${shopifyOrderData.csOrderIds.join(", ")}`);
  console.log(`  Total Line Items: ${shopifyOrderData.lineItems.length}`);
  console.log(`  CS Customer ID: ${shopifyOrderData.csCustomerId}`);

  const { csCustomerId, csOrderIds, lineItems } = shopifyOrderData;

  // Check if orders already exist
  for (const csOrderId of csOrderIds) {
    const existingOrder = await checkExistingOrder(csOrderId);
    if (existingOrder) {
      console.log(`  Order already exists: ${csOrderId}`);
      return;
    }
  }

  // Check if order is too old (more than 1 month)
  const firstLine = lineItems[0];
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  const processedAt = parseISO(firstLine['Processed At']);

  if (processedAt < oneMonthAgo) {
    const errorMessage = `Skipping order because it was created before: ${format(oneMonthAgo, 'yyyy-MM-dd')}`;
    throw new Error(errorMessage);
  }

  // Build line items and calculate totals
  const { shopifyLineItems, totals } = await buildOrderLineItems(lineItems);

  // Find or create customer
  const customerId = await findOrCreateCustomer(shopifyOrderData);

  // Build order payload
  const orderPayload = buildOrderPayload(shopifyOrderData, shopifyLineItems, totals, customerId);

  // Create the order
  await createOrder(orderPayload);

  // Add customer tags if customer exists
  if (customerId) {
    await addCustomerTags(customerId, csCustomerId);
  }
}

async function checkExistingOrder(csOrderId) {
  const query = `tag:'${csOrderId}'`;
  const { orders } = await shopify.graphql(FindOrdersByTag, { tag: query });
  return orders.nodes[0];
}

async function buildOrderLineItems(lineItems) {
  const shopifyLineItems = [];
  let lineItemTotals = 0;
  let totalWeight = 0;

  for (const line of lineItems) {
    const sku = line['Line: SKU'];
    const variant = await findVariantBySku(sku);

    if (!variant) {
      throw new Error(`Couldn't find variant from sku: ${sku}`);
    }

    const shopifyLine = {
      title: line['Line: Title'],
      price: line['Line: Price'],
      requires_shipping: true,
      quantity: parseInt(line['Line: Quantity']),
      taxable: true,
      product_id: parseInt(variant.product.id),
      variant_id: parseInt(variant.id),
      grams: parseInt(line['Line: Grams'] || 0)
    };

    shopifyLineItems.push(shopifyLine);
    lineItemTotals += parseFloat(line['Line: Price']);
    totalWeight += parseInt(line['Line: Grams'] || 0);
  }

  return {
    shopifyLineItems,
    totals: {
      lineItemTotals,
      totalWeight
    }
  };
}

async function findVariantBySku(sku) {
  const query = `sku:"${sku}"`;
  const { productVariants } = await shopify.graphql(FindVariantBySku, { sku: query });
  return productVariants.nodes[0];
}

async function findOrCreateCustomer(shopifyOrderData) {
  const { email, csCustomerId } = shopifyOrderData;

  // Try to find by email first
  let customerId = await findCustomerByEmail(email);

  // If not found by email, try by CS customer tag
  if (!customerId) {
    const tag = `CS-${csCustomerId}`;
    customerId = await findCustomerByTag(tag);
  }

  // Try by phone number
  const phone = formatPhoneNumber(shopifyOrderData.lineItems[0]['Customer: Phone']);
  if (phone) {
    const customerIdFromPhone = await findCustomerByPhone(phone);
    if (customerIdFromPhone) {
      if (!customerId) {
        console.log("  Using customer ID from phone number");
        customerId = customerIdFromPhone;
      } else if (customerId !== customerIdFromPhone) {
        console.log("  Phone number conflict, will skip phone in order");
        // Handle phone conflict by not using phone in order
      }
    }
  }

  return customerId;
}

async function findCustomerByEmail(email) {
  const query = `email:'${email}'`;
  const { customers } = await shopify.graphql(FindCustomerByEmail, { email: query });
  return customers.nodes[0]?.id;
}

async function findCustomerByTag(tag) {
  const query = `'${tag}'`;
  const { customers } = await shopify.graphql(FindCustomerByTag, { tag: query });
  return customers.nodes[0]?.id;
}

async function findCustomerByPhone(phone) {
  const query = `phone:'${phone}'`;
  const { customers } = await shopify.graphql(FindCustomerByPhone, { phone: query });
  return customers.nodes[0]?.id;
}

function formatPhoneNumber(phone) {
  if (!phone) return null;
  // Basic E.164 formatting for US numbers
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  }
  return null;
}

function buildOrderPayload(shopifyOrderData, shopifyLineItems, totals, customerId) {
  const { lineItems, csCustomerId, csOrderIds, shipping, discounts, transactions } = shopifyOrderData;
  const firstLine = lineItems[0];

  // Parse name
  const nameParts = (firstLine['Shipping: Name'] || '').split(' ');
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '(Empty)';

  // Calculate totals from order data
  const taxLine1Total = parseFloat(firstLine['Tax 1: Price'] || 0);
  const taxLine2Total = parseFloat(firstLine['Tax 2: Price'] || 0);
  const taxLine3Total = parseFloat(firstLine['Tax 3: Price'] || 0);
  const taxLine4Total = parseFloat(firstLine['Tax 4: Price'] || 0);

  // Calculate shipping total from shipping array
  const totalShipping = shipping.reduce((sum, shippingItem) => {
    return sum + parseFloat(shippingItem['Line: Price'] || 0);
  }, 0);

  // Calculate discount total from discounts array
  const totalDiscount = discounts.reduce((sum, discount) => {
    return sum + parseFloat(discount['Line: Discount'] || 0);
  }, 0);

  // Calculate transaction total
  const totalTransactionAmount = transactions.reduce((sum, transaction) => {
    return sum + parseFloat(transaction['Transaction: Amount'] || 0);
  }, 0);

  // Build tags
  const tags = [...csOrderIds];
  const rawTags = firstLine['Tags'] ? firstLine['Tags'].replace('First Order', 'First_Order').split(',') : [];
  tags.push(...rawTags);

  // Add special tags
  const titleBeginning = lineItems[0]['Line: Title']?.slice(0, 9);
  if (titleBeginning === 'PRE-ORDER') {
    tags.push('_Pre-Order');
  }

  if (tags.some(tag => tag.includes('CS-LOCAL'))) {
    tags.push('_Local Pickup');
  }

  // Format processed date (add 5 hours as in Liquid template)
  const processedAt = format(addHours(parseISO(firstLine['Processed At']), 5), "yyyy-MM-dd'T'HH:mm:ss");

  const phone = formatPhoneNumber(firstLine['Customer: Phone']);

  // Build line items with correct structure
  const orderLineItems = shopifyLineItems.map(item => ({
    quantity: item.quantity,
    variantId: item.variant_id,
    priceSet: {
      shopMoney: {
        amount: item.price,
        currencyCode: "USD"
      }
    }
  }));

  // Build tax lines with correct structure
  const taxLines = [];
  if (taxLine1Total > 0) {
    taxLines.push({
      title: firstLine['Tax 1: Title'] || '',
      rate: parseFloat(firstLine['Tax 1: Rate'] || 0),
      priceSet: {
        shopMoney: {
          amount: taxLine1Total.toString(),
          currencyCode: "USD"
        }
      }
    });
  }
  if (taxLine2Total > 0) {
    taxLines.push({
      title: firstLine['Tax 2: Title'] || '',
      rate: parseFloat(firstLine['Tax 2: Rate'] || 0),
      priceSet: {
        shopMoney: {
          amount: taxLine2Total.toString(),
          currencyCode: "USD"
        }
      }
    });
  }
  if (taxLine3Total > 0) {
    taxLines.push({
      title: firstLine['Tax 3: Title'] || '',
      rate: parseFloat(firstLine['Tax 3: Rate'] || 0),
      priceSet: {
        shopMoney: {
          amount: taxLine3Total.toString(),
          currencyCode: "USD"
        }
      }
    });
  }
  if (taxLine4Total > 0) {
    taxLines.push({
      title: firstLine['Tax 4: Title'] || '',
      rate: parseFloat(firstLine['Tax 4: Rate'] || 0),
      priceSet: {
        shopMoney: {
          amount: taxLine4Total.toString(),
          currencyCode: "USD"
        }
      }
    });
  }

  // Build shipping lines with correct structure
  const shippingLines = [];
  if (totalShipping > 0) {
    shippingLines.push({
      title: "CommentSold Shipping",
      code: "CommentSold Shipping",
      priceSet: {
        shopMoney: {
          amount: totalShipping.toString(),
          currencyCode: "USD"
        }
      }
    });
  }

  const payload = {
    processedAt: processedAt,
    email: shopifyOrderData.email,
    currency: "USD",
    buyerAcceptsMarketing: false,
    financialStatus: "PAID", // Use enum value instead of string
    tags: tags,
    shippingAddress: {
      firstName: firstName,
      lastName: lastName,
      address1: firstLine['Shipping: Address 1'] || '',
      address2: firstLine['Shipping: Address 2'] || '',
      city: firstLine['Shipping: City'] || '',
      province: firstLine['Shipping: Province Code'] || '',
      zip: firstLine['Shipping: Zip'] || '',
      country: firstLine['Shipping: Country'] || 'US'
    },
    lineItems: orderLineItems,
    taxLines: taxLines,
    shippingLines: shippingLines
  };

  // Add customer information
  if (customerId) {
    payload.customer = {
      toAssociate: {
        id: customerId
      }
    };
  } else {
    payload.customer = {
      toUpsert: {
        firstName: firstName,
        lastName: lastName,
        email: shopifyOrderData.email,
        tags: [`CS-DIRECT`, `CS-${csCustomerId}`]
      }
    };
  }

  // Add phone if available
  if (phone) {
    payload.phone = phone;
    if (payload.customer.toUpsert) {
      payload.customer.toUpsert.phone = phone;
    }
  }

  // Add transactions if there are any
  if (totalTransactionAmount > 0) {
    payload.transactions = [{
      kind: "SALE", // Use enum value
      status: "SUCCESS", // Use enum value
      amountSet: {
        shopMoney: {
          amount: totalTransactionAmount.toString(),
          currencyCode: "USD"
        }
      }
    }];
  }

  return payload;
}

async function createOrder(orderPayload) {
  if (isDryRun()) {
    console.log(chalk.yellow("  DRY RUN - Would create order with payload:"));
    console.log(JSON.stringify(orderPayload, null, 2));
    return { order: { name: "DRY-RUN-ORDER", legacyResourceId: "123456" } };
  }

  const { orderCreate } = await shopify.graphql(CreateOrder, { input: orderPayload });

  if (orderCreate.userErrors.length > 0) {
    const errors = orderCreate.userErrors.map(err => err.message).join(', ');
    throw new Error(`Order creation failed: ${errors}`);
  }

  console.log(`  Successfully created order: ${orderCreate.order.name} (ID: ${orderCreate.order.legacyResourceId})`);
  return orderCreate.order;
}

async function addCustomerTags(customerId, csCustomerId) {
  if (isDryRun()) {
    console.log(chalk.yellow(`  DRY RUN - Would add tag CS-${csCustomerId} to customer ${customerId}`));
    return;
  }

  const tag = `CS-${csCustomerId}`;
  const customerGid = `gid://shopify/Customer/${customerId}`;

  const { tagsAdd } = await shopify.graphql(AddCustomerTags, {
    customerId: customerGid,
    tags: [tag]
  });

  if (tagsAdd.userErrors.length > 0) {
    console.log(`  Warning: Could not add customer tags: ${tagsAdd.userErrors.map(err => err.message).join(', ')}`);
  }
}
