export async function process({ shopify, payload, shopConfig, jobConfig, env, secrets, step }) {
  console.log("Hello world");

  // Example: Use step.do() for atomic operations
  const shopInfo = await step.do("fetch-shop-info", async () => {
    const query = `{
      shop {
        name
        email
        myshopifyDomain
      }
    }`;

    const response = await shopify.graphql(query);
    return response.shop;
  });

  console.log(`Processing job for shop: ${shopInfo.name}`);
  console.log(`Shop domain: ${shopInfo.myshopifyDomain}`);

  // Your custom logic here

  return {
    success: true,
    message: `Hello world from ${shopInfo.name}!`
  };
}
