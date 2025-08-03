import GetProductById from "../../graphql/productGetById.js";
import * as GoogleSheets from "../../connectors/google-sheets";
import chalk from "chalk";
import { logToCli, logToWorker } from "../../utils/env.js";

// -----------------------------------------------------------------------------
// CONFIGURATION
// -----------------------------------------------------------------------------

// Define column mappings for the Google Sheet
const COLUMN_MAPPINGS = [
  { key: "id", label: "ID" },
  { key: "title", label: "Title" },
  { key: "vendor", label: "Vendor" },
  { key: "productType", label: "Product Type" },
  { key: "status", label: "Status" },
  { key: "tags", label: "Tags" },
  { key: "handle", label: "Handle" },
  { key: "updatedAt", label: "Updated At" },
  { key: "imageUrl", label: "Image URL" }
];

// -----------------------------------------------------------------------------
// UTILITY FUNCTIONS
// -----------------------------------------------------------------------------

/**
 * Format date as date and time string in Central Time Zone
 * @param {string} isoDate - ISO format date
 * @returns {string} Formatted date and time in Central Time Zone
 */
function formatDate(isoDate) {
  const date = new Date(isoDate);

  // Format date and time in Central Time Zone using Intl.DateTimeFormat
  // This is compatible with the Cloudflare Workers environment
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: 'America/Chicago'  // Central Time Zone
  }).format(date);
}

/**
 * Convert a column index to letter (0 = A, 1 = B, etc.)
 * @param {number} index - Zero-based column index
 * @returns {string} Column letter
 */
function columnIndexToLetter(index) {
  return String.fromCharCode(65 + index);
}

/**
 * Create a range string for a sheet operation
 * @param {string} sheetName - Name of the sheet
 * @param {number} startRow - 1-indexed start row
 * @param {number} endRow - 1-indexed end row
 * @param {number} columnCount - Number of columns
 * @returns {string} Range string (e.g., "Sheet1!A2:D5")
 */
function createRangeString(sheetName, startRow, endRow, columnCount) {
  const endColumn = columnIndexToLetter(columnCount - 1);
  return `${sheetName}!A${startRow}:${endColumn}${endRow}`;
}

// -----------------------------------------------------------------------------
// PRODUCT DATA EXTRACTION
// -----------------------------------------------------------------------------

/**
 * Extract and prepare product data for the Google Sheet
 * @param {Object} product - Shopify product data
 * @returns {Object} Structured product data
 */
function extractProductData(product) {
  // Get the first image URL if available
  let imageUrl = "";
  if (product.images?.edges?.length > 0 && product.images.edges[0]?.node?.url) {
    imageUrl = product.images.edges[0].node.url;
  }

  // Format tags as comma-separated string
  const tags = Array.isArray(product.tags) ? product.tags.join(", ") : product.tags || "";

  // Return structured product data
  return {
    id: product.legacyResourceId || "",
    title: product.title || "",
    vendor: product.vendor || "",
    productType: product.productType || "",
    status: product.status || "",
    tags: tags,
    handle: product.handle || "",
    updatedAt: formatDate(product.updatedAt || new Date()),
    imageUrl: imageUrl
  };
}

// -----------------------------------------------------------------------------
// SHEET DATA FORMATTING
// -----------------------------------------------------------------------------

/**
 * Create rows for Google Sheet from product data
 * @param {Object} productData - Structured product data
 * @param {Array} headers - Headers from the Google Sheet
 * @returns {Array} Array with a single row for the sheet
 */
function createSheetRows(productData, headers) {
  // Create a mapping from header labels to data keys
  const headerToKeyMap = {};
  COLUMN_MAPPINGS.forEach((mapping) => {
    headerToKeyMap[mapping.label] = mapping.key;
  });

  // Create a single row with the product data
  const row = mapDataToHeaders(productData, headers, headerToKeyMap);
  return [row];
}

/**
 * Map a data object to sheet headers
 * @param {Object} data - Data object
 * @param {Array} headers - Sheet headers
 * @param {Object} headerMap - Mapping from header labels to data keys
 * @returns {Array} Row values aligned with headers
 */
function mapDataToHeaders(data, headers, headerMap) {
  return headers.map((header) => {
    const dataKey = headerMap[header];
    if (!dataKey) {
      return ""; // Return empty string for unknown headers
    }
    return data[dataKey] || "";
  });
}

// -----------------------------------------------------------------------------
// SHEET OPERATIONS
// -----------------------------------------------------------------------------

/**
 * Find rows containing a specific product ID
 * @param {Array} sheetData - The full sheet data
 * @param {string} productId - Product ID to search for
 * @param {number} idColumnIndex - Index of the ID column
 * @returns {Object} Object with rowIndices array and rows data
 */
function findProductRowsByID(sheetData, productId, idColumnIndex) {
  const rowIndices = [];
  const rows = [];

  // Skip header row (index 0)
  for (let i = 1; i < sheetData.length; i++) {
    const row = sheetData[i];
    // Check if row exists and has an ID value that matches
    if (row && row[idColumnIndex] === productId) {
      rowIndices.push(i);
      rows.push(row);
    }
  }

  return { rowIndices, rows };
}

/**
 * Update existing product data in a sheet
 * @param {Object} sheetsClient - Google Sheets client
 * @param {string} spreadsheetId - Spreadsheet ID
 * @param {string} sheetName - Sheet name
 * @param {Array} newRows - New data rows
 * @param {Array} rowIndices - Indices of rows to update
 * @param {number} columnCount - Number of columns
 * @returns {Promise<Object>} Update result with rowsUpdated count
 */
async function updateProductRows(sheetsClient, spreadsheetId, sheetName, newRows, rowIndices, columnCount) {
  // If we have fewer new rows than existing rows, update what we can
  const rowsToUpdate = Math.min(newRows.length, rowIndices.length);

  // Determine start row (adding 1 because sheets are 1-indexed)
  const startRow = rowIndices[0] + 1;
  const endRow = startRow + rowsToUpdate - 1;

  // Create range based on rows to update
  const range = createRangeString(sheetName, startRow, endRow, columnCount);

  // Convert row arrays to objects based on header mapping
  const dataObjects = newRows.slice(0, rowsToUpdate).map(row => {
    const obj = {};
    sheetsClient._headers.forEach((header, index) => {
      // Find the key for this header
      const mapping = COLUMN_MAPPINGS.find(m => m.label === header);
      if (mapping) {
        obj[mapping.key] = row[index] || '';
      }
    });
    return obj;
  });

  // Update the rows
  const updateResult = await sheetsClient.writeRows(
    spreadsheetId,
    sheetName,
    dataObjects,
    "USER_ENTERED"
  );

  return { updateResult, rowsUpdated: rowsToUpdate };
}

/**
 * Append product rows to the sheet
 * @param {Object} sheetsClient - Google Sheets client
 * @param {string} spreadsheetId - Spreadsheet ID
 * @param {string} sheetName - Sheet name
 * @param {Array} rows - Data rows to append
 * @param {number} columnCount - Number of columns
 * @returns {Promise<Object>} Append result
 */
async function appendProductRows(sheetsClient, spreadsheetId, sheetName, rows, columnCount) {
  // Convert row arrays to objects based on header mapping
  const dataObjects = rows.map(row => {
    const obj = {};
    sheetsClient._headers.forEach((header, index) => {
      // Find the key for this header
      const mapping = COLUMN_MAPPINGS.find(m => m.label === header);
      if (mapping) {
        obj[mapping.key] = row[index] || '';
      }
    });
    return obj;
  });

  return await sheetsClient.appendRows(
    spreadsheetId,
    sheetName,
    dataObjects,
    "USER_ENTERED"
  );
}

// -----------------------------------------------------------------------------
// MAIN PROCESS FUNCTION
// -----------------------------------------------------------------------------

/**
 * Process a product update and save/update it in Google Sheets
 * @param {Object} options - Options object
 * @param {Object} options.payload - Shopify product data from webhook
 * @param {Object} options.shopify - Shopify API client
 * @param {Object} options.env - Environment variables
 * @param {Object} options.shopConfig - Shop-specific configuration
 * @param {Object} options.jobConfig - Job-specific configuration from config.json
 */
export async function process({ payload: productData, shopify, env, jobConfig, secrets }) {
  console.log("Product webhook payload received");
  logToWorker(env, "Webhook payload: " + JSON.stringify(productData));

  // Validate required data and configuration
  GoogleSheets.validateSheetCredentials(secrets);

  if (!productData.id) {
    throw new Error("No product ID provided in webhook data");
  }

  // Get spreadsheet ID from job config
  const spreadsheetId = jobConfig.spreadsheet_id;
  if (!spreadsheetId) {
    throw new Error("No spreadsheet ID provided in job config.json");
  }

  // Create Google Sheets client
  const sheetsClient = await GoogleSheets.createSheetsClient(secrets.GOOGLE_SHEETS_CREDENTIALS);

  // Get spreadsheet and sheet information using the standardized function
  const { sheetName, spreadsheetTitle } = await GoogleSheets.getFirstSheet(sheetsClient, spreadsheetId);

  console.log(chalk.blue(`Accessing spreadsheet: "${spreadsheetTitle}"`));
  console.log(`Using sheet: "${sheetName}"`);

  // Fetch complete product data from Shopify
  const product = await fetchProductData(shopify, productData.id);

  // Verify sheet headers and get header map
  const { headers, headerMap } = await GoogleSheets.validateSheetHeaders(
    sheetsClient,
    spreadsheetId,
    sheetName,
    COLUMN_MAPPINGS
  );

  // Extract and transform product data
  const productDetails = extractProductData(product);
  const newRows = createSheetRows(productDetails, headers);

  // Find any existing rows for this product
  const { existingRows, rowIndices, idColumnIndex } = await findExistingProductRows(
    sheetsClient,
    spreadsheetId,
    sheetName,
    productDetails.id,
    headers
  );

  // Update or append product data as appropriate
  await updateProductInSheet(
    sheetsClient,
    spreadsheetId,
    sheetName,
    null, // No longer using sheetId
    newRows,
    rowIndices,
    existingRows,
    headers.length,
    productDetails.id
  );

  logToCli(env, `Product ${productDetails.title} (ID: ${productDetails.id}) successfully processed`);
}

// -----------------------------------------------------------------------------
// PROCESS HELPER FUNCTIONS
// -----------------------------------------------------------------------------

/**
 * Fetch complete product data from Shopify
 * @param {Object} shopify - Shopify API client
 * @param {string} productId - Product ID
 * @returns {Promise<Object>} Complete product data
 */
async function fetchProductData(shopify, productId) {
  // Convert ID to GID format and fetch full product
  const gid = shopify.toGid(productId, "Product");
  const { product } = await shopify.graphql(GetProductById, { id: gid });

  if (!product) {
    throw new Error(`Product with ID ${productId} not found`);
  }

  return product;
}

/**
 * Find existing product rows in a sheet
 * @param {Object} sheetsClient - Google Sheets client
 * @param {string} spreadsheetId - Spreadsheet ID
 * @param {string} sheetName - Sheet name
 * @param {string} productId - Product ID to find
 * @param {Array} headers - Sheet headers
 * @returns {Promise<Object>} Object with rowIndices, rows, and idColumnIndex
 */
async function findExistingProductRows(sheetsClient, spreadsheetId, sheetName, productId, headers) {
  // Initialize headers if needed
  if (!sheetsClient._headers) {
    await sheetsClient.initializeHeaders(spreadsheetId, sheetName, COLUMN_MAPPINGS);
  }

  // Find the ID column index in the header row
  const idColumnIndex = sheetsClient._headerMap.id;

  if (idColumnIndex === undefined) {
    throw new Error("ID column not found in sheet headers");
  }

  // Read all rows as objects
  const rowObjects = await sheetsClient.readRows(spreadsheetId, sheetName);

  // Convert objects back to arrays for compatibility with existing code
  const sheetData = [headers];  // Start with headers as first row
  rowObjects.forEach(rowObj => {
    const row = headers.map(header => {
      const mapping = COLUMN_MAPPINGS.find(m => m.label === header);
      return mapping ? rowObj[mapping.key] || "" : "";
    });
    sheetData.push(row);
  });

  // Find rows with matching product ID
  return { ...findProductRowsByID(sheetData, productId, idColumnIndex), idColumnIndex };
}

/**
 * Update or append product data in the sheet
 * @param {Object} sheetsClient - Google Sheets client
 * @param {string} spreadsheetId - Spreadsheet ID
 * @param {string} sheetName - Sheet name
 * @param {string} sheetId - Sheet ID (unused)
 * @param {Array} newRows - New rows to write
 * @param {Array} rowIndices - Indices of existing rows
 * @param {Array} existingRows - Existing row data
 * @param {number} columnCount - Number of columns
 * @param {string} productId - Product ID
 * @returns {Promise<void>}
 */
async function updateProductInSheet(
  sheetsClient,
  spreadsheetId,
  sheetName,
  sheetId, // This parameter is kept for backwards compatibility but no longer used
  newRows,
  rowIndices,
  existingRows,
  columnCount,
  productId
) {
  if (rowIndices.length > 0) {
    // Product exists, update its row
    console.log(`Updating existing product with ID ${productId} at row: ${rowIndices[0] + 1}`);

    // Update the first existing row
    const { updateResult, rowsUpdated } = await updateProductRows(
      sheetsClient,
      spreadsheetId,
      sheetName,
      [newRows[0]], // Only use the first row
      [rowIndices[0]], // Only update the first row found
      columnCount
    );

    console.log(`Updated row for product ${productId}`);

    // If there are more rows for this product, log that they should be deleted
    if (rowIndices.length > 1) {
      const excessRowIndices = rowIndices.slice(1);
      console.log(`Note: ${excessRowIndices.length} excess rows detected at indices: ${excessRowIndices.map(i => i + 1).join(', ')}`);
      console.log("These would need to be deleted manually or through an extended API implementation");
    }
  } else {
    // Product doesn't exist, append new row
    console.log(`Creating new entry for product ${productId}`);

    await appendProductRows(
      sheetsClient,
      spreadsheetId,
      sheetName,
      newRows, // This is already a single row array
      columnCount
    );

    console.log(`Added new row for product ${productId}`);
  }
}
