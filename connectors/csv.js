/**
 * CSV generation and manipulation connector
 * Compatible with Cloudflare Workers environment
 */

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
