# ShopWorker Local Jobs Development Guide

This guide covers creating and editing custom ShopWorker jobs in the local directory.

## Directory Structure

- **local/jobs/** - Create ALL your custom jobs here (in subdirectories)
- **local/triggers/** - Create custom triggers here if needed

## Quick Start for Job Creation

When asked to create a new job, follow these steps:
1. Check **jobs/** directory for similar existing jobs to use as reference
2. **Create a new directory under `local/jobs/`** with a descriptive name (NOT directly in `local/`)
3. Add `config.json` defining the trigger (see **core/triggers/** for available types)
4. Create `job.js` with the process function implementation
5. Test using `npm test` in the job directory

**IMPORTANT:** Jobs must be created in `local/jobs/your-job-name/`, not directly in `local/`

## Job Structure Requirements

### Critical Rules
- **ALWAYS use `step.do()`** for any operation that modifies data or makes API calls
- **NEVER store state in workflow-level variables** - they will be lost between steps
- **ALL state must be passed through step return values**

### Job File Template
Every job needs these two files:

1. **config.json** - Must include:
   - `title` - A descriptive name for the job (REQUIRED)
   - `trigger` - The webhook topic to listen for
   - Reference existing jobs in **jobs/** for patterns
2. **job.js** - Must export a `process()` function with JSDoc documentation

Example config.json:
```json
{
  "title": "Process Third Subscription Order",
  "trigger": "orders/create"
}
```

### JSDoc Documentation Requirements

The JSDoc block for the `process()` function must explain the job's functionality at a level that a non-technical user can understand. Focus on:

- **What the job does** - Describe the business logic and outcome
- **How it works** - Explain the approach without technical implementation details
- **Key requirements** - Note any specific conditions needed (e.g., "requires subscription tags on orders")
- **Configuration needed** - Mention any setup requirements in plain language

Example of good documentation:
```javascript
/**
 * Processes the third order in a subscription sequence
 *
 * This job identifies when a customer places their third subscription order
 * by checking for specific subscription tags on the order. When detected,
 * it can trigger special promotions, loyalty rewards, or milestone notifications.
 *
 * Requirements:
 * - Orders must have subscription tags indicating their sequence number
 * - The subscription app must tag orders with "subscription_order_3" for third orders
 */
```

Avoid:
- Technical implementation details
- Code-level explanations
- Developer-focused terminology
- Internal function descriptions

### Available Context in Jobs

The `process()` function receives:
- `shopify` - GraphQL client for Shopify API calls
- `payload` - Webhook payload data
- `step` - Workflow step manager (MUST use for all operations)
- `shopConfig` - Shop-specific configuration
- `env` - Environment variables
- `secrets` - Secret values from `.secrets/` directory

## Common Job Patterns

### GraphQL Queries
- Use existing queries from **core/graphql/** when possible
- Follow naming convention: `resourceAction.js` (e.g., `orderUpdate.js`)

### Testing Jobs
- Don't test jobs via prompts. The user can test jobs via the test feature.

## Available Triggers
Check **core/triggers/** and **local/triggers/** for webhook topics you can use in config.json.

If you need a trigger not listed:
1. Create it under **local/triggers/** following the existing pattern
2. Refer to https://shopify.dev/docs/api/webhooks?reference=toml for the complete list of Shopify webhook topics
3. Use the exact webhook topic name from Shopify's documentation

## Reference Existing Jobs
Always examine similar jobs in **jobs/** directory before creating new ones to ensure consistency with existing patterns.
