/**
 * Resend email service connector
 * Compatible with Cloudflare Workers environment
 */

/**
 * Send an email using Resend API
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address (or array of addresses)
 * @param {string} [options.cc] - CC email address (or array of addresses)
 * @param {string} options.from - Sender email address
 * @param {string} [options.replyTo] - Reply-to email address
 * @param {string} options.subject - Email subject
 * @param {string} [options.text] - Plain text body
 * @param {string} [options.html] - HTML body
 * @param {Array} [options.attachments] - Array of attachment objects
 * @param {string} options.attachments[].filename - Attachment filename
 * @param {string} options.attachments[].content - Attachment content (base64 encoded)
 * @param {string} options.attachments[].contentType - Attachment MIME type
 * @param {string} apiKey - Resend API key
 * @returns {Promise<Object>} Response from Resend API
 */
export async function sendEmail(options, apiKey) {
  if (!apiKey) {
    throw new Error('Resend API key is required');
  }

  const { to, cc, from, replyTo, subject, text, html, attachments } = options;

  if (!to || !from || !subject) {
    throw new Error('to, from, and subject are required fields');
  }

  console.log('to', to);

  const emailData = {
    to: Array.isArray(to) ? to : [to],
    from,
    subject
  };

  // Add cc if provided
  if (cc) {
    emailData.cc = Array.isArray(cc) ? cc : [cc];
  }

  // Add reply-to if provided
  if (replyTo) {
    emailData.reply_to = replyTo;
  }

  // Add content (prefer HTML over text)
  if (html) {
    emailData.html = html;
  }
  if (text) {
    emailData.text = text;
  }

  // Add attachments if provided
  if (attachments && Array.isArray(attachments) && attachments.length > 0) {
    emailData.attachments = attachments.map(attachment => ({
      filename: attachment.filename,
      content: attachment.content,
      content_type: attachment.contentType
    }));
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(emailData)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessage = errorData.message || `HTTP ${response.status} ${response.statusText}`;
    throw new Error(`Resend API error: ${errorMessage}`);
  }

  return response.json();
}

/**
 * Validate Resend credentials
 * @param {Object} credentials - Credentials object
 * @param {string} credentials.apiKey - Resend API key
 * @throws {Error} If credentials are invalid
 */
export function validateCredentials(credentials) {
  if (!credentials || typeof credentials !== 'object') {
    throw new Error('Resend credentials object is required');
  }


  if (!credentials.resend_api_key || typeof credentials.resend_api_key !== 'string') {
    throw new Error('Resend API key is required and must be a string');
  }

  if (!credentials.resend_api_key.startsWith('re_')) {
    throw new Error('Invalid Resend API key format (should start with "re_")');
  }
}
