# Shopworker Utils Refactoring Plan

This document outlines a proposed reorganization of the utilities in the Shopworker CLI to create a more logical and maintainable structure.

## Current Issues

- Utilities are scattered across multiple files with unclear boundaries
- Some files contain mixed responsibilities
- Environment-specific code (CLI vs Worker) is sometimes mixed together
- Naming is inconsistent

## Proposed Structure

### 1. Core Modules (Environment-Agnostic)

#### `core/config.js`
- Purpose: Central configuration management
- Functions:
  - `loadJobConfig()` - Load config for a specific job
  - `loadTriggerConfig()` - Load a trigger configuration
  - `loadJobsConfig()` - Load all job configurations
  - `getShopConfig()` - Get configuration for a specific shop
  - `loadAndValidateWebhookConfigs()` - Load and validate job and trigger configs for webhook operations

#### `core/job-detection.js`
- Purpose: Job detection and job-related utilities
- Functions:
  - `getAvailableJobDirs()` - Get all job directories
  - `detectJobDirectory()` - Detect the job directory from context
  - `ensureAndResolveJobName()` - Resolve job name from arguments or context
  - `listAvailableJobs()` - Print available jobs
  - Additional functions from job-loader.js that relate to finding/loading jobs

#### `core/environment.js`
- Purpose: Environment detection and context
- Functions:
  - `isCloudflareWorker()` - Check if code is running in Worker environment
  - `getEnvironmentConfig()` - Load environment-specific configurations

#### `core/logger.js`
- Purpose: Consistent logging across environments
- Functions:
  - `logToWorker()` - Log in worker environment
  - `logToCli()` - Log in CLI environment
  - `logError()` - Log errors consistently
  - `logWarning()` - Log warnings consistently

### 2. Shopify Integration (Environment-Agnostic)

#### `shopify/client.js`
- Purpose: Comprehensive Shopify API client implementation
- Functions:
  - `createShopifyClient()` - Create a Shopify API client
  - `initShopify()` - Initialize Shopify client for a specific job
  - Helper methods for GraphQL operations, error handling, and ID manipulation
  - All current functionality from both shopify-client.js and shopify-api-helpers.js

### 3. Job Processing (Environment-Agnostic)

#### `jobs/processor.js`
- Purpose: Core job processing logic (environment-agnostic)
- Functions:
  - `processJob()` - Core job processing logic shared by CLI and Worker

### 4. CLI-Specific Modules

#### `cli/runner.js`
- Purpose: CLI-specific job execution functionality
- Functions:
  - `findSampleRecordForJob()` - Find a sample record for testing (CLI-only)
  - `runJobTest()` - Run a test for a specific job (CLI-only)
  - `runJobRemoteTest()` - CLI function to test against remote worker
  - `getWorkerUrl()` - Get worker URL from options or config

#### `cli/webhooks.js`
- Purpose: CLI webhook management operations
- Functions:
  - `enableJobWebhook()` - Enable webhook for a job
  - `disableJobWebhook()` - Disable webhook for a job
  - `deleteWebhookById()` - Delete a webhook by ID
  - `handleAllJobsStatus()` - Get status of all job webhooks
  - `handleSingleJobStatus()` - Get status of a specific job webhook
  - `getJobDisplayInfo()` - Get display information for a job's webhook status

#### `cli/ui.js`
- Purpose: CLI user interface components and formatting
- Functions:
  - `displayJobsTable()` - Format and display webhooks table
  - `displayWebhookDetails()` - Show webhook details
  - `displayIncludeFieldsInfo()` - Display include fields information
  - `cropAndPad()` - Format string to fixed width
  - `formatStatusColumn()` - Format status column
  - `formatShopColumn()` - Format shop column
  - `applyColorIfDisabled()` - Apply formatting based on state
  - Other CLI display and formatting utilities

#### `cli/deployment.js`
- Purpose: Deployment management (CLI-only)
- Functions:
  - `handleCloudflareDeployment()` - Handle Cloudflare deployment
  - Other deployment-related utilities

### 5. Worker-Specific Modules

#### `worker/runner.js`
- Purpose: Worker-specific job execution functionality
- Functions:
  - Worker-specific job execution logic
  - Webhook request handling

#### `worker/response.js`
- Purpose: Worker-specific response handling
- Functions:
  - Functionality for creating and sending responses from the worker

### 6. Shared Utilities (Environment-Agnostic)

#### `security/hmac.js`
- Purpose: Security-related functions (environment-agnostic)
- Functions:
  - `generateHmacSignature()` - Generate HMAC signature for webhook payload (environment-specific implementations with same interface)
  - `verifyShopifyWebhook()` - Verify Shopify webhook signature

#### `webhooks/helpers.js`
- Purpose: Webhook utility functions (environment-agnostic)
- Functions:
  - `convertToGraphqlTopic()` - Convert webhook topic to GraphQL format
  - `createWebhookUrl()` - Create webhook URL for a job
  - `getFullWebhookId()` - Get full webhook ID
  - Other webhook-specific utilities that are shared between environments

## Environment-Specific Considerations

### CLI vs Worker Environment

- CLI-specific code is now clearly organized under the `cli/` directory
- Worker-specific code is organized under the `worker/` directory
- Core functionality shared by both environments is in the `core/`, `shopify/`, and other environment-agnostic directories

The refactoring clearly separates:
1. **CLI-only code**: In the `cli/` directory
2. **Worker-only code**: In the `worker/` directory
3. **Environment-agnostic code**: In `core/`, `shopify/`, `security/`, etc.

## Implementation Strategy

1. Create the directory structure
2. Move functions to their respective modules
3. Update imports in all files
4. Add index.js files for each directory to simplify imports
5. Update all code that uses these utilities

## Benefits

- **Logical organization**: Functions are grouped by purpose and environment
- **Environment clarity**: Clear separation between CLI and Worker code
- **Better code organization**: Related utilities are together
- **Simplified imports**: Easier to find and use utilities
- **Better scalability**: Easier to add new functionality
- **Improved maintainability**: Clearer responsibility boundaries

## Responses to Updated Questions

1. **findSampleRecordForJob and runJobTest only happen in the CLI**
   - Agreed. These have been moved to `cli/runner.js` to clarify they are CLI-only

2. **cli/display and cli/formatting seem similar**
   - Agreed. These have been consolidated into a single `cli/ui.js` file to handle all CLI formatting and display

3. **Should CLI-specific stuff be in a top-level directory and same for worker?**
   - Implemented. All CLI-specific code is now in the `cli/` directory and worker-specific code in the `worker/` directory

4. **I'd rather have the CLI job runner under cli and worker runner under worker/**
   - Implemented. The execution directory has been removed, with CLI-specific execution in `cli/runner.js` and worker-specific execution in `worker/runner.js`

5. **We can put logger in core**
   - Agreed. Logger is a fundamental utility used across environments, so it's been moved to `core/logger.js`
