/**
 * Real-time webhook payload transformer
 * 
 * This job demonstrates how to process webhook payloads synchronously and return
 * immediate responses. It can be used for webhook transformations, validations,
 * or any scenario where you need to respond to the webhook sender immediately.
 * 
 * Key differences from regular jobs:
 * - No 'step' parameter - all operations must complete synchronously
 * - Return value becomes the HTTP response to the webhook sender
 * - Can control HTTP status code and headers
 * 
 * Use cases:
 * - Transform webhook payloads for third-party systems
 * - Validate webhook data and return errors immediately  
 * - Create webhook proxies or middleware
 * - Implement custom webhook acknowledgment logic
 * 
 * @param {Object} context - Job execution context
 * @param {Object} context.shopify - Shopify GraphQL client
 * @param {Object} context.payload - The webhook payload
 * @param {Object} context.shopConfig - Shop-specific configuration
 * @param {Object} context.jobConfig - Job configuration
 * @param {Object} context.env - Environment variables
 * @param {Object} context.secrets - Secret values
 * @returns {Object} Response object that will be sent as HTTP response
 */
export async function process({ shopify, payload, shopConfig, jobConfig, env, secrets }) {
  try {
    console.log(`Processing real-time webhook for shop: ${shopConfig.shopify_domain}`);
    
    // Example: Transform the payload
    const transformedPayload = {
      original: payload,
      transformed: {
        timestamp: new Date().toISOString(),
        shopDomain: shopConfig.shopify_domain,
        // Add your transformation logic here
        processedBy: "ShopWorker Real-time Processor"
      }
    };
    
    // Example: You could make Shopify API calls here (but be mindful of response time)
    // const shopInfo = await shopify.graphql(`{
    //   shop {
    //     name
    //     myshopifyDomain
    //   }
    // }`);
    
    // Return response object - this becomes the HTTP response
    return {
      statusCode: 200,
      headers: {
        "X-Processed-By": "ShopWorker",
        "X-Processing-Time": new Date().toISOString()
      },
      body: {
        success: true,
        message: "Payload processed successfully",
        data: transformedPayload
      }
    };
    
  } catch (error) {
    console.error("Error processing webhook:", error);
    
    // Return error response
    return {
      statusCode: 500,
      body: {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }
    };
  }
}