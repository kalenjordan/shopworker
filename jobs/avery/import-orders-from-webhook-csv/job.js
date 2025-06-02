/**
 * Import from Webhook CSV Job
 *
 * This job processes webhook payloads for CSV import functionality.
 * Currently logs the webhook payload for testing purposes.
 */

import { parseCSV, groupRowsByColumn } from "../../../connectors/csv.js";

export async function process({ record, shopify, jobConfig }) {
  let limit = jobConfig.test.limit;

  // Decode base64 content from first attachment if available
  if (!record.attachments || record.attachments.length === 0 || !record.attachments[0].content) {
    throw new Error("No attachments found or attachment content is empty");
  }

  console.log("\n=== Decoding Base64 Attachment Content ===");
  const decodedContent = atob(record.attachments[0].content);

  console.log(`Processing CSV content with limit: ${limit}`);

  // Parse CSV using the connector
  const parsedData = parseCSV(decodedContent, {
    limit: limit,
    hasHeaders: true,
  });

  if (parsedData.rows.length === 0) {
    console.log("No data rows found");
    return;
  }

  console.log(`Processed ${parsedData.rows.length} data rows`);

  // Check if required columns exist
  if (!("Customer: Email" in parsedData.columnIndices)) {
    console.log('Error: "Customer: Email" column not found');
    return;
  }

  // Filter rows by email if filterEmail is specified in jobConfig
  let filteredRows = parsedData.rows;
  if (jobConfig.test.filterEmail) {
    console.log(`\nFiltering rows by email: ${jobConfig.test.filterEmail}`);
    filteredRows = parsedData.rows.filter(row => row["Customer: Email"] === jobConfig.test.filterEmail);
    console.log(`Found ${filteredRows.length} rows matching email filter`);

    if (filteredRows.length === 0) {
      console.log(`No rows found for email: ${jobConfig.filterEmail}`);
      return;
    }
  }

  // Group rows by Customer: Email
  const groupedByEmail = groupRowsByColumn(filteredRows, "Customer: Email");

  // Log grouped results
  console.log("\n=== Grouped Results by Customer Email ===");
  Object.keys(groupedByEmail).forEach((email) => {
    console.log(`${email}:`);
    groupedByEmail[email].forEach((row) => {
      const name = row["Name"] || "N/A";
      const lineTitle = row["Line: Title"] || "N/A";

      console.log(`  Name: ${name}`);
      console.log(`  Line: Title: ${lineTitle}`);
      //console.log(`  ${JSON.stringify(row)}`);
      console.log(""); // Empty line for readability
    });
  });
}
