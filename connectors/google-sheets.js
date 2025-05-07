import { SignJWT } from 'jose/jwt/sign';
import { importPKCS8 } from 'jose/key/import';

const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Create an authenticated Google Sheets client credentials object
 * @param {Object} credentials - Google Sheets credentials JSON object
 * @returns {Object} Object containing getAccessToken method
 */
export async function createSheetsClient(credentials) {
  async function getAccessToken() {
    const now = Math.floor(Date.now() / 1000);
    const privateKey = await importPKCS8(credentials.private_key, 'RS256');

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
    return json.access_token;
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
