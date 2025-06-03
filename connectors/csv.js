/**
 * CSV generation and manipulation connector
 * Compatible with Cloudflare Workers environment
 */

/**
 * Parse CSV content into structured data
 * @param {string} csvContent - Raw CSV content string
 * @param {Object} options - Parsing options
 * @param {string} [options.delimiter] - Field delimiter (default: ',')
 * @returns {Object} Parsed CSV data with headers and rows
 */
export function parseCSV(csvContent, options = {}) {
  const { delimiter = ',' } = options;

  if (typeof csvContent !== 'string') {
    throw new Error('CSV content must be a string');
  }

  // Split into rows and filter out empty ones
  const rows = csvContent.split('\n').filter(row => row.trim() !== '');

  if (rows.length === 0) {
    return { headers: [], rows: [], columnIndices: {} };
  }

  // Parse headers from first row
  const headers = parseCSVRow(rows[0], delimiter);
  const dataRows = rows.slice(1);

  // Create column indices map for easy lookup
  const columnIndices = headers.reduce((acc, header, index) => {
    acc[header] = index;
    return acc;
  }, {});

  // Parse data rows
  const parsedRows = dataRows.map((row, index) => {
    const columns = parseCSVRow(row, delimiter);
    const rowObject = {
      _rowNumber: index + 2 // Account for header row
    };

    // Create an object with header keys
    headers.forEach((header, headerIndex) => {
      rowObject[header] = columns[headerIndex] || '';
    });

    return rowObject;
  });

  return {
    headers,
    rows: parsedRows,
    columnIndices
  };
}

/**
 * Parse a single CSV row, handling quoted fields properly
 * @param {string} row - Single CSV row string
 * @param {string} delimiter - Field delimiter
 * @returns {Array} Array of field values
 */
export function parseCSVRow(row, delimiter = ',') {
  const result = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < row.length) {
    const char = row[i];

    if (char === '"') {
      if (inQuotes && row[i + 1] === '"') {
        // Handle escaped quotes
        current += '"';
        i += 2;
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
        i++;
      }
    } else if (char === delimiter && !inQuotes) {
      // End of field
      result.push(current.trim());
      current = '';
      i++;
    } else {
      current += char;
      i++;
    }
  }

  // Add the last field
  result.push(current.trim());

  return result;
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
