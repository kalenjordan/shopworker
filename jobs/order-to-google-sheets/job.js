import path from 'path';
import { fileURLToPath } from 'url';
import { getSheetData, appendSheetData } from '../../utils/google-sheets.js';

// Get the directory name in ESM (needed for proper path resolution)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliDirname = path.resolve(__dirname, '../..');

// Config for the Google Sheet
const SPREADSHEET_CONFIG = {
  // Replace with your actual Google Sheet ID
  spreadsheetId: process.env.GOOGLE_SHEET_ID || '1-YourActualSpreadsheetIDGoesHere',
  // The sheet and range where orders will be added
  ordersRange: 'Orders!A1',
  // Columns for the sheet
  columns: [
    'Order ID',
    'Date',
    'Customer Name',
    'Email',
    'Phone',
    'Total',
    'Currency',
    'Payment Status',
    'Fulfillment Status',
    'Items'
  ]
};

/**
 * Format date for better readability
 * @param {string} isoDate - ISO format date
 * @returns {string} Formatted date
 */
function formatDate(isoDate) {
  return new Date(isoDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Format order items into a readable string
 * @param {Array} lineItems - Order line items
 * @returns {string} Formatted item list
 */
function formatLineItems(lineItems) {
  if (!lineItems || lineItems.length === 0) {
    return 'No items';
  }

  return lineItems.map(item => {
    const title = item.title || 'Unknown Product';
    const variantTitle = item.variantTitle ? ` - ${item.variantTitle}` : '';
    const quantity = item.quantity || 0;
    return `${quantity}x ${title}${variantTitle}`;
  }).join(', ');
}

/**
 * Format order data for the Google Sheet
 * @param {Object} order - Shopify order data
 * @returns {Array} Row of data for the sheet
 */
function formatOrderForSheet(order) {
  if (!order) return [];

  // Extract customer name
  const customerName = order.customer ?
    `${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim() :
    'Guest';

  // Extract customer email
  const email = order.customer?.email || order.email || '';

  // Extract customer phone
  const phone = order.customer?.phone || order.phone || '';

  // Format items
  const items = formatLineItems(order.lineItems?.edges?.map(edge => edge.node) || []);

  // Create the row
  return [
    order.id || order.name || '',                 // Order ID
    formatDate(order.createdAt || new Date()),    // Date
    customerName,                                 // Customer Name
    email,                                        // Email
    phone,                                        // Phone
    order.totalPriceSet?.shopMoney?.amount || 0,  // Total
    order.totalPriceSet?.shopMoney?.currencyCode || '', // Currency
    order.financialStatus || '',                  // Payment Status
    order.fulfillmentStatus || 'unfulfilled',     // Fulfillment Status
    items                                         // Items
  ];
}

/**
 * Initialize the Google Sheet with headers if needed
 * @param {Object} shopify - Shopify API client
 * @returns {Promise<void>}
 */
async function initializeSheetIfNeeded() {
  try {
    // Check if the sheet has data already
    const data = await getSheetData(cliDirname, SPREADSHEET_CONFIG.spreadsheetId, SPREADSHEET_CONFIG.ordersRange);

    // If no data or no headers, add headers
    if (!data || data.length === 0) {
      console.log('Initializing Google Sheet with headers...');
      await appendSheetData(
        cliDirname,
        SPREADSHEET_CONFIG.spreadsheetId,
        SPREADSHEET_CONFIG.ordersRange,
        [SPREADSHEET_CONFIG.columns],
        'USER_ENTERED'
      );
      console.log('Sheet initialized with headers');
    }
  } catch (error) {
    console.error('Error initializing Google Sheet:', error.message);
    // Let the process continue even if initialization fails
  }
}

/**
 * Process a Shopify order and add it to Google Sheets
 * @param {Object} options - Options object
 * @param {Object} options.order - Shopify order data
 * @param {Object} options.shopify - Shopify API client
 * @param {Object} options.env - Environment variables
 */
export async function process({ order, shopify, env }) {
  console.log(`Processing order: ${order.name || order.id || 'New Order'}`);

  try {
    // Override the spreadsheet ID from environment if provided
    if (env.GOOGLE_SHEET_ID) {
      SPREADSHEET_CONFIG.spreadsheetId = env.GOOGLE_SHEET_ID;
    }

    // Initialize the sheet with headers if needed
    await initializeSheetIfNeeded();

    // Format the order data for the sheet
    const orderRow = formatOrderForSheet(order);
    if (!orderRow.length) {
      console.error('Failed to format order data');
      return;
    }

    // Append the order data to the sheet
    const appendResult = await appendSheetData(
      cliDirname,
      SPREADSHEET_CONFIG.spreadsheetId,
      SPREADSHEET_CONFIG.ordersRange,
      [orderRow],
      'USER_ENTERED'
    );

    console.log(`Order added to Google Sheet at range: ${appendResult.updates?.updatedRange || 'unknown'}`);
    console.log('Process completed successfully');
  } catch (error) {
    console.error('Error processing order to Google Sheets:', error.message);
    throw error; // Rethrow to ensure webhook processing marks this as a failure
  }
}
