import GetRecentProducts from "../../graphql/GetRecentProducts.js";
import GetRecentCustomers from "../../graphql/GetRecentCustomers.js";

export const run = async (props) => {
  const {
    admin,
    logger
  } = props;

  // Log the start of the job
  logger.info("Starting order creation job");

  // Fetch recent customers
  logger.info("Fetching recent customers");
  const customersResponse = await admin.graphql(GetRecentCustomers, {
    variables: {
      first: 10,
      query: "status:active"
    }
  });

  const customersData = await customersResponse.json();
  const customers = customersData.data.customers.edges;

  if (!customers || customers.length === 0) {
    throw new Error("No active customers found");
  }

  // Use the first customer
  const customer = customers[0].node;
  logger.info(`Selected customer: ${customer.firstName} ${customer.lastName} (${customer.email})`);

  // Fetch recent products
  logger.info("Fetching recent products");
  const productsResponse = await admin.graphql(GetRecentProducts, {
    variables: {
      first: 10,
      query: "status:active"
    }
  });

  const productsData = await productsResponse.json();
  const products = productsData.data.products.edges;

  if (!products || products.length === 0 || !products[0].node.variants.edges.length) {
    throw new Error("No active products with variants found");
  }

  // Use the first product and its first variant
  const product = products[0].node;
  const variant = product.variants.edges[0].node;

  logger.info(`Selected product: ${product.title}, variant: ${variant.id}, price: ${variant.price}`);

  // Default quantity
  const quantity = 1;

  // Get the shipping address - use defaultAddress only
  const shippingAddress = customer.defaultAddress;

  if (!shippingAddress) {
    throw new Error(`Customer ${customer.id} has no valid shipping address`);
  }

  // Create the order
  logger.info("Creating order");
  const orderResponse = await admin.graphql(`
    mutation CreateOrder($input: OrderInput!) {
      orderCreate(input: $input) {
        order {
          id
          name
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `, {
    variables: {
      input: {
        customerId: customer.id,
        email: customer.email,
        shippingAddress: shippingAddress,
        billingAddress: shippingAddress,
        lineItems: [
          {
            variantId: variant.id,
            quantity: quantity
          }
        ]
      }
    }
  });

  const orderData = await orderResponse.json();
  const order = orderData.data.orderCreate.order;

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
