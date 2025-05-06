#!/usr/bin/env node

/**
 * Test script to simulate a Shopify webhook for product creation
 * Run with: node test-product-created-webhook.js
 */

// Configuration - Change these values to match your setup
const WORKER_URL = "https://shopworker-kalen-test-store.kalenjordan.workers.dev";
const JOB_NAME = "product-created-metafield"; // Change to your job name
const SHOP_DOMAIN = "kalen-test-store.myshopify.com"; // Change to your shop domain
const WEBHOOK_TOPIC = "products/create"; // Change to match your trigger

async function main() {
  try {
    // Create webhook URL with job parameter
    const webhookUrl = new URL(WORKER_URL);
    webhookUrl.searchParams.set("job", JOB_NAME);
    const webhookAddress = webhookUrl.toString();

    console.log(`Simulating webhook request`);
    console.log(`Job: ${JOB_NAME}`);
    console.log(`Topic: ${WEBHOOK_TOPIC}`);
    console.log(`Worker URL: ${webhookAddress}`);

    // Create sample product payload
    const payload = {
      id: "8126033625274",
      title: "Rustic Mirror",
      handle: "rustic-mirror",
      createdAt: "2025-05-06T15:33:48Z",
      updatedAt: "2025-05-06T15:33:50Z",
      status: "ACTIVE",
      tags: [],
      productType: "Lighting",
      vendor: "Shopify Worker",
      variants: {
        edges: [
          {
            node: {
              id: "gid://shopify/ProductVariant/44815839428794",
              sku: "",
              price: "0.00",
              inventoryQuantity: 0,
            },
          },
        ],
      },
      images: {
        edges: [],
      },
    };

    // Prepare the request body
    const payloadText = JSON.stringify(payload);

    // Prepare headers
    const headers = {
      "Content-Type": "application/json",
      "X-Shopify-Topic": WEBHOOK_TOPIC,
      "X-Shopify-Shop-Domain": SHOP_DOMAIN,
      "X-Shopify-API-Version": "2024-07",
      "X-Shopify-Hmac-Sha256": "dummy-signature",
    };

    console.log("\nSending request...");

    // Send the webhook request
    const response = await fetch(webhookAddress, {
      method: "POST",
      headers: headers,
      body: payloadText,
    });

    // Log response
    const responseText = await response.text();
    console.log(`\nResponse Status: ${response.status} ${response.statusText}`);
    console.log(`Response Body: ${responseText}`);

    if (response.ok) {
      console.log("\nWebhook test completed successfully!");
    } else {
      console.error("\nWebhook test failed!");
    }
  } catch (error) {
    console.error("Error testing webhook:", error);
  }
}

// Run the script
main();
