# Fruit Orders Email Report Job

This job fetches recent orders from Shopify and sends an email with an Excel (.xls) file attachment containing a summary of the orders.

## Configuration

The job runs on a manual schedule and requires the following environment variables or secrets:

### Required Environment Variables/Secrets

- `EMAIL_TO` - Recipient email address
- `EMAIL_FROM` - Sender email address (must be a verified domain in Resend)
- `RESEND_API_KEY` - Your Resend API key

### Resend Setup

This job uses [Resend](https://resend.com/) for sending emails. You'll need to:

1. Create a Resend account
2. Get your API key from the Resend dashboard
3. Verify your sending domain in Resend
4. Set the required environment variables or secrets

Your Resend API key should start with `re_` and look like: `re_123456789_abcdefghijklmnopqrstuvwxyz`

## Usage

### Running the Job

From the project root:
```bash
shopworker test fruit
```

Or from the job directory:
```bash
cd jobs/fruit
shopworker runtest
```

### Excel File Format

The generated .xls file contains the following columns:
- Order Number
- Created At
- Customer Email
- Total Price
- Tags
- Line Items (SKUs and product names)

The file uses HTML table format which Excel can open natively.

## Features

- Fetches the 50 most recent orders
- Generates a properly formatted Excel file using HTML
- Sends email with attachment via Resend
- Includes order count in email body
- Handles missing data gracefully
- Compatible with Cloudflare Workers environment
- Validates Resend API key format

## Error Handling

The job will fail with descriptive error messages if:
- Required email credentials are missing
- Resend API key is invalid or missing
- No orders are found (though this logs a message and exits gracefully)
- Resend API returns an error
- Shopify API calls fail

## Environment Variables

You can set these as environment variables or store them as secrets:

```bash
# Required
export EMAIL_TO="recipient@example.com"
export EMAIL_FROM="noreply@yourdomain.com"  # Must be verified in Resend
export RESEND_API_KEY="re_your_api_key_here"
```

## Customization

You can modify the job to:
- Change the number of orders fetched (modify `first: 50` in `fetchRecentOrders`)
- Add order filtering (modify the `query` parameter)
- Customize the Excel columns (modify `generateExcelHTML` function)
- Change the email template (modify `prepareEmailOptions`)
- Add multiple recipients (modify the `to` field to be an array)
