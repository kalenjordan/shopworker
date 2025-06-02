/**
 * Import from Webhook CSV Job
 *
 * This job processes webhook payloads for CSV import functionality.
 * Currently logs the webhook payload for testing purposes.
 */

export async function process({ record, shopify, jobConfig, secrets }) {
  let limit = jobConfig.test.limit;

  // Decode base64 content from first attachment if available
  if (record.attachments && record.attachments.length > 0 && record.attachments[0].content) {
    console.log('\n=== Decoding Base64 Attachment Content ===');
    const decodedContent = atob(record.attachments[0].content);

    // Parse CSV content by splitting on newlines and limit to first X rows
    const rows = decodedContent.split('\n').filter(row => row.trim() !== '');
    const limitedRows = rows.slice(0, limit);

    console.log(`Showing first ${limitedRows.length} rows (limit: ${limit}):`);
    limitedRows.forEach((row, index) => {
      console.log(`Row ${index + 1}: ${row}`);
    });
  } else {
    console.log('No attachments found or attachment content is empty');
  }

  // TODO: Implement CSV import logic here
  console.log('Job processing complete');
}
