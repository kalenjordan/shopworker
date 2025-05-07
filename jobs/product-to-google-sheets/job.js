import GetProductById from "../../graphql/GetProductById.js";
import * as GoogleSheets from "../../connectors/google-sheets.js";
import chalk from "chalk";

// Define column mappings
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
    const row = headers.map((header) => {
      const dataKey = headerToKeyMap[header];
      if (!dataKey) {
        return ""; // Return empty string for unknown headers
      }
      const value = productData[dataKey] || "";
      return value;
    });
    return [row];
  }

  // Otherwise, create a row for each variant
  return variants.map((variant) => {
    // Create a merged data object with product data and variant data
    const rowData = {
      ...productData,
      ...variant
    };

    // Map the data to columns based on the headers
    return headers.map((header) => {
      const dataKey = headerToKeyMap[header];
      if (!dataKey) {
        return ""; // Return empty string for unknown headers
      }
      const value = rowData[dataKey] || "";
      return value;
    });
  });
}

/**
 * Initialize sheet with headers if needed
 * @param {Object} sheetsClient - Google Sheets client
 * @param {string} spreadsheetId - Google Sheets spreadsheet ID
 * @param {string} sheetName - Google Sheets sheet name
 * @returns {Array} Array of headers
 */
async function initializeSheetHeaders(sheetsClient, spreadsheetId, sheetName) {
  try {
    // Try to get existing headers
    const headerData = await GoogleSheets.getSheetData(sheetsClient, spreadsheetId, `${sheetName}!A1:Z1`);

    // If headers exist, return them
    if (headerData?.length && headerData[0]?.length) {
      return headerData[0];
    }

    // Otherwise, initialize the sheet with our headers
    const headers = COLUMN_MAPPINGS.map(column => column.label);
    await GoogleSheets.writeSheetData(sheetsClient, spreadsheetId, `${sheetName}!A1:${String.fromCharCode(65 + headers.length - 1)}1`, [headers], "RAW");

    console.log("Initialized sheet with headers:", headers.join(", "));
    return headers;
  } catch (error) {
    console.error("Error initializing sheet headers:", error);
    throw error;
  }
}

/**
 * Process a product update and add it to Google Sheets
 * @param {Object} options - Options object
 * @param {Object} options.record - Shopify product data from webhook
 * @param {Object} options.shopify - Shopify API client
 * @param {Object} options.env - Environment variables
 */
export async function process({ record: productData, shopify, env }) {
  console.log("Product webhook payload: ", productData);

  // Validate required environment variables
  if (!env.google_sheets_credentials) {
    throw new Error("Missing required env.google_sheets_credentials configuration");
  }
  if (!productData.id) {
    throw new Error("No product ID provided");
  }

  // Use the provided Google Sheet ID
  const spreadsheetId = "1VD-OtBr0l_V2Hoz7qSRsOqsbaC1Fima2Kn9q6gYvhY4";

  // Create Google Sheets client
  const sheetsClient = await GoogleSheets.createSheetsClient(env.google_sheets_credentials);

  // Get spreadsheet title and available sheets
  const spreadsheetTitle = await GoogleSheets.getSpreadsheetTitle(sheetsClient, spreadsheetId);
  console.log(chalk.blue(`Spreadsheet title: "${spreadsheetTitle}"`));

  const sheets = await GoogleSheets.getSheets(sheetsClient, spreadsheetId);
  console.log("Available sheets in spreadsheet:");
  sheets.forEach((sheet) => {
    console.log(`- ${sheet.title} (sheetId: ${sheet.sheetId}, index: ${sheet.index})`);
  });

  // Use the first sheet
  if (sheets.length === 0) {
    throw new Error(`No sheets found in spreadsheet "${spreadsheetTitle}"`);
  }

  const sheetName = sheets[0].title;
  console.log(`Using sheet: "${sheetName}" from spreadsheet "${spreadsheetTitle}"`);

  // Convert ID to GID format and fetch full product
  const productId = shopify.toGid(productData.id, "Product");
  const { product } = await shopify.graphql(GetProductById, { id: productId });

  // Initialize or get sheet headers
  const headers = await initializeSheetHeaders(sheetsClient, spreadsheetId, sheetName);

  // Extract data from the product
  const productDetails = extractProductData(product);
  const variants = extractVariants(product);

  // Log the data
  console.log("Product details: ", {
    product: JSON.stringify(productDetails, null, 2),
    variants: JSON.stringify(variants, null, 2)
  });

  // Validate we have product data
  if (!productDetails.id) {
    throw new Error("No product details found");
  }

  // Create rows for Google Sheets
  const rows = createSheetRows(productDetails, variants, headers);

  // Append data to Google Sheets
  const result = await GoogleSheets.appendSheetData(
    sheetsClient,
    spreadsheetId,
    `${sheetName}!A:${String.fromCharCode(65 + headers.length - 1)}`,
    rows,
    "USER_ENTERED" // Use USER_ENTERED to handle formatting correctly
  );

  console.log(`Successfully added ${rows.length} rows to Google Sheet`);
  console.log(`Updated range: ${result.updates?.updatedRange}`);
}
