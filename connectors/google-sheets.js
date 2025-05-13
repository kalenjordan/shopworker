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
 * @returns {Object} Object containing getAccessToken method
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

  // Return client with simplified interface
  return {
    _accessToken: null,
    async getToken() {
      if (!this._accessToken) {
        this._accessToken = await getAccessToken();
      }
      return this._accessToken;
    }
  };
}

/**
 * Get data from a Google Sheet
 * @param {Object} sheetsClient - The Google Sheets client
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @param {string} range - The range of cells to fetch (e.g., 'Sheet1!A1:D10')
 * @returns {Promise<Array>} The sheet data
 */
export async function getSheetData(sheetsClient, spreadsheetId, range) {
  const accessToken = await sheetsClient.getToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await res.json();
  return data.values || [];
}

/**
 * Get just the headers from a Google Sheet (first row)
 * @param {Object} sheetsClient - The Google Sheets client
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @param {string} sheetName - The name of the sheet
 * @returns {Promise<Array>} The sheet headers
 */
export async function getSheetHeaders(sheetsClient, spreadsheetId, sheetName) {
  const headerData = await getSheetData(sheetsClient, spreadsheetId, `${sheetName}!A1:Z1`);

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
 * Write data to a Google Sheet
 * @param {Object} sheetsClient - The Google Sheets client
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @param {string} range - The range where to write (e.g., 'Sheet1!A1')
 * @param {Array} values - 2D array of values to write
 * @param {string} valueInputOption - How to interpret the data (RAW or USER_ENTERED)
 * @returns {Promise<Object>} The update response
 */
export async function writeSheetData(sheetsClient, spreadsheetId, range, values, valueInputOption = "RAW") {
  const accessToken = await sheetsClient.getToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=${valueInputOption}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      values,
    }),
  });

  return res.json();
}

/**
 * Append data to a Google Sheet
 * @param {Object} sheetsClient - The Google Sheets client
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @param {string} range - The range where to append (e.g., 'Sheet1!A1')
 * @param {Array} values - 2D array of values to append
 * @param {string} valueInputOption - How to interpret the data (RAW or USER_ENTERED)
 * @returns {Promise<Object>} The append response
 */
export async function appendSheetData(sheetsClient, spreadsheetId, range, values, valueInputOption = "RAW") {
  const accessToken = await sheetsClient.getToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=${valueInputOption}&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      values,
    }),
  });

  return res.json();
}

/**
 * Get all sheets in a spreadsheet
 * @param {Object} sheetsClient - The Google Sheets client
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @returns {Promise<Array>} List of sheet objects with properties: sheetId, title, index
 */
export async function getSheets(sheetsClient, spreadsheetId) {
  const accessToken = await sheetsClient.getToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await res.json();
  return data.sheets.map((sheet) => sheet.properties);
}

/**
 * Get the title of a spreadsheet
 * @param {Object} sheetsClient - The Google Sheets client
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @returns {Promise<string>} The title of the spreadsheet
 */
export async function getSpreadsheetTitle(sheetsClient, spreadsheetId) {
  const accessToken = await sheetsClient.getToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await res.json();
  return data.properties?.title || 'Unknown';
}

/**
 * Get the first sheet from a spreadsheet and validate it exists
 * @param {Object} sheetsClient - The Google Sheets client
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @returns {Promise<Object>} Object containing sheetName and spreadsheetTitle
 * @throws {Error} If no sheets are found in the spreadsheet
 */
export async function getFirstSheet(sheetsClient, spreadsheetId) {
  // Get spreadsheet title
  const spreadsheetTitle = await getSpreadsheetTitle(sheetsClient, spreadsheetId);

  // Get all sheets
  const sheets = await getSheets(sheetsClient, spreadsheetId);

  // Validate we have at least one sheet
  if (sheets.length === 0) {
    throw new Error(`No sheets found in spreadsheet "${spreadsheetTitle}"`);
  }

  // Return the first sheet name and spreadsheet title
  return {
    sheetName: sheets[0].title,
    spreadsheetTitle
  };
}
