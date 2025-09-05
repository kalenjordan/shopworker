# Triggers

This directory is for account-specific trigger definitions.

## What are Triggers?

Triggers define when jobs should run. They can be:
- Webhook-based (e.g., orders/create, products/update)
- Scheduled (cron jobs)
- Manual (triggered via API or CLI)

## Examples

For examples of trigger implementations, see the main Shopworker repository:
- `shopworker-main/core/triggers/`

Common webhook triggers include:
- `orders/create` - When an order is created
- `orders/updated` - When an order is updated
- `products/create` - When a product is created
- `products/update` - When a product is updated
- `customers/create` - When a customer is created

## Creating Custom Triggers

To create a custom trigger:

1. Create a new directory with your trigger name
2. Add a `config.json` file defining the trigger
3. Implement any custom logic in `trigger.js`

Example structure:
```
triggers/
  my-custom-trigger/
    config.json
    trigger.js
```