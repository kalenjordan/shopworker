import { SignJWT } from 'jose/jwt/sign';
import { importJWK } from 'jose/key/import';

const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Validate that Google Sheets credentials exist in the shop configuration or secrets
 * @param {Object} shopConfig - Shop configuration object
 * @param {Object} [secrets] - Optional secrets object
 * @throws {Error} If Google Sheets credentials are missing
 */
export function validateSheetCredentials(secrets) {
  if (!secrets || !secrets.GOOGLE_SHEETS_CREDENTIALS) {
    throw new Error("Missing required Google Sheets credentials. Expected in secrets.GOOGLE_SHEETS_CREDENTIALS");
  }
}

/**
 * Create an authenticated Google Sheets client credentials object
 * @param {Object} credentials - Google Sheets credentials JSON object
 * @returns {Object} Enhanced client object with the following methods:
 *   - getToken() - Gets the access token for API calls
 *   - fetchFromSheets(endpoint, options) - Makes authenticated requests to the Sheets API
 *   - initializeHeaders(spreadsheetId, sheetName, expectedMappings) - Initializes and stores headers and mapping
 *   - appendRows(spreadsheetId, sheetName, dataObjects, valueInputOption) - Appends data objects to the sheet
 *   - writeRows(spreadsheetId, sheetName, dataObjects, valueInputOption) - Writes data objects to the sheet, replacing existing content
 *   - readRows(spreadsheetId, sheetName, range) - Reads data from the sheet and transforms it to objects
 */
export async function createSheetsClient(credentials) {
  if (typeof credentials === 'string') {
    console.error('Error: Expected credentials object but received string');
    throw new Error('Google Sheets credentials must be an object, not a string');
  }

  async function getAccessToken() {
    try {
      const now = Math.floor(Date.now() / 1000);

      // Check if we have a JWK in the credentials
      if (!credentials.private_key_jwk) {
        throw new Error('Missing private_key_jwk in credentials. Please convert your private_key to JWK format.');
      }

      // Import the JWK
      const privateKey = await importJWK(credentials.private_key_jwk, 'RS256');

      const jwt = await new SignJWT({ scope: GOOGLE_SHEETS_SCOPE })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt(now)
        .setIssuer(credentials.client_email)
        .setSubject(credentials.client_email)
        .setAudience(TOKEN_URL)
        .setExpirationTime('1h')
        .sign(privateKey);

      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: jwt,
        }),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const json = await res.json();
      if (!json.access_token) {
        console.error('Failed to get access token:', json);
        throw new Error(`Failed to get access token: ${JSON.stringify(json)}`);
      }
      return json.access_token;
    } catch (error) {
      console.error('Error getting Google Sheets access token:', error);
      throw error;
    }
  }

  // Return client with enhanced interface
  return {
    _accessToken: null,
    _headers: null,
    _headerMap: null,

    async getToken() {
      if (!this._accessToken) {
        this._accessToken = await getAccessToken();
      }
      return this._accessToken;
    },

    /**
     * Make an authenticated request to the Google Sheets API
     * @param {string} endpoint - The API endpoint to call (after https://sheets.googleapis.com/v4/)
     * @param {Object} options - Fetch options (method, headers, body)
     * @returns {Promise<Object>} The API response as JSON
     */
    async fetchFromSheets(endpoint, options = {}) {
      const accessToken = await this.getToken();
      const url = `https://sheets.googleapis.com/v4/${endpoint}`;

      const fetchOptions = {
        ...options,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      };

      const response = await fetch(url, fetchOptions);
      return response.json();
    },

    // Initialize headers and store them in the client
    async initializeHeaders(spreadsheetId, sheetName, expectedMappings) {
      const result = await validateSheetHeaders(this, spreadsheetId, sheetName, expectedMappings);
      this._headers = result.headers;
      this._headerMap = result.headerMap;
      return result;
    },

    /**
     * Append data objects to a Google Sheet
     * @param {string} spreadsheetId - The ID of the spreadsheet
     * @param {string} sheetName - The name of the sheet
     * @param {Array<Object>} dataObjects - Array of objects to append
     * @param {string} valueInputOption - How to interpret the data:
     *   - "RAW": The values will be stored as-is without any interpretation
     *   - "USER_ENTERED": The values will be interpreted as if entered by a user (formulas will be interpreted)
     * @returns {Promise<Object>} Result of the append operation
     */
    async appendRows(spreadsheetId, sheetName, dataObjects, valueInputOption = "RAW") {
      if (!this._headers || !this._headerMap) {
        throw new Error("Headers not initialized. Call initializeHeaders first.");
      }

      // Transform data objects into sheet rows based on header mapping
      const rows = dataObjects.map(dataObject => {
        const row = new Array(this._headers.length).fill("");

        for (const key in this._headerMap) {
          const columnIndex = this._headerMap[key];
          const value = dataObject[key] !== undefined ? dataObject[key] : "";
          row[columnIndex] = value;
        }

        return row;
      });

      // Append to the sheet using the common fetchFromSheets method
      return this.fetchFromSheets(
        `spreadsheets/${spreadsheetId}/values/${sheetName}!A1:append?valueInputOption=${valueInputOption}&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          body: JSON.stringify({ values: rows }),
        }
      );
    },

    /**
     * Write data objects to a Google Sheet, replacing the existing content
     * @param {string} spreadsheetId - The ID of the spreadsheet
     * @param {string} sheetName - The name of the sheet
     * @param {Array<Object>} dataObjects - Array of objects to write
     * @param {string} valueInputOption - How to interpret the data:
     *   - "RAW": The values will be stored as-is without any interpretation
     *   - "USER_ENTERED": The values will be interpreted as if entered by a user (formulas will be interpreted)
     * @returns {Promise<Object>} Result of the write operation
     */
    async writeRows(spreadsheetId, sheetName, dataObjects, valueInputOption = "RAW") {
      if (!this._headers || !this._headerMap) {
        throw new Error("Headers not initialized. Call initializeHeaders first.");
      }

      // Transform data objects into sheet rows based on header mapping
      const rows = dataObjects.map(dataObject => {
        const row = new Array(this._headers.length).fill("");

        for (const key in this._headerMap) {
          const columnIndex = this._headerMap[key];
          const value = dataObject[key] !== undefined ? dataObject[key] : "";
          row[columnIndex] = value;
        }

        return row;
      });

      // Write to the sheet using the common fetchFromSheets method
      return this.fetchFromSheets(
        `spreadsheets/${spreadsheetId}/values/${sheetName}!A1?valueInputOption=${valueInputOption}`,
        {
          method: 'PUT',
          body: JSON.stringify({ values: rows }),
        }
      );
    },

    /**
     * Read data from a Google Sheet and transform it to objects using header mappings
     * @param {string} spreadsheetId - The ID of the spreadsheet
     * @param {string} sheetName - The name of the sheet
     * @param {string} [range] - Optional range specification (e.g., 'A2:Z100'), defaults to all data after headers
     * @returns {Promise<Array<Object>>} Array of objects with keys from column mappings
     */
    async readRows(spreadsheetId, sheetName, range = null) {
      if (!this._headers || !this._headerMap) {
        throw new Error("Headers not initialized. Call initializeHeaders first.");
      }

      // If no range specified, read all data after headers (A2:Z)
      const readRange = range || `${sheetName}!A2:Z`;

      // Get the raw data
      const data = await this.fetchFromSheets(`spreadsheets/${spreadsheetId}/values/${readRange}`);
      const rows = data.values || [];

      // Create reverse mapping from column index to key
      const indexToKey = {};
      for (const key in this._headerMap) {
        const index = this._headerMap[key];
        indexToKey[index] = key;
      }

      // Transform rows to objects
      return rows.map(row => {
        const obj = {};
        for (let i = 0; i < row.length; i++) {
          const key = indexToKey[i];
          if (key) {
            obj[key] = row[i];
          }
        }
        return obj;
      });
    }
  };
}

/**
 * Get just the headers from a Google Sheet (first row)
 * @param {Object} sheetsClient - The Google Sheets client
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @param {string} sheetName - The name of the sheet
 * @returns {Promise<Array>} The sheet headers
 */
export async function getSheetHeaders(sheetsClient, spreadsheetId, sheetName) {
  const data = await sheetsClient.fetchFromSheets(`spreadsheets/${spreadsheetId}/values/${sheetName}!A1:Z1`);
  const headerData = data.values || [];

  if (!headerData?.length || !headerData[0]?.length) {
    throw new Error(`Sheet is not initialized with headers. Please create the sheet first.`);
  }

  return headerData[0];
}

/**
 * Get and validate sheet headers against expected column mappings
 * @param {Object} sheetsClient - The Google Sheets client
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @param {string} sheetName - The name of the sheet
 * @param {Array} expectedMappings - Array of expected column mappings (objects with key and label properties)
 * @returns {Promise<Object>} Object containing headers array and headerMap mapping keys to column indices
 */
export async function validateSheetHeaders(sheetsClient, spreadsheetId, sheetName, expectedMappings) {
  const headers = await getSheetHeaders(sheetsClient, spreadsheetId, sheetName);

  // Create a map of header keys to their positions in the sheet
  const headerMap = {};

  if (expectedMappings && expectedMappings.length > 0) {
    // Create a map of label -> key for easier lookup
    const labelToKeyMap = {};
    expectedMappings.forEach(mapping => {
      labelToKeyMap[mapping.label] = mapping.key;
    });

    // Map each header to its position
    headers.forEach((header, index) => {
      const key = labelToKeyMap[header];
      if (key) {
        headerMap[key] = index;
      }
    });

    // Check if all expected headers are present in the sheet
    const expectedLabels = expectedMappings.map(mapping => mapping.label);
    const missingHeaders = expectedLabels.filter(expectedLabel =>
      !headers.includes(expectedLabel)
    );

    if (missingHeaders.length > 0) {
      const message = `Missing expected headers: ${missingHeaders.join(', ')}`;
      console.error(`\nError: ${message}`);
      console.error(`Available headers: ${headers.join(', ')}`);
      throw new Error(message);
    }
  }

  return { headers, headerMap };
}

/**
 * Get all sheets in a spreadsheet
 * @param {Object} sheetsClient - The Google Sheets client
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @returns {Promise<Array>} List of sheet objects with properties: sheetId, title, index
 */
export async function getSheets(sheetsClient, spreadsheetId) {
  const data = await sheetsClient.fetchFromSheets(`spreadsheets/${spreadsheetId}?fields=sheets.properties`);
  return data.sheets.map((sheet) => sheet.properties);
}

/**
 * Get the title of a spreadsheet
 * @param {Object} sheetsClient - The Google Sheets client
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @returns {Promise<string>} The title of the spreadsheet
 */
export async function getSpreadsheetTitle(sheetsClient, spreadsheetId) {
  const data = await sheetsClient.fetchFromSheets(`spreadsheets/${spreadsheetId}?fields=properties.title`);
  return data.properties?.title || 'Unknown';
}

/**
 * Get the first sheet from a spreadsheet and optionally initialize headers
 * @param {Object} sheetsClient - The Google Sheets client
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @param {Array} [expectedMappings] - Optional array of expected column mappings for header initialization
 * @returns {Promise<Object>} Object containing sheetName and spreadsheetTitle
 * @throws {Error} If no sheets are found in the spreadsheet
 */
export async function getFirstSheet(sheetsClient, spreadsheetId, expectedMappings = null) {
  // Get spreadsheet title
  const spreadsheetTitle = await getSpreadsheetTitle(sheetsClient, spreadsheetId);

  // Get all sheets
  const sheets = await getSheets(sheetsClient, spreadsheetId);

  // Validate we have at least one sheet
  if (sheets.length === 0) {
    throw new Error(`No sheets found in spreadsheet "${spreadsheetTitle}"`);
  }

  const sheetName = sheets[0].title;

  // Initialize headers if mappings are provided
  if (expectedMappings) {
    await sheetsClient.initializeHeaders(spreadsheetId, sheetName, expectedMappings);
  }

  // Return the first sheet name and spreadsheet title
  return {
    sheetName,
    spreadsheetTitle
  };
}
