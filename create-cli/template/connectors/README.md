# Connectors

This directory is for account-specific connector implementations.

## What are Connectors?

Connectors integrate Shopworker with external services and APIs. They provide reusable interfaces for:
- External APIs (REST, GraphQL, etc.)
- Databases
- Message queues
- File storage services
- Third-party platforms

## Examples

For examples of connector implementations, see the main Shopworker repository:
- `shopworker-main/core/connectors/`

## Creating Custom Connectors

To create a custom connector:

1. Create a new directory with your connector name
2. Add a `connector.js` file with your implementation
3. Export a class or object with standard methods

Example structure:
```
connectors/
  my-api-connector/
    connector.js
    README.md
```

Example connector:
```javascript
// connectors/my-api-connector/connector.js
export class MyAPIConnector {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
  }
  
  async fetchData(endpoint) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      }
    });
    return response.json();
  }
}
```