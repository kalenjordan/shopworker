import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

/**
 * Create an authenticated Google Sheets API client
 * @param {Object|string} credentials - Google Sheets credentials JSON object or path to credentials file
 * @returns {Object} Google Sheets API client
 */
async function createSheetsClient(credentials) {
  try {
    let auth;

    // Check if credentials is a string (path) or object (direct credentials)
    if (typeof credentials === 'string') {
      // Read credentials from file
      const content = fs.readFileSync(credentials, 'utf8');
      const credentialsData = JSON.parse(content);

      // Create JWT client using service account credentials from file
      auth = new google.auth.JWT(
        credentialsData.client_email,
        null,
        credentialsData.private_key,
        ['https://www.googleapis.com/auth/spreadsheets']
      );
    } else {
      // Use credentials object directly with GoogleAuth
      auth = new google.auth.GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    }

    // Authorize the client
    const client = await auth.getClient();

    // Create and return the sheets client
    return google.sheets({ version: 'v4', auth: client });
  } catch (error) {
    console.error('Error creating Google Sheets client:', error.message);
    throw error;
  }
}

/**
 * Get data from a Google Sheet
 * @param {Object|string} credentials - Google Sheets credentials JSON object or path to project root
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @param {string} range - The range of cells to fetch (e.g., 'Sheet1!A1:D10')
 * @returns {Promise<Array>} The sheet data
 */
export async function getSheetData(credentials, spreadsheetId, range) {
  try {
    // Handle case where credentials is a directory path
    let credentialsToUse = credentials;
    if (typeof credentials === 'string' && !credentials.endsWith('.json')) {
      const credentialsPath = path.join(credentials, 'google-sheets-credentials.json');
      if (fs.existsSync(credentialsPath)) {
        credentialsToUse = credentialsPath;
      } else {
        throw new Error(`Google Sheets credentials file not found at: ${credentialsPath}`);
      }
    }

    const sheetsClient = await createSheetsClient(credentialsToUse);
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    return response.data.values || [];
  } catch (error) {
    console.error(`Error fetching data from Google Sheet (${spreadsheetId}, ${range}):`, error.message);
    throw error;
  }
}

/**
 * Write data to a Google Sheet
 * @param {Object|string} credentials - Google Sheets credentials JSON object or path to project root
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @param {string} range - The range where to write (e.g., 'Sheet1!A1')
 * @param {Array} values - 2D array of values to write
 * @param {string} valueInputOption - How to interpret the data (RAW or USER_ENTERED)
 * @returns {Promise<Object>} The update response
 */
export async function writeSheetData(credentials, spreadsheetId, range, values, valueInputOption = 'RAW') {
  try {
    // Handle case where credentials is a directory path
    let credentialsToUse = credentials;
    if (typeof credentials === 'string' && !credentials.endsWith('.json')) {
      const credentialsPath = path.join(credentials, 'google-sheets-credentials.json');
      if (fs.existsSync(credentialsPath)) {
        credentialsToUse = credentialsPath;
      } else {
        throw new Error(`Google Sheets credentials file not found at: ${credentialsPath}`);
      }
    }

    const sheetsClient = await createSheetsClient(credentialsToUse);
    const response = await sheetsClient.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption, // 'RAW' or 'USER_ENTERED'
      resource: {
        values,
      },
    });

    return response.data;
  } catch (error) {
    console.error(`Error writing data to Google Sheet (${spreadsheetId}, ${range}):`, error.message);
    throw error;
  }
}

/**
 * Append data to a Google Sheet
 * @param {Object|string} credentials - Google Sheets credentials JSON object or path to project root
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @param {string} range - The range where to append (e.g., 'Sheet1!A1')
 * @param {Array} values - 2D array of values to append
 * @param {string} valueInputOption - How to interpret the data (RAW or USER_ENTERED)
 * @returns {Promise<Object>} The append response
 */
export async function appendSheetData(credentials, spreadsheetId, range, values, valueInputOption = 'RAW') {
  try {
    // Handle case where credentials is a directory path
    let credentialsToUse = credentials;
    if (typeof credentials === 'string' && !credentials.endsWith('.json')) {
      const credentialsPath = path.join(credentials, 'google-sheets-credentials.json');
      if (fs.existsSync(credentialsPath)) {
        credentialsToUse = credentialsPath;
      } else {
        throw new Error(`Google Sheets credentials file not found at: ${credentialsPath}`);
      }
    }

    const sheetsClient = await createSheetsClient(credentialsToUse);
    const response = await sheetsClient.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption, // 'RAW' or 'USER_ENTERED'
      insertDataOption: 'INSERT_ROWS',
      resource: {
        values,
      },
    });

    return response.data;
  } catch (error) {
    console.error(`Error appending data to Google Sheet (${spreadsheetId}, ${range}):`, error.message);
    throw error;
  }
}

/**
 * Get all sheets in a spreadsheet
 * @param {Object|string} credentials - Google Sheets credentials JSON object or path to project root
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @returns {Promise<Array>} List of sheet objects with properties: sheetId, title, index
 */
export async function getSheets(credentials, spreadsheetId) {
  try {
    // Handle case where credentials is a directory path
    let credentialsToUse = credentials;
    if (typeof credentials === 'string' && !credentials.endsWith('.json')) {
      const credentialsPath = path.join(credentials, 'google-sheets-credentials.json');
      if (fs.existsSync(credentialsPath)) {
        credentialsToUse = credentialsPath;
      } else {
        throw new Error(`Google Sheets credentials file not found at: ${credentialsPath}`);
      }
    }

    const sheetsClient = await createSheetsClient(credentialsToUse);
    const response = await sheetsClient.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties'
    });

    return response.data.sheets.map(sheet => sheet.properties);
  } catch (error) {
    console.error(`Error getting sheets from spreadsheet (${spreadsheetId}):`, error.message);
    throw error;
  }
}

/**
 * Clear values from a Google Sheet range
 * @param {Object|string} credentials - Google Sheets credentials JSON object or path to project root
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @param {string} range - The range to clear (e.g., 'Sheet1!A1:D10')
 * @returns {Promise<Object>} The clear response
 */
export async function clearSheetRange(credentials, spreadsheetId, range) {
  try {
    // Handle case where credentials is a directory path
    let credentialsToUse = credentials;
    if (typeof credentials === 'string' && !credentials.endsWith('.json')) {
      const credentialsPath = path.join(credentials, 'google-sheets-credentials.json');
      if (fs.existsSync(credentialsPath)) {
        credentialsToUse = credentialsPath;
      } else {
        throw new Error(`Google Sheets credentials file not found at: ${credentialsPath}`);
      }
    }

    const sheetsClient = await createSheetsClient(credentialsToUse);
    const response = await sheetsClient.spreadsheets.values.clear({
      spreadsheetId,
      range,
    });

    return response.data;
  } catch (error) {
    console.error(`Error clearing data in Google Sheet (${spreadsheetId}, ${range}):`, error.message);
    throw error;
  }
}
