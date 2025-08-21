
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

### Key Concepts
- **Jobs** - Webhook-driven automation tasks that respond to Shopify events
- **Triggers** - Webhook topic definitions that jobs listen to
- **Workflow Steps** - Durable execution context for job operations

### Testing
- Individual jobs can be tested using `npm test` in their directory
- Use the CLI for managing webhooks and job deployments

## Getting Help
- Check existing jobs in `core/jobs/` for implementation patterns
- Review `local/CLAUDE.md` for job creation guidelines
- Consult Shopify API documentation for webhook topics and GraphQL queries
