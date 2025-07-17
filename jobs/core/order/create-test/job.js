import GetRecentProducts from "../../../../graphql/GetRecentProducts.js";
import GetRecentCustomers from "../../../../graphql/GetRecentCustomers.js";
import CreateOrder from "../../../../graphql/CreateOrder.js";

/**
 * Creates an order with a random customer and product
 * @param {Object} params - Parameters for the job
 * @param {Object} params.data - Trigger data (not used in this job)
 * @param {Object} params.shopify - Shopify API client
 * @param {Object} [params.env] - Environment variables (not used by this job)
 */
export async function process({ shopify }) {
  // Log the start of the job
  console.log("Starting order creation job");

  // Use destructured 'shopify' client
  const customersResponse = await shopify.graphql(GetRecentCustomers, {
      first: 10,
      query: "status:active"
  });

  // Basic error/null check
  if (!customersResponse?.customers?.edges) {
    console.error("Unexpected response fetching customers:", customersResponse);
    throw new Error("Could not fetch customers or response format is incorrect.");
  }
  const customers = customersResponse.customers.edges;

  if (customers.length === 0) {
    throw new Error("No active customers found");
  }

  // Use the first customer
  const customer = customers[0].node;
  console.log(`Selected customer: ${customer.firstName} ${customer.lastName} (${customer.email})`);

  const productsResponse = await shopify.graphql(GetRecentProducts, {
      first: 10,
      query: "status:active"
  });

  // Basic error/null check
  if (!productsResponse?.products?.edges) {
    console.error("Unexpected response fetching products:", productsResponse);
    throw new Error("Could not fetch products or response format is incorrect.");
  }
  const products = productsResponse.products.edges;

  if (products.length === 0) {
    throw new Error("No active products found");
  }

  // Find a product with a price greater than zero and available variant
  const productWithPrice = products.find(edge =>
    edge?.node?.variants?.edges?.[0]?.node?.price &&
    parseFloat(edge.node.variants.edges[0].node.price) > 0
  );

  if (!productWithPrice) {
    throw new Error("No active products found with a valid variant price greater than zero");
  }

  // Use the first product and its first variant
  const product = productWithPrice.node;
  const variant = product.variants.edges[0].node;

  console.log(`Selected product: ${product.title}, variant: ${variant.id}, price: ${variant.price}`);

  // Default quantity
  const quantity = 1;

  // Get the shipping address - use defaultAddress only
  const shippingAddress = customer.defaultAddress;

  if (!shippingAddress) {
    throw new Error(`Customer ${customer.id} has no valid default shipping address`);
  }

  // Prepare address in the format expected by the API
  const formattedAddress = {
    address1: shippingAddress.address1,
    address2: shippingAddress.address2,
    city: shippingAddress.city,
    company: shippingAddress.company,
    firstName: customer.firstName,
    lastName: customer.lastName,
    phone: shippingAddress.phone,
    province: shippingAddress.province,
    zip: shippingAddress.zip,
    country: shippingAddress.country
  };

  // Create the order
  console.log("Creating order");
  const orderResponse = await shopify.graphql(CreateOrder, {
    order: {
      customerId: shopify.toGid(customer.id, 'Customer'),
      email: customer.email,
      shippingAddress: formattedAddress,
      billingAddress: formattedAddress,
      lineItems: [
        {
          variantId: shopify.toGid(variant.id, 'ProductVariant'),
          quantity: quantity
        }
      ]
    }
  });

  // Basic error/null check for order creation
  if (!orderResponse?.orderCreate?.order) {
    console.error("Unexpected response creating order:", orderResponse);
    // Include user errors if available
    const userErrors = orderResponse?.orderCreate?.userErrors;
    const errorMsg = userErrors && userErrors.length > 0 ? userErrors.map(e => e.message).join(', ') : "Unknown error or unexpected response format.";
    throw new Error(`Could not create order: ${errorMsg}`);
  }

  const order = orderResponse.orderCreate.order;

  console.log(`Order created successfully: ${order.name}`);

  return {
    success: true,
    message: `Order ${order.name} created successfully for customer ${customer.firstName} ${customer.lastName} with product ${product.title}`,
    orderId: order.id,
    orderName: order.name,
    customer: {
      id: shopify.toGid(customer.id, 'Customer'),
      name: `${customer.firstName} ${customer.lastName}`,
      email: customer.email
    },
    product: {
      id: shopify.toGid(product.id, 'Product'),
      title: product.title,
      variant: shopify.toGid(variant.id, 'ProductVariant'),
      price: variant.price
    }
  };
}
