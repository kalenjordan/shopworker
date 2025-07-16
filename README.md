# Shopworker CLI

A CLI tool for creating and managing Shopify automation jobs using the Admin API.

## Using with Cursor

This tool is designed to be used with Cursor to one-shot or few-shot prompt most use cases. With Cursor's AI-powered coding assistant, you can quickly generate job implementations by describing what you want to accomplish.

### Example: Order Created External API Job

The [order-created-external-api](/jobs/order-created-external-api) job is an example of a job that was created with this prompt:

> Create a job that triggers when an order is created and hits an external API at https://jsonplaceholder.typicode.com/posts/1 - gets the body from that json and sets it as the custom message on the orderInvoiceSend mutation

The job that it generated:

1. Triggers on order creation
2. Pings an external API endpoint
3. Uses a field from the response
4. Passes the data into the invoice send mutation


## Installation

1. Clone this repository
2. Create a `.env` file based on the `env.example` template
3. Install dependencies:
   ```
   npm install
   ```

## Quick Start

### Check Job Status

To see the status of all jobs in your project:

```bash
npm run status
```

Example output:
```
JOB STATUS SUMMARY
--------------------------------------------------------------------------------
JOB                            TRIGGER              STATUS          WEBHOOK ID
--------------------------------------------------------------------------------
order-create                   manual               MANUAL          N/A
order-created-external-api     orders/create        ENABLED         1393197220026
order-created-tag-skus         orders/create        NOT CONFIGURED  None for this job
product-create                 manual-trigger       MANUAL          N/A
product-created-metafield      products/create      ENABLED         1393191649466
--------------------------------------------------------------------------------
```

Status types:
- `MANUAL`: Job is triggered manually (no webhook needed)
- `ENABLED`: Job has an active webhook configured
- `NOT CONFIGURED`: Webhook exists for this topic but isn't linked to this job
- `DISABLED`: No webhooks found for this job's trigger topic

### Enable a Job

To enable a job by registering a webhook:

```bash
npm run enable -- order-created-tag-skus
```

This will create a webhook in your Shopify store that triggers the job.

### Disable a Job

To disable a job by removing its webhook:

```bash
npm run disable -- order-created-tag-skus
```

### Test a Job

To test a job with the most recent data:

```bash
npm run test -- order-created-tag-skus
```

You can filter the test data:

```bash
npm run test -- order-created-tag-skus --query "created_at:>2023-01-01"
```

To test a job when you're already in the job directory:

```bash
cd jobs/order-created-tag-skus
npm test
```

## Creating New Jobs

Jobs are located in the `jobs/` directory. Each job has:
- `config.json`: Specifies which trigger to use
- `job.js`: The job implementation

Example job structure:
```javascript
// jobs/example-job/job.js
export async function process(data, shopify) {
  console.log("Processing:", data);

  // Your job logic here
  const response = await shopify.graphql(YourGraphQLQuery, variables);

  console.log("Job completed successfully!");
}
```

## Available Jobs

- **order-create**: Creates a new order manually
- **order-created-external-api**: Adds data from an external API to order invoices
- **order-created-tag-skus**: Tags orders with the SKUs of line items
- **product-create**: Creates a new product with random details
- **product-created-metafield**: Adds a metafield to newly created products

## Deployment

### Deploying to Cloudflare Workers

To deploy your jobs to Cloudflare Workers:

1. Install Wrangler CLI:
   ```bash
   npm install -g wrangler
   ```

2. Create a `wrangler.toml` file using the example template:
   ```bash
   cp wrangler.toml.example wrangler.toml
   ```

3. Update your `wrangler.toml` file with your account details and environment variables:
   ```toml
   name = "shopworker"
   main = "worker.js"
   compatibility_date = "2023-06-01"

   [vars]
   SHOP = "your-shop.myshopify.com"
   # Add any other environment variables your worker needs
   ```

4. Authenticate with Cloudflare:
   ```bash
   wrangler login
   ```

5. Deploy the worker:
   ```bash
   wrangler publish
   ```

6. Once deployed, update your `.env` file with the worker URL:
   ```
   CLOUDFLARE_WORKER_URL=https://shopworker.your-account.workers.dev
   ```

7. Enable your jobs using the CLI to register webhooks pointing to your worker:
   ```bash
   npm run enable -- your-job-name
   ```

For more details on Cloudflare Workers, see the [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/).

## Environment Variables

Create a `.env` file with:

```
SHOPIFY_ACCESS_TOKEN=your_access_token
SHOP=your-shop.myshopify.com
CLOUDFLARE_WORKER_URL=https://your-worker-url.workers.dev
```

- `SHOPIFY_ACCESS_TOKEN`: Your Shopify admin API access token
- `SHOP`: Your shop URL
- `CLOUDFLARE_WORKER_URL`: URL for your Cloudflare worker (for webhook delivery)

## TODOS:

- Implement cloudflare job queue
- Add documentation related to forking and merging upstream changes in


git clone --origin upstream https://github.com/kalenjordan/shopworker shopworker-new
cd shopworker-new
git remote rename origin upstream
git remote add origin https://github.com/kalenjordan/shopworker-new
