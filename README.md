# Shopworker CLI

A CLI tool for working with Shopify orders, using API version 2025-04.

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

The test command runs a job using the most recent data from Shopify:

```
shopworker test <jobName> [options]
```

Options:
- `-d, --dir <jobDirectory>`: Job directory name (used when running from project root)
- `-q, --query <queryString>`: Filter for the GraphQL query (e.g. `status:any`)

Example:
```
shopworker test order-created-tag-skus --query "created_at:>2023-01-01"
```

This command:
1. Loads the job configuration from `jobs/<jobName>/config.json`
2. Finds the trigger associated with the job
3. Uses the test query specified in the trigger to fetch the most recent data from Shopify
4. Passes the data to the job for processing

### Testing from Job Directories

You can run tests directly from inside a job directory:

```
cd jobs/order-created-tag-skus
npm test
```

This will automatically detect the job from the directory name and run the test command.

You can also add a query parameter:

```
cd jobs/order-created-tag-skus
npm test -- --query "status:any"
```

## Project Structure

### Jobs

Jobs are located in the `jobs/` directory. Each job has its own directory containing:
- `config.json`: Configuration including the trigger to use
- `job.js`: The actual job implementation

Example job: `order-created-tag-skus` - tags orders with the SKUs from their line items.

### Triggers

Triggers are defined in the `triggers/` directory as JSON files:
- `name`: Display name of the trigger
- `topic`: Shopify webhook topic
- `test`: Test configuration with GraphQL query reference

### GraphQL Queries

GraphQL queries are stored in the `graphql/` directory as JavaScript files that export the query string as a tagged template literal:
- `GetRecentOrders.js`: Query to get recent orders
- `GetOrderById.js`: Query to get a specific order by ID
- `OrderUpdate.js`: Mutation to update an order
- `CustomerUpdate.js`: Mutation to update a customer

Example format:
```javascript
export default `#graphql
query GetRecentOrders($first: Int!, $query: String) {
  orders(first: $first, sortKey: CREATED_AT, reverse: true, query: $query) {
    # Query fields...
  }
}
`;
```

These files are imported directly in the code where needed.

### Utilities

- `utils/graphql-utils.js`: Helper functions for loading GraphQL queries

## Environment Variables

- `SHOPIFY_ACCESS_TOKEN`: Your Shopify access token
- `SHOP`: Your shop URL (e.g., your-shop.myshopify.com)
