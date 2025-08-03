# Hello World Job

This is a simple example job that demonstrates the basic structure of a Shopworker job.

## Testing

From this directory:
```bash
npm test
```

Or from the root directory:
```bash
npm run test -- hello-world
```

## Job Structure

- `config.json` - Defines the trigger type (manual, orders/create, products/update, etc.)
- `job.js` - Contains the `process()` function that executes the job logic

## Key Concepts

1. **Workflow Steps**: Use `step.do()` for atomic, retriable operations
2. **GraphQL API**: Access Shopify data via `shopify.graphql()`
3. **Secrets**: Access sensitive data via the `secrets` object
4. **Payload**: Webhook data is available in the `payload` object