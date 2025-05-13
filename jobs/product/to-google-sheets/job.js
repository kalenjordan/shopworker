import GetProductById from "../../../graphql/GetProductById.js";
import * as GoogleSheets from "../../../connectors/google-sheets.js";
import chalk from "chalk";
import { logToCli, logToWorker } from "../../../utils/log.js";

// -----------------------------------------------------------------------------
// CONFIGURATION
// -----------------------------------------------------------------------------

// Define column mappings for the Google Sheet
const COLUMN_MAPPINGS = [
  { key: "id", label: "ID" },
  { key: "title", label: "Title" },
  { key: "vendor", label: "Vendor" },
  { key: "productType", label: "Product Type" },
  { key: "sku", label: "SKU" },
  { key: "price", label: "Price" },
  { key: "inventoryQuantity", label: "Inventory" },
  { key: "status", label: "Status" },
  { key: "tags", label: "Tags" },
  { key: "handle", label: "Handle" },
  { key: "updatedAt", label: "Updated At" },
  { key: "imageUrl", label: "Image URL" },
  { key: "variantTitle", label: "Variant Title" }
];

// -----------------------------------------------------------------------------
// UTILITY FUNCTIONS
// -----------------------------------------------------------------------------

/**
 * Format date as YYYY-MM-DD
 * @param {string} isoDate - ISO format date
 * @returns {string} Formatted date
 */
function formatDate(isoDate) {
  const date = new Date(isoDate);
  return date.toISOString().split("T")[0]; // Returns YYYY-MM-DD
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
 * @returns {Object} Structured product data (without variants)
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

/**
 * Extract variants from product
 * @param {Object} product - Shopify product data
 * @returns {Array} Array of variant objects
 */
function extractVariants(product) {
  const variants = [];

  if (product.variants?.edges) {
    product.variants.edges.forEach((edge) => {
      if (edge.node) {
        variants.push({
          sku: edge.node.sku || "",
          price: edge.node.price || "",
          inventoryQuantity: edge.node.inventoryQuantity || 0,
          variantTitle: edge.node.title || ""
        });
      }
    });
  }

  return variants;
}

// -----------------------------------------------------------------------------
// SHEET DATA FORMATTING
// -----------------------------------------------------------------------------

/**
 * Create rows for Google Sheet from product data and variants
 * @param {Object} productData - Structured product data
 * @param {Array} variants - Array of variants
 * @param {Array} headers - Headers from the Google Sheet
 * @returns {Array} Array of rows for the sheet (one per variant)
 */
function createSheetRows(productData, variants, headers) {
  // Create a mapping from header labels to data keys
  const headerToKeyMap = {};
  COLUMN_MAPPINGS.forEach((mapping) => {
    headerToKeyMap[mapping.label] = mapping.key;
  });

  // If there are no variants, return a single row with the product data
  if (variants.length === 0) {
    const row = mapDataToHeaders(productData, headers, headerToKeyMap);
    return [row];
  }

  // Otherwise, create a row for each variant
  return variants.map((variant) => {
    // Create a merged data object with product data and variant data
    const rowData = { ...productData, ...variant };
    return mapDataToHeaders(rowData, headers, headerToKeyMap);
  });
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

  // Update the rows
  const updateResult = await GoogleSheets.writeSheetData(
    sheetsClient,
    spreadsheetId,
    range,
    newRows.slice(0, rowsToUpdate),
    "USER_ENTERED"
  );

  return { updateResult, rowsUpdated: rowsToUpdate };
}

/**
 * Log information about excess rows that should be deleted
 * @param {Array} rowIndices - Indices of all product rows
 * @param {number} rowsUpdated - Number of rows that were updated
 */
function logExcessRows(rowIndices, rowsUpdated) {
  // If all rows were updated, no excess rows to delete
  if (rowIndices.length <= rowsUpdated) {
    return;
  }

  // Get the indices of rows that should be deleted (those that weren't updated)
  const rowsToDelete = rowIndices.slice(rowsUpdated);

  // For now, just log this - actual deletion requires batch update API
  console.log(`Note: ${rowsToDelete.length} excess rows detected at indices: ${rowsToDelete.map(i => i + 1).join(', ')}`);
  console.log("These would need to be deleted manually or through an extended API implementation");
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
  const range = `${sheetName}!A:${columnIndexToLetter(columnCount - 1)}`;

  const result = await GoogleSheets.appendSheetData(
    sheetsClient,
    spreadsheetId,
    range,
    rows,
    "USER_ENTERED"
  );

  return result;
}

// -----------------------------------------------------------------------------
// MAIN PROCESS FUNCTION
// -----------------------------------------------------------------------------

/**
 * Process a product update and save/update it in Google Sheets
 * @param {Object} options - Options object
 * @param {Object} options.record - Shopify product data from webhook
 * @param {Object} options.shopify - Shopify API client
 * @param {Object} options.env - Environment variables
 * @param {Object} options.shopConfig - Shop-specific configuration
 * @param {Object} options.jobConfig - Job-specific configuration from config.json
 */
export async function process({ record: productData, shopify, env, shopConfig, jobConfig }) {
  console.log("Product webhook payload received");
  logToWorker(env, "Webhook payload: " + JSON.stringify(productData));

  try {
    // Validate required data and configuration
    GoogleSheets.validateSheetCredentials(shopConfig);

    if (!productData.id) {
      throw new Error("No product ID provided in webhook data");
    }

    // Get spreadsheet ID from job config
    const spreadsheetId = jobConfig.spreadsheet_id;
    if (!spreadsheetId) {
      throw new Error("No spreadsheet ID provided in job config.json");
    }

    // Create Google Sheets client
    const sheetsClient = await GoogleSheets.createSheetsClient(shopConfig.google_sheets_credentials);

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
    const variants = extractVariants(product);
    const newRows = createSheetRows(productDetails, variants, headers);

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
  } catch (error) {
    console.error(`Error processing product data: ${error.message}`);
    throw error;
  }
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
 * Find existing rows for a product
 * @param {Object} sheetsClient - Google Sheets client
 * @param {string} spreadsheetId - Spreadsheet ID
 * @param {string} sheetName - Sheet name
 * @param {string} productId - Product ID to find
 * @param {Array} headers - Sheet headers
 * @returns {Promise<Object>} Existing rows information
 */
async function findExistingProductRows(sheetsClient, spreadsheetId, sheetName, productId, headers) {
  // Find ID column index
  const idColumnIndex = headers.findIndex(header => header === "ID");
  if (idColumnIndex === -1) {
    throw new Error("ID column not found in sheet headers");
  }

  // Get all existing data from the sheet
  const fullRange = createRangeString(sheetName, 1, 1000, headers.length); // Fetch up to 1000 rows
  const sheetData = await GoogleSheets.getSheetData(sheetsClient, spreadsheetId, fullRange);

  // Find rows that match this product ID
  const { rowIndices, rows: existingRows } = findProductRowsByID(sheetData, productId, idColumnIndex);

  return { existingRows, rowIndices, idColumnIndex };
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
    // Product exists, update its rows
    console.log(`Updating existing product with ID ${productId} at rows: ${rowIndices.map(i => i + 1).join(', ')}`);

    // Update existing rows
    const { updateResult, rowsUpdated } = await updateProductRows(
      sheetsClient,
      spreadsheetId,
      sheetName,
      newRows,
      rowIndices,
      columnCount
    );

    console.log(`Updated ${rowsUpdated} rows for product ${productId}`);

    // Log information about rows that should be deleted (if product now has fewer variants)
    if (existingRows.length > newRows.length) {
      logExcessRows(rowIndices, rowsUpdated);
    }

    // Handle case where product now has more variants than before
    if (newRows.length > existingRows.length) {
      const additionalRows = newRows.slice(existingRows.length);
      await appendProductRows(
        sheetsClient,
        spreadsheetId,
        sheetName,
        additionalRows,
        columnCount
      );

      console.log(`Appended ${additionalRows.length} additional variant rows for product ${productId}`);
    }
  } else {
    // Product doesn't exist, append new rows
    console.log(`Creating new entries for product ${productId}`);

    await appendProductRows(
      sheetsClient,
      spreadsheetId,
      sheetName,
      newRows,
      columnCount
    );

    console.log(`Added ${newRows.length} new rows for product ${productId}`);
  }
}
