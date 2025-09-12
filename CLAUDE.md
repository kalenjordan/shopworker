
# ShopWorker Development Guide

ShopWorker is a framework for building Shopify webhook-driven automation jobs.

## Project Structure

- **core/** - Framework code and production jobs (reference only - do not modify)
  - `core/jobs/` - Production job examples
  - `core/graphql/` - Reusable GraphQL queries
  - `core/triggers/` - Available webhook triggers
  
- **local/** - Custom jobs and extensions (your workspace)
  - `local/jobs/` - Custom job implementations
  - `local/triggers/` - Custom webhook triggers
  - See `local/CLAUDE.md` for detailed job development guide

- **cli/** - Command-line interface tools

## Development Guidelines

### Working with the Framework
- The `core/` directory contains the ShopWorker framework - use it for reference and understanding
- Custom jobs should be created in the `local/` directory
- CLI commands and framework improvements can be made outside these directories

### File Synchronization Requirements
- **CRITICAL**: Anytime changes are made to `local/CLAUDE.md`, the same changes MUST be applied to `create-cli/template/CLAUDE.md`
- This ensures new projects created via the CLI have the most up-to-date documentation and guidelines
- Both files should always remain synchronized to maintain consistency across all ShopWorker projects

### Key Concepts
- **Jobs** - Webhook-driven automation tasks that respond to Shopify events
- **Triggers** - Webhook topic definitions that jobs listen to
- **Workflow Steps** - Durable execution context for job operations

### Testing
- **Note:** `npm test` is only for testing individual jobs within their specific directories (e.g., `cd local/jobs/my-job && npm test`)
- **There is no general test suite** - do not run `npm test` at the project root
- Use the CLI for managing webhooks and job deployments
- To verify code changes, use linting and type checking if available

## Database Migrations

### Migration Structure
- **Migration files** are stored in `local/migrations/` directory
- Follow the naming pattern: `XXXX_description.sql` (e.g., `0001_initial_quiz_schema.sql`)
- Each migration file should include a timestamp header comment

### Applying Migrations
- Migrations are automatically applied to the D1 database during deployment
- The `wrangler.toml` file configures the migration directory: `migrations_dir = "local/migrations"`
- Use `wrangler d1 migrations apply shopworker --remote` to manually apply pending migrations to remote database
- Use `wrangler d1 migrations list shopworker --remote` to check migration status

### Migration Development Workflow
1. Create new migration files in `local/migrations/` with incremental numbers
2. Test migrations locally if needed using Wrangler D1 local development
3. Apply migrations to remote database using `wrangler d1 migrations apply shopworker --remote`
4. Deploy the worker to ensure the application code matches the database schema

## Getting Help
- Check existing jobs in `core/jobs/` for implementation patterns
- Review `local/CLAUDE.md` for job creation guidelines
- Consult Shopify API documentation for webhook topics and GraphQL queries
