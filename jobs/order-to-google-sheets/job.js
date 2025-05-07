import { google } from 'googleapis';

// Config for the Google Sheet
const SPREADSHEET_CONFIG = {
  // Will be set from env.google_sheet_id in process method
  spreadsheetId: '',
  // The sheet name where orders will be added
  sheetName: 'Blad1',
  // Columns for the sheet
  columns: [
    'Date',
    'Order Number',
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

  // Create the row with just Date and Order Number as per the updated columns
  return [
    formatDate(order.createdAt || new Date()),    // Date
    order.id || order.name || '',                 // Order Number
  ];
}

/**
 * Initialize the Google Sheets API client
 * @returns {Promise<Object>} Google Sheets API client
 */
async function initializeGoogleSheetsClient(env) {
  const sheets = google.sheets('v4');

  const auth = new google.auth.GoogleAuth({
    credentials: env.google_sheets_credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const client = await auth.getClient();
  return { sheets, client };
}

/**
 * Check if sheet has headers and initialize if needed
 * @param {Object} sheetsClient - Google Sheets API client
 * @param {string} spreadsheetId - Google Sheet ID
 * @returns {Promise<void>}
 */
async function initializeSheetIfNeeded(sheetsClient, spreadsheetId) {
  try {
    const { sheets, client } = sheetsClient;

    // Check if the sheet has data already
    const response = await sheets.spreadsheets.values.get({
      auth: client,
      spreadsheetId,
      range: `${SPREADSHEET_CONFIG.sheetName}!A1:Z1`,
    });

    // If no data or no headers, add headers
    if (!response.data.values || response.data.values.length === 0) {
      console.log('Initializing Google Sheet with headers...');

      await sheets.spreadsheets.values.append({
        auth: client,
        spreadsheetId,
        range: `${SPREADSHEET_CONFIG.sheetName}!A1`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [SPREADSHEET_CONFIG.columns]
        }
      });

      console.log('Sheet initialized with headers');
    }
  } catch (error) {
    console.error('Error initializing Google Sheet:', error.message);
    // Let the process continue even if initialization fails
  }
}

/**
 * Append order data to Google Sheet
 * @param {Object} sheetsClient - Google Sheets API client
 * @param {string} spreadsheetId - Google Sheet ID
 * @param {Array} values - Row data to append
 * @returns {Promise<Object>} Append result
 */
async function appendDataToSheet(sheetsClient, spreadsheetId, values) {
  const { sheets, client } = sheetsClient;

  // The append method automatically adds data to the next empty row
  const result = await sheets.spreadsheets.values.append({
    auth: client,
    spreadsheetId,
    range: `${SPREADSHEET_CONFIG.sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS', // Ensures data is inserted at the bottom
    resource: {
      values: [values]
    }
  });

  return result;
}

/**
 * Process a Shopify order and add it to Google Sheets
 * @param {Object} options - Options object
 * @param {Object} options.record - Shopify order data
 * @param {Object} options.shopify - Shopify API client
 * @param {Object} options.env - Environment variables
 */
export async function process({ record: order, shopify, env }) {
  console.log(`Processing order: ${order.name || order.id || 'New Order'}`);

  try {
    // Set the spreadsheet ID from environment
    if (env.google_sheet_id) {
      SPREADSHEET_CONFIG.spreadsheetId = env.google_sheet_id;
    } else {
      throw new Error('Missing required env.google_sheet_id configuration');
    }

    // Initialize Google Sheets client
    const sheetsClient = await initializeGoogleSheetsClient(env);

    // Initialize the sheet with headers if needed
    await initializeSheetIfNeeded(sheetsClient, SPREADSHEET_CONFIG.spreadsheetId);

    // Read data from the sheet for testing
    console.log("Reading current data from Google Sheet...");
    const { sheets, client } = sheetsClient;

    const response = await sheets.spreadsheets.values.get({
      auth: client,
      spreadsheetId: SPREADSHEET_CONFIG.spreadsheetId,
      range: `${SPREADSHEET_CONFIG.sheetName}!A:Z`, // Read all data in the sheet
    });

    console.log("Existing sheet data:");
    console.log(JSON.stringify(response.data.values, null, 2));

    // Format the order data for the sheet
    const orderRow = formatOrderForSheet(order);
    if (!orderRow.length) {
      console.error('Failed to format order data');
      return;
    }

    console.log("Adding order data to sheet:", JSON.stringify(orderRow, null, 2));

    // Append the order data to the sheet
    const appendResult = await appendDataToSheet(
      sheetsClient,
      SPREADSHEET_CONFIG.spreadsheetId,
      orderRow
    );

    console.log(`Order added to Google Sheet at range: ${appendResult.data.updates?.updatedRange || 'unknown'}`);
    console.log('Process completed successfully');
  } catch (error) {
    console.error('Error processing order to Google Sheets:', error.message);
    throw error; // Rethrow to ensure webhook processing marks this as a failure
  }
}
