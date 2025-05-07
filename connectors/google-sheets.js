import { google } from "googleapis";

/**
 * Create an authenticated Google Sheets API client
 * @param {Object} credentials - Google Sheets credentials JSON object
 * @returns {Object} Google Sheets API client
 */
export async function createSheetsClient(credentials) {
  const auth = new google.auth.GoogleAuth({
    credentials: credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

/**
 * Get data from a Google Sheet
 * @param {Object} sheetsClient - The Google Sheets client
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @param {string} range - The range of cells to fetch (e.g., 'Sheet1!A1:D10')
 * @returns {Promise<Array>} The sheet data
 */
export async function getSheetData(sheetsClient, spreadsheetId, range) {
  const response = await sheetsClient.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  return response.data.values || [];
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
  const response = await sheetsClient.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption, // 'RAW' or 'USER_ENTERED'
    resource: {
      values,
    },
  });

  return response.data;
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
  const response = await sheetsClient.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption, // 'RAW' or 'USER_ENTERED'
    insertDataOption: "INSERT_ROWS",
    resource: {
      values,
    },
  });

  return response.data;
}

/**
 * Get all sheets in a spreadsheet
 * @param {Object} sheetsClient - The Google Sheets client
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @returns {Promise<Array>} List of sheet objects with properties: sheetId, title, index
 */
export async function getSheets(sheetsClient, spreadsheetId) {
  const response = await sheetsClient.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties",
  });

  return response.data.sheets.map((sheet) => sheet.properties);
}
