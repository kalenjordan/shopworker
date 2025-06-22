/**
 * Email Summary Module
 *
 * Handles sending email summaries for the Avery order import process
 */

import { sendEmail } from "../../../connectors/resend.js";
import chalk from "chalk";
import { isWorkerEnvironment } from "../../../utils/env.js";
import { format } from "date-fns";



/**
 * Send simplified email summary
 * @param {number} orderCount - Number of processed orders
 * @param {string} orderTagDate - Date processed in YYYY-MM-DD format
 */
export async function sendEmailSummary(orderCount, orderTagDate, ctx) {
  try {
    // Check if email configuration is available
    if (!ctx.shopConfig.resend_api_key || !ctx.shopConfig.email_to || !ctx.shopConfig.email_from) {
      console.log(chalk.yellow("Email configuration not available, skipping email notification"));
      return;
    }

    // Create email subject
    const subject = `Avery Order Import Summary - ${orderCount} orders processed (${orderTagDate})`;

    // Create HTML content
    const htmlContent = createHtmlSummary(orderCount, orderTagDate);

    // Prepare email options
    const emailOptions = {
      to: ctx.shopConfig.email_to,
      from: ctx.shopConfig.email_from,
      subject: subject,
      html: htmlContent
    };

    // Add reply-to if configured
    if (ctx.shopConfig.email_reply_to) {
      emailOptions.replyTo = ctx.shopConfig.email_reply_to;
    }

    if (isWorkerEnvironment(ctx.env)) {
      await sendEmail(emailOptions, ctx.shopConfig.resend_api_key);
    } else {
      console.log(chalk.yellow("Skipping email summary in CLI environment"));
    }

    console.log(chalk.green("✓ Email summary sent successfully"));
  } catch (error) {
    console.error(chalk.red(`Failed to send email summary: ${error.message}`));
  }
}

/**
 * Create HTML email content
 */
function createHtmlSummary(orderCount, orderTagDate) {
  let html = `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #1f2937; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">
      📊 Avery Order Import Summary
    </h2>

    <div style="background-color: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0;">
      <p style="margin: 0; color: #6b7280; font-size: 14px;">Date: ${orderTagDate} CT</p>
    </div>

    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin: 20px 0;">
      <div style="background-color: #f0f9ff; padding: 15px; border-radius: 8px; text-align: center;">
        <div style="font-size: 24px; font-weight: bold; color: #0369a1;">${orderCount}</div>
        <div style="color: #0369a1; font-size: 14px;">Total Orders</div>
      </div>
    </div>

    <div style="margin: 20px 0;">
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background-color: #f0fdf4; border-radius: 6px; margin: 5px 0;">
        <span style="color: #166534;">Orders Processed:</span>
        <strong style="color: #166534;">${orderCount}</strong>
      </div>
    </div>`;

  // Create Shopify admin URL with tag filter
  const tag = `cs-${orderTagDate}`;
  const encodedTag = encodeURIComponent(tag);
  const shopifyUrl = `https://admin.shopify.com/store/835a20-6c/orders?start=MQ%3D%3D&tag=${encodedTag}`;

  html += `
    <div style="margin: 20px 0;">
      <div style="background-color: #f0f9ff; padding: 15px; border-radius: 8px; text-align: center;">
        <h3 style="color: #0369a1; margin-bottom: 15px;">View Orders in Shopify</h3>
        <a href="${shopifyUrl}" style="display: inline-block; background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
          View Orders with Tag: ${tag}
        </a>
      </div>
    </div>
  </div>`;

  return html;
}
