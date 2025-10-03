# ShopWorker

A framework for building Shopify webhook-driven automation jobs that run on Cloudflare Workers.

## Installation

Create a new ShopWorker instance using npx:

```bash
npx create-shopworker
```

This will:
1. Clone the main ShopWorker repository
2. Create a GitHub repository for your account-specific code
3. Set up a `local/` directory (cloned from your account repo) for your custom jobs
4. Create `.shopworker.json` with your Shopify credentials
5. Install dependencies

## Project Structure

```
your-project/
├── core/                  # ShopWorker framework (reference only)
│   ├── jobs/             # Example jobs (order, product, review, webrequest-example)
│   ├── triggers/         # Available webhook triggers
│   └── graphql/          # Reusable GraphQL queries
├── local/                # Your account-specific code (separate git repo)
│   ├── jobs/            # Your custom jobs go here
│   ├── triggers/        # Custom webhook triggers
│   └── wrangler.toml    # Your deployment configuration
└── cli/                  # Command-line tools
```

The `local/` directory is a separate git repository for your account-specific customizations, while `core/` contains the ShopWorker framework code.

## Quick Start

### Check Job Status

To see the status of all jobs in your project:

```bash
node cli.js status
```

This shows the status of all jobs in both `core/jobs/` and `local/jobs/`.

Status types:
- `MANUAL`: Job is triggered manually (no webhook needed)
- `ENABLED`: Job has an active webhook configured
- `NOT CONFIGURED`: Webhook exists for this topic but isn't linked to this job
- `DISABLED`: No webhooks found for this job's trigger topic

### Enable a Job

To enable a job by registering a webhook:

```bash
node cli.js enable your-job-name
```

This will create a webhook in your Shopify store that triggers the job.

### Disable a Job

To disable a job by removing its webhook:

```bash
node cli.js disable your-job-name
```

### Test a Job

To test a job locally with sample data:

```bash
node cli.js test your-job-name
```

You can provide custom parameters:

```bash
node cli.js test your-job-name --param key=value
```

## Creating New Jobs

Create your custom jobs in the `local/jobs/` directory. Each job requires:
- `config.json`: Specifies which trigger to use
- `job.js`: The job implementation

Example job structure:
```javascript
// local/jobs/example-job/job.js
/**
 * Brief description of what this job does
 */
export async function process({ payload, shopify, step, env }) {
  // Use step.do() for all operations
  const result = await step.do("operation-name", async () => {
    // Your job logic here
    return await shopify.graphql(YourGraphQLQuery, variables);
  });

  console.log("Job completed successfully!");
}
```

See `local/CLAUDE.md` for detailed job development guidelines.

## Example Jobs

The `core/jobs/` directory contains example jobs for reference:

- **order**: Order processing examples
- **product**: Product management examples
- **review**: Review handling examples
- **webrequest-example**: Web request handling patterns

Your custom jobs go in `local/jobs/` and are specific to your Shopify store's needs.

## Configuration

ShopWorker uses `.shopworker.json` for Shopify credentials (created by `npx create-shopworker`):

```json
{
  "shopify_domain": "your-store.myshopify.com",
  "shopify_token": "shpat_...",
  "shopify_api_secret_key": "..."
}
```

Your Cloudflare account ID is configured in `local/wrangler.toml`.

## Deployment

### Deploying to Cloudflare Workers

1. Ensure you have Wrangler CLI installed (should be installed via npm):
   ```bash
   npx wrangler login
   ```

2. Update `local/wrangler.toml` with your configuration if needed (this file is version controlled)

3. Deploy using the CLI:
   ```bash
   node cli.js deploy
   ```

   The deploy command automatically:
   - Copies `local/wrangler.toml` to the root (for wrangler to use)
   - Deploys your worker to Cloudflare
   - Applies any pending database migrations

4. Enable your jobs to register webhooks:
   ```bash
   node cli.js enable your-job-name
   ```

**Note:** The root `wrangler.toml` is gitignored and automatically synced from `local/wrangler.toml` during deployment. Always edit `local/wrangler.toml`, never the root one.

## Updating ShopWorker Framework

To update the core ShopWorker framework:

```bash
git pull origin master
```

Your `local/` directory is a separate repository, so framework updates won't affect your custom jobs.

## Learn More

- See `CLAUDE.md` for development guidelines
- See `local/CLAUDE.md` for job creation patterns
- Check `core/jobs/` for example implementations
