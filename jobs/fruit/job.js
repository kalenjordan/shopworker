import GetRecentOrders from "../../graphql/GetRecentOrders.js";
import { sendEmail, validateCredentials } from "../../connectors/resend.js";
import { logToCli, logToWorker } from "../../utils/log.js";

/**
 * Process orders and send email with Excel attachment
 * @param {Object} params - Parameters for the job
 * @param {Object} params.record - The record object (empty for manual jobs)
 * @param {Object} params.shopify - Shopify API client
 * @param {Object} params.env - Environment variables
 * @param {Object} params.secrets - Secrets loaded from files or environment
 */
export async function process({ shopify, shopConfig, env }) {
  console.log("Starting fruit orders email report job", shopConfig);

  // Validate email credentials
  const credentials = getEmailCredentials(shopConfig);
  validateCredentials(credentials);

  // Fetch recent orders
  const orders = await fetchRecentOrders(shopify);

  if (!orders || orders.length === 0) {
    console.log("No orders found to process");
    return;
  }

  console.log(`Found ${orders.length} orders to include in report`);

  // Generate CSV content
  const csvContent = generateCSV(orders);
  logToCli(env, csvContent);

  // Convert to base64 for attachment
  const base64Content = btoa(unescape(encodeURIComponent(csvContent)));

  // Prepare and send email
  const emailOptions = prepareEmailOptions(base64Content, orders.length, shopConfig);
  await sendEmail(emailOptions, credentials.apiKey);

  console.log(`Email report sent successfully with subject line: ${emailOptions.subject}`);
}

/**
 * Fetch recent orders from Shopify
 * @param {Object} shopify - Shopify API client
 * @returns {Promise<Array>} Array of order objects
 */
async function fetchRecentOrders(shopify) {
  const variables = {
    first: 3, // Fetch last 50 orders
    query: null // No additional filtering
  };

  const { orders } = await shopify.graphql(GetRecentOrders, variables);

  return orders?.edges?.map(edge => edge.node) || [];
}

/**
 * Generate CSV content
 * @param {Array} orders - Array of order objects
 * @returns {string} CSV content
 */
function generateCSV(orders) {
  // CSV headers
  const headers = [
    'Order Number',
    'Created At',
    'Customer Email',
    'Total Price',
    'Tags',
    'Line Items'
  ];

  // Convert orders to CSV rows
  const rows = orders.map(order => [
    escapeCSVField(order.name || ''),
    escapeCSVField(formatDate(order.createdAt)),
    escapeCSVField(order.customer?.email || ''),
    escapeCSVField(order.totalPrice || ''),
    escapeCSVField(Array.isArray(order.tags) ? order.tags.join(', ') : order.tags || ''),
    escapeCSVField(formatLineItems(order.lineItems))
  ]);

  // Combine headers and rows
  const allRows = [headers, ...rows];

  // Convert to CSV string
  return allRows.map(row => row.join(',')).join('\n');
}

/**
 * Escape CSV field by wrapping in quotes and escaping internal quotes
 * @param {string} field - Field value to escape
 * @returns {string} Escaped CSV field
 */
function escapeCSVField(field) {
  const stringField = String(field);

  // If field contains comma, quote, or newline, wrap in quotes and escape internal quotes
  if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n')) {
    return `"${stringField.replace(/"/g, '""')}"`;
  }

  return stringField;
}

/**
 * Format date for display
 * @param {string} isoDate - ISO date string
 * @returns {string} Formatted date
 */
function formatDate(isoDate) {
  if (!isoDate) return '';

  const date = new Date(isoDate);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Chicago'
  }).format(date);
}

/**
 * Format line items for display
 * @param {Object} lineItems - Line items object from GraphQL
 * @returns {string} Formatted line items string
 */
function formatLineItems(lineItems) {
  if (!lineItems?.edges) return '';

  return lineItems.edges
    .map(edge => {
      const item = edge.node;
      const sku = item.variant?.sku || item.sku || '';
      const name = item.name || '';
      return `${name}${sku ? ` (${sku})` : ''}`;
    })
    .join('; ');
}

/**
 * Get email credentials from shop config
 * @param {Object} shopConfig - Shop config object
 * @returns {Object} Credentials object
 */
function getEmailCredentials(shopConfig) {
  const apiKey = shopConfig.resend_api_key;

  if (!apiKey) {
    throw new Error('Missing resend_api_key in shop config');
  }

  return { apiKey };
}

/**
 * Prepare email options
 * @param {string} base64Content - Base64 encoded Excel content
 * @param {number} orderCount - Number of orders in the report
 * @param {Object} shopConfig - Shop config object
 * @returns {Object} Email options object
 */
function prepareEmailOptions(base64Content, orderCount, shopConfig) {
  const to = shopConfig.accounting_email || shopConfig.resend_to_email;
  const from = shopConfig.resend_from || shopConfig.resend_from_email;

  if (!to) {
    throw new Error('Missing accounting_email or resend_to_email in shop config');
  }

  if (!from) {
    throw new Error('Missing resend_from or resend_from_email in shop config');
  }

  const currentDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Chicago'
  });

  const filename = `orders-report-${new Date().toISOString().split('T')[0]}.csv`;

  return {
    to,
    from,
    subject: `Orders Report - ${currentDate}`,
    text: `Please find attached the orders report for ${currentDate}.\n\nThis report contains ${orderCount} orders.\n\nGenerated by Shopworker CLI.`,
    html: `
      <h2>Orders Report - ${currentDate}</h2>
      <p>Please find attached the orders report for <strong>${currentDate}</strong>.</p>
      <p>This report contains <strong>${orderCount}</strong> orders.</p>
      <p><em>Generated by Shopworker CLI</em></p>
    `,
    attachments: [{
      filename,
      content: base64Content,
      contentType: 'text/csv'
    }]
  };
}
