# ShopWorker Local Jobs Development Guide

This guide covers creating and editing custom ShopWorker jobs in the local directory.

## Directory Structure

- **local/jobs/** - Create ALL your custom jobs here (in subdirectories)
- **local/triggers/** - Create custom triggers here if needed
- **local/shared/** - Shared utilities and helpers for jobs
- **local/migrations/** - Database migration files

## Wrangler.toml Management

- **CRITICAL**: Never modify the root-level `wrangler.toml` directly as it is not version controlled
- Always make wrangler.toml changes in `local/wrangler.toml` which is properly versioned
- The root wrangler.toml is generated/deployed from the local version during deployment

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

## Shared Utilities

The `local/shared/` directory contains reusable utilities for jobs:

### Available Utilities

1. **database.js** - Database operations with automatic snake_case to camelCase conversion
   ```javascript
   import { createQuizDatabase, QuizDatabase } from '../../shared/database.js';
   ```

2. **response-utils.js** - Common response formatting functions
   ```javascript
   import { createSuccessResponse, createErrorResponse } from '../../shared/response-utils.js';
   ```

3. **quiz-constants.js** - Shared configuration constants
   ```javascript
   import { OPENAI_CONFIG, RESPONSE_FIELDS } from '../../shared/quiz-constants.js';
   ```

### Naming Conventions

**IMPORTANT**: Maintain consistent naming across your codebase:

- **JavaScript/JSON**: Use `camelCase` for all properties
  - Example: `responseTime`, `shopDomain`, `createdAt`
- **SQL/Database**: Use `snake_case` for column names
  - Example: `response_time`, `shop_domain`, `created_at`
- **Automatic Conversion**: The database layer in `shared/database.js` automatically converts between snake_case (database) and camelCase (JavaScript)

### Using Shared Utilities in Jobs

When creating jobs that need common functionality:

1. **For API responses**: Use the response utilities instead of creating custom response functions
2. **For database access**: Use the shared database module which handles naming conversion
3. **For configuration**: Import constants from quiz-constants.js instead of hardcoding values

Example job structure with shared utilities:
```javascript
import { createSuccessResponse, createErrorResponse } from '../../shared/response-utils.js';
import { createQuizDatabase, QuizDatabase } from '../../shared/database.js';

export async function process({ payload, shopConfig, env }) {
  try {
    // Your job logic here
    const data = { /* ... */ };
    return createSuccessResponse(data, "Operation successful");
  } catch (error) {
    return createErrorResponse(error.message, 500);
  }
}
```

## Available Triggers
Check **core/triggers/** and **local/triggers/** for webhook topics you can use in config.json.

If you need a trigger not listed:
1. Create it under **local/triggers/** following the existing pattern
2. Refer to https://shopify.dev/docs/api/webhooks?reference=toml for the complete list of Shopify webhook topics
3. Use the exact webhook topic name from Shopify's documentation

### External Webhook Integration
When creating jobs with trigger "webhook" that will be called from external sources (e.g., Google Apps Script), the external webhook sender must include these specific headers:

**Required Headers**:
- `X-Shopify-Shop-Domain`: The shop domain (e.g., "johnnie-oadmin.myshopify.com")
- `X-Shopify-Topic`: Must be "shopworker/webhook" (not "app/webhook" or other topics)

**Important**: This is different from regular Shopify webhooks which use actual Shopify webhook topics like "products/create". The ShopWorker framework specifically looks for the topic "shopworker/webhook" for webhook-triggered jobs.

Example external webhook call:
```javascript
// Google Apps Script or other external service
const response = UrlFetchApp.fetch('your-webhook-url', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Shopify-Shop-Domain': 'johnnie-oadmin.myshopify.com',
    'X-Shopify-Topic': 'shopworker/webhook'
  },
  payload: JSON.stringify(yourPayloadData)
});
```

## Database Operations

### Using the Database in Jobs
- Import database operations from `local/shared/database.js` for quiz-related operations
- Access the D1 database through the `env.QUIZ_DB` binding in job functions
- Use standard SQL queries with prepared statements for safety
- Database operations should always be wrapped in `step.do()` calls for durability
- The database layer automatically converts snake_case (SQL) to camelCase (JavaScript)

### Database Migrations
- **Migration files** are located in `local/migrations/` directory
- Use incremental numbering: `0001_description.sql`, `0002_next_change.sql`, etc.
- Include descriptive comments and timestamps in migration files

### Applying Migrations to Remote Database
- Run `wrangler d1 migrations apply shopworker --remote` to apply pending migrations
- Check migration status with `wrangler d1 migrations list shopworker --remote`
- Always apply migrations before deploying code changes that depend on schema updates

### Database Development Workflow
1. Create migration file in `local/migrations/` with next sequential number
2. Test migration syntax and logic locally if possible
3. Apply migration to remote D1 database: `wrangler d1 migrations apply shopworker --remote`
4. Update or create jobs that use the new schema
5. Deploy the worker to production

## Email Configuration

### Resend Email Settings
**Rule**: Always use the standard ShopWorker "from" address for all email sending jobs
**From Address**: "ShopWorker <worker@shopworker.dev>"
**Reason**: Provides consistent branding and uses the verified domain for Resend

**Example**:
```javascript
// Correct approach for Resend email jobs
const emailData = {
  from: 'ShopWorker <worker@shopworker.dev>',
  to: customerEmail,
  subject: 'Your Order Confirmation',
  html: emailContent
};

// Avoid generic placeholder addresses
// WRONG: from: 'noreply@yourdomain.com'
```

## Reference Existing Jobs
Always examine similar jobs in **jobs/** directory before creating new ones to ensure consistency with existing patterns.
