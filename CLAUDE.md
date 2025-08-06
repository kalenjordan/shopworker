# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development Commands
- `npm test` - Test a job with recent data from the current directory
- `npm run test -- [job-name]` - Test a specific job
- `npm run test -- [job-name] --query "created_at:>2023-01-01"` - Test with filtered data
- `npm run lint` - Run ESLint on the codebase

### Job Management
- `npm run status` - View status of all jobs (MANUAL, ENABLED, NOT CONFIGURED, DISABLED)
- `npm run enable -- [job-name]` - Enable a job by registering its webhook (deploys to Cloudflare first)
- `npm run disable -- [job-name]` - Disable a job by removing its webhook
- `npm run remote-test -- [job-name]` - Test a job against the deployed Cloudflare worker

### Deployment
- `npm run deploy` - Deploy to Cloudflare Workers
- `npm run put-secrets` - Upload .shopworker.json and .secrets/* to Cloudflare as secrets

### Utilities
- `npm run all-webhooks` - List all webhooks in the store
- `npm run delete-webhook -- [webhook-id]` - Delete a specific webhook
- `npm run generate-structure` - Generate codebase structure documentation

## Architecture

### Core Components

1. **CLI Tool (`cli.js`)** - Command-line interface for managing jobs
   - Uses Commander.js for CLI structure
   - Delegates to utility modules in `utils/`

2. **Cloudflare Worker (`worker.js`)** - Webhook handler and job orchestrator
   - Receives Shopify webhooks
   - Implements Cloudflare Workflows for job processing
   - Handles large payloads via R2 storage
   - Verifies webhook signatures

3. **Job System** - Modular job architecture
   - Each job in `jobs/` with `config.json` and `job.js`
   - Jobs export `process()` function receiving context object
   - Jobs can use workflow steps for reliability

### Job Structure

**Important:** When creating new jobs or modifying existing ones, always use the `step.do()` pattern for workflow steps. This ensures atomic, retriable operations and proper error handling. Some older jobs may not use this pattern yet and need refactoring, but all new work should follow this approach.

**Critical Workflow State Management Rule:** NEVER store accumulated state in variables at the workflow level. Cloudflare Workflows can hibernate between steps, causing workflow-level variables to be lost. ALL state must be stored in and retrieved from step return values. Each step should return the complete state needed for subsequent steps.

**Job Documentation Format:** Each job's `process` method should include a JSDoc comment block with:
1. **Title** (first line): A concise title for the job
2. **Description** (second paragraph after blank line): A more detailed description of what the job does

Example:
```javascript
/**
 * Order Fulfillment Processor
 * 
 * Automatically processes fulfilled orders by updating inventory levels,
 * sending notification emails to customers, and syncing fulfillment
 * data with external warehouse management systems.
 * 
 * @param {Object} context - The job context
 */
export async function process(context) {
  // Job implementation
}
```

Jobs follow this pattern:
```javascript
export async function process({ shopify, payload, shopConfig, jobConfig, env, secrets, step }) {
  // Use step.do() for workflow steps
  const result = await step.do("step-name", async () => {
    // Step logic here
    return { /* All state that needs to persist */ };
  });
  
  // For iterative processes, pass state through steps:
  let currentState = await step.do("initial-step", async () => {
    return { count: 0, items: [] };
  });
  
  currentState = await step.do("next-step", async () => {
    // Use currentState from previous step
    return { count: currentState.count + 1, items: [...currentState.items, newItem] };
  });
  
  // Access Shopify API via shopify.graphql()
  // Access webhook payload via payload
  // Access secrets via secrets object
}
```

### Configuration

- `.shopworker.json` - Multi-shop configuration with API tokens
- `.env` - Local development configuration
- `wrangler.toml` - Cloudflare Workers configuration
- Job-specific `config.json` - Trigger type, shop override, test settings

### Key Patterns

1. **GraphQL Queries** - Stored in `core/graphql/` directory as `.js` files with template literals, imported by jobs. Follow naming conventions like `productsGetRecent.js`, `orderUpdate.js`
2. **Workflow Steps** - Use `step.do()` for atomic, retriable operations
3. **Large Payload Handling** - Automatic R2 storage for payloads >1MB
4. **Multi-Shop Support** - Configure multiple shops in `.shopworker.json`
5. **Secret Management** - Store secrets in `.secrets/` directory, access via `secrets` object

### Testing Approach

- Use `npm test` in a job directory to test with recent Shopify data
- Test filters available: `--query`, `--limit`, `--dry-run`
- Remote testing available via `npm run remote-test` to test deployed workers
- No unit test framework configured - testing is integration-based using real Shopify data