# Web Request Example - Real-time Job Example

This is an example job that demonstrates how to use ShopWorker's new **webrequest** trigger type for real-time webhook processing.

## Key Features

- **Synchronous execution** - Returns immediate responses to webhook senders
- **No workflow steps** - All processing happens directly in the main function
- **Custom HTTP responses** - Control status codes, headers, and response body
- **Real-time processing** - Perfect for webhook transformations and validations

## How It Works

Unlike regular ShopWorker jobs that run asynchronously in workflows, webrequest jobs:

1. Execute immediately when the webhook is received
2. Process the payload synchronously
3. Return a response that becomes the HTTP response to the webhook sender
4. Do not use `step.do()` - all operations must complete in a single execution

## Response Format

Jobs can return responses in two formats:

### Simple Format
```javascript
return {
  success: true,
  message: "Processing complete",
  data: transformedData
};
```

### Advanced Format (with HTTP control)
```javascript
return {
  statusCode: 200,
  headers: {
    "Custom-Header": "value"
  },
  body: {
    success: true,
    data: result
  }
};
```

## Use Cases

- **Webhook Proxies** - Transform payloads for third-party systems
- **Validation Endpoints** - Validate data and return immediate feedback
- **Real-time Analytics** - Process and forward data to analytics systems
- **Custom Acknowledgments** - Send custom responses to webhook senders

## Limitations

- **No durable execution** - Operations cannot be retried if they fail
- **Response time limits** - Must complete within Cloudflare Worker timeout limits
- **No workflow steps** - Cannot use `step.do()` for atomic operations
- **Synchronous only** - All operations must complete in a single execution

## Testing

To test this job:

1. Deploy it using the ShopWorker CLI
2. Send a webhook request to the endpoint with `?job=core/jobs/webrequest-example`
3. The response will be the transformed payload with processing metadata

## Creating Your Own Real-time Jobs

1. Set `"trigger": "webrequest"` in your `config.json`
2. Remove any `step.do()` calls from your job logic
3. Return a response object that will become the HTTP response
4. Handle errors gracefully and return appropriate status codes