import GetRecentProducts from "../../graphql/GetRecentProducts.js";
import GetRecentCustomers from "../../graphql/GetRecentCustomers.js";
import OrderCreate from "../../graphql/OrderCreate.js";

export const run = async (props) => {
  const {
    admin,
    logger
  } = props;

  // Log the start of the job
  logger.info("Starting order creation job");

  const customersResponse = await admin.graphql(GetRecentCustomers, {
      first: 10,
      query: "status:active"
  });

  const customersData = await customersResponse.json();
  const customers = customersData.customers.edges;

  if (!customers || customers.length === 0) {
    throw new Error("No active customers found");
  }

  // Use the first customer
  const customer = customers[0].node;
  logger.info(`Selected customer: ${customer.firstName} ${customer.lastName} (${customer.email})`);

  const productsResponse = await admin.graphql(GetRecentProducts, {
      first: 10,
      query: "status:active"
  });

  const productsData = await productsResponse.json();
  const products = productsData.products.edges;

  if (!products || products.length === 0 || !products[0].node.variants.edges.length) {
    throw new Error("No active products with variants found");
  }

  // Find a product with a price greater than zero
  const productWithPrice = products.find(product => {
    const variant = product.node.variants.edges[0].node;
    return variant && parseFloat(variant.price) > 0;
  });

  if (!productWithPrice) {
    throw new Error("No products found with price greater than zero");
  }

  // Use the first product and its first variant
  const product = productWithPrice.node;
  const variant = product.variants.edges[0].node;

  logger.info(`Selected product: ${product.title}, variant: ${variant.id}, price: ${variant.price}`);

  // Default quantity
  const quantity = 1;

  // Get the shipping address - use defaultAddress only
  const shippingAddress = customer.defaultAddress;

  if (!shippingAddress) {
    throw new Error(`Customer ${customer.id} has no valid shipping address`);
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
  logger.info("Creating order");
  const orderResponse = await admin.graphql(OrderCreate, {
    order: {
      customerId: customer.admin_graphql_api_id,
      email: customer.email,
      shippingAddress: formattedAddress,
      billingAddress: formattedAddress,
      lineItems: [
        {
          variantId: variant.admin_graphql_api_id,
          quantity: quantity
        }
      ]
    }
  });

  const orderData = await orderResponse.json();
  const order = orderData.orderCreate.order;

  logger.info(`Order created successfully: ${order.name}`);

  return {
    success: true,
    message: `Order ${order.name} created successfully for customer ${customer.firstName} ${customer.lastName} with product ${product.title}`,
    orderId: order.id,
    orderName: order.name,
    customer: {
      id: customer.id,
      name: `${customer.firstName} ${customer.lastName}`,
      email: customer.email
    },
    product: {
      id: product.id,
      title: product.title,
      variant: variant.id,
      price: variant.price
    }
  };
};
