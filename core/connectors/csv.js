/**
 * CSV generation and manipulation connector
 * Compatible with Cloudflare Workers environment
 */

import { isCliEnvironment } from '../shared/env.js';
import Papa from 'papaparse';

/**
 * Parse CSV content into structured data
 * @param {string} csvContent - Raw CSV content string
 * @param {Object} options - Parsing options
 * @param {string} [options.delimiter] - Field delimiter (default: ',')
 * @param {boolean} [options.hasHeaders] - Whether first row contains headers (default: true)
 * @returns {Object} Parsed CSV data with headers and rows
 */
export function parseCSV(csvContent, options = {}) {
  const { delimiter = ',', hasHeaders = true } = options;

  if (typeof csvContent !== 'string') {
    throw new Error('CSV content must be a string');
  }

  // Use PapaParse for robust CSV parsing
  const parseResult = Papa.parse(csvContent, {
    header: hasHeaders,       // First row contains headers
    skipEmptyLines: true,     // Skip empty lines
    trim: true,              // Trim whitespace from fields
    dynamicTyping: false,     // Keep everything as strings for consistency
    delimiter: delimiter,     // Use specified delimiter
  });

  if (parseResult.errors && parseResult.errors.length > 0) {
    // Log parsing errors but don't throw unless they're critical
    const criticalErrors = parseResult.errors.filter(error => error.type === 'Delimiter');
    if (criticalErrors.length > 0) {
      throw new Error(`Critical CSV parsing errors: ${criticalErrors.map(e => e.message).join(', ')}`);
    }
  }

  const headers = parseResult.meta.fields || [];
  const parsedRows = parseResult.data.map((row, index) => ({
    ...row,
    _rowNumber: index + 2 // Account for header row
  }));

  // Create column indices map for backward compatibility
  const columnIndices = headers.reduce((acc, header, index) => {
    acc[header] = index;
    return acc;
  }, {});

  return {
    headers,
    rows: parsedRows,
    columnIndices
  };
}



/**
 * Group parsed CSV rows by a specific column
 * @param {Array} rows - Array of parsed row objects from parseCSV
 * @param {string} columnName - Name of the column to group by
 * @returns {Object} Object with column values as keys and arrays of rows as values
 */
export function groupRowsByColumn(rows, columnName) {
  const grouped = {};

  rows.forEach(row => {
    const groupKey = row[columnName];

    if (!groupKey) {
      console.log(`Warning: Row ${row._rowNumber} has empty or missing value for column "${columnName}"`);
      return;
    }

    if (!grouped[groupKey]) {
      grouped[groupKey] = [];
    }

    grouped[groupKey].push(row);
  });

  return grouped;
}

/**
 * Find column index by name (case-insensitive)
 * @param {Array} headers - Array of header names
 * @param {string} columnName - Name of column to find
 * @returns {number} Index of column, or -1 if not found
 */
export function findColumnIndex(headers, columnName) {
  const lowerColumnName = columnName.toLowerCase();
  return headers.findIndex(header =>
    header.toLowerCase() === lowerColumnName
  );
}

/**
 * Generate CSV content from data array
 * @param {Array} data - Array of objects or arrays representing rows
 * @param {Object} options - CSV generation options
 * @param {Array} [options.headers] - Array of header strings
 * @param {Function} [options.rowMapper] - Function to transform each data item to array of values
 * @param {string} [options.delimiter] - Field delimiter (default: ',')
 * @param {string} [options.lineEnding] - Line ending (default: '\n')
 * @returns {string} CSV content as string
 */
export function generateCSV(data, options = {}) {
  const {
    headers = null,
    rowMapper = null,
    delimiter = ',',
    lineEnding = '\n'
  } = options;

  if (!Array.isArray(data)) {
    throw new Error('Data must be an array');
  }

  const rows = [];

  // Add headers if provided
  if (headers && Array.isArray(headers)) {
    rows.push(headers.map(header => escapeCSVField(header, delimiter)));
  }

  // Process data rows
  const processedRows = data.map(item => {
    let rowData;

    if (rowMapper && typeof rowMapper === 'function') {
      rowData = rowMapper(item);
    } else if (Array.isArray(item)) {
      rowData = item;
    } else if (typeof item === 'object' && item !== null) {
      // If no rowMapper provided and item is object, use values in order
      rowData = Object.values(item);
    } else {
      rowData = [item];
    }

    if (!Array.isArray(rowData)) {
      throw new Error('Row mapper must return an array, or data items must be arrays');
    }

    return rowData.map(field => escapeCSVField(field, delimiter));
  });

  rows.push(...processedRows);

  return rows.map(row => row.join(delimiter)).join(lineEnding);
}

/**
 * Escape CSV field by wrapping in quotes and escaping internal quotes
 * @param {any} field - Field value to escape
 * @param {string} delimiter - Field delimiter to check for
 * @returns {string} Escaped CSV field
 */
export function escapeCSVField(field, delimiter = ',') {
  const stringField = String(field);

  // If field contains delimiter, quote, or newline, wrap in quotes and escape internal quotes
  if (stringField.includes(delimiter) || stringField.includes('"') || stringField.includes('\n') || stringField.includes('\r')) {
    return `"${stringField.replace(/"/g, '""')}"`;
  }

  return stringField;
}

/**
 * Convert CSV content to base64 for email attachments
 * @param {string} csvContent - CSV content string
 * @returns {string} Base64 encoded CSV content
 */
export function toBase64(csvContent) {
  if (typeof csvContent !== 'string') {
    throw new Error('CSV content must be a string');
  }

  // Use btoa with proper encoding for UTF-8 characters
  return btoa(unescape(encodeURIComponent(csvContent)));
}

/**
 * Create a CSV attachment object for email
 * @param {string} csvContent - CSV content string
 * @param {Object} options - Attachment options
 * @param {string} [options.filename] - Filename for the attachment
 * @param {string} [options.contentType] - MIME type (default: 'text/csv')
 * @returns {Object} Email attachment object
 */
export function createAttachment(csvContent, options = {}) {
  const {
    filename = `export-${new Date().toISOString().split('T')[0]}.csv`,
    contentType = 'text/csv'
  } = options;

  return {
    filename,
    content: toBase64(csvContent),
    contentType
  };
}

/**
 * Utility function to join array values with separator
 * @param {Array|any} value - Value to join (if array) or convert to string
 * @param {string} separator - Separator for joining (default: ', ')
 * @returns {string} Joined string
 */
export function joinArray(value, separator = ', ') {
  if (Array.isArray(value)) {
    return value.join(separator);
  }
  return String(value || '');
}

/**
 * Save file content to appropriate storage based on environment
 * @param {string} content - File content to save
 * @param {Object} options - Save options
 * @param {string} options.filename - Filename to save as
 * @param {string} [options.contentType] - MIME type for R2 storage
 * @param {Object} [options.metadata] - Custom metadata for R2 storage
 * @param {Object} env - Environment object (should contain R2_BUCKET for worker env)
 * @returns {Promise<void>}
 */
export async function saveFile(content, options, env) {
  const { filename, contentType = 'text/plain', metadata = {} } = options;

  // Use environment detection utility to determine if we're in worker environment
  const isWorkerEnv = !isCliEnvironment(env);

  if (isWorkerEnv) {
    // Worker environment - save to R2 in csv-imports directory
    const r2Path = `csv-imports/${filename}`;
    console.log(`Saving file to R2 bucket: ${r2Path}`);
    try {
      await env.R2_BUCKET.put(r2Path, content, {
        httpMetadata: {
          contentType,
        },
        customMetadata: {
          timestamp: new Date().toISOString(),
          ...metadata
        }
      });
    } catch (error) {
      console.error(`✗ Failed to save file to R2: ${error.message}`);
      throw error;
    }
  } else {
    // CLI environment - dynamically import Node.js modules and save to Desktop
    console.log(`Saving file to Desktop: ${filename}`);
    try {
      const { default: fs } = await import('fs');
      const { default: path } = await import('path');
      const { default: os } = await import('os');

      const desktopPath = path.join(os.homedir(), 'Desktop', filename);
      fs.writeFileSync(desktopPath, content, 'utf8');
    } catch (error) {
      console.error(`✗ Failed to save file to Desktop: ${error.message}`);
      throw error;
    }
  }
}
