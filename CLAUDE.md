
# CLAUDE.md - ShopWorker Job Development Guide

This file helps Claude Code assist with creating and editing ShopWorker jobs.

## CRITICAL: Directory Restrictions

**ONLY modify files in the `local/` directory.** The `core/` directory contains the ShopWorker framework and is READ-ONLY. Never create, edit, or delete any files in `core/`.

- ✅ **local/** - Create and modify all your custom jobs here
- ❌ **core/** - Framework files - READ ONLY, use for reference only
- ❌ **core/jobs/** - Production jobs - READ ONLY, use as examples only

## Quick Start for Job Creation

When asked to create a new job, follow these steps:
1. Check **jobs/** directory for similar existing jobs to use as reference
2. Create a new directory under **local/** with a descriptive name
3. Add `config.json` defining the trigger (see **core/triggers/** for available types)
4. Create `job.js` with the process function implementation
5. Test using `npm test` in the job directory

## Job Structure Requirements

### Critical Rules
- **ALWAYS use `step.do()`** for any operation that modifies data or makes API calls
- **NEVER store state in workflow-level variables** - they will be lost between steps
- **ALL state must be passed through step return values**

### Job File Template
Every job needs these two files:

1. **config.json** - Reference existing jobs in **jobs/** for patterns
2. **job.js** - Must export a `process()` function with JSDoc documentation

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
Check **core/triggers/** for webhook topics you can use in config.json. If you need to create a new trigger, do it under **local/triggers** following the pattern of core triggers.

## Reference Existing Jobs
Always examine similar jobs in **jobs/** directory before creating new ones to ensure consistency with existing patterns.
