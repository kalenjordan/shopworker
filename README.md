# Shopworker CLI

A CLI tool for working with Shopify orders and customers.

## Installation

1. Clone this repository
2. Create a `.env` file based on the `env.example` template
3. Install dependencies:
   ```
   npm install
   ```
4. Make the CLI executable:
   ```
   chmod +x cli.js
   ```
5. Link the CLI for global use:
   ```
   npm link
   ```

## Usage

### Test Command

The test command runs a job with a specific resource ID:

```
shopworker test <jobName> <resourceId>
```

Example:
```
shopworker test order-created-tag-skus 1234567890
```

This command:
1. Loads the job configuration from `jobs/<jobName>/config.json`
2. Finds the trigger associated with the job
3. Uses the test query specified in the trigger to fetch data from Shopify
4. Passes the data to the job for processing

### Testing from Job Directories

You can run tests directly from inside a job directory:

```
cd jobs/order-created-tag-skus
npm test
```

This will automatically detect the job from the directory name and run the test command.

You can also specify a resource ID:

```
cd jobs/order-created-tag-skus
npm test -- 9876543210
```

## Project Structure

### Jobs

Jobs are located in the `jobs/` directory. Each job has its own directory containing:
- `config.json`: Configuration including the trigger to use
- `job.js`: The actual job implementation

### Triggers

Triggers are defined in the `triggers/` directory as JSON files:
- `name`: Display name of the trigger
- `topic`: Shopify webhook topic
- `test`: Test configuration with query reference

### GraphQL Queries

GraphQL queries are stored in the `graphql/` directory and referenced by triggers.

## Environment Variables

- `SHOPIFY_API_KEY`: Your Shopify API key
- `SHOPIFY_API_SECRET`: Your Shopify API secret
- `SHOPIFY_ACCESS_TOKEN`: Your Shopify access token
- `SHOP`: Your shop URL (e.g., your-shop.myshopify.com)
