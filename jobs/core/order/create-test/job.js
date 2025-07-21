import GetRecentProducts from "../../../../graphql/GetRecentProducts.js";
import GetRecentCustomers from "../../../../graphql/GetRecentCustomers.js";
import CreateOrder from "../../../../graphql/CreateOrder.js";

/**
 * Creates an order with a random customer and product
 * This function is called by the JobDispatcher workflow
 */
export async function process({ shopify, step }) {
  return await processOrder(shopify, step);
}

async function processOrder(shopify, step) {
    // Step 1: Get recent customers
    const customers = await step.do("get-customers", async () => {
      console.log("Getting recent customers");
      
      const customersResponse = await shopify.graphql(GetRecentCustomers, {
        first: 10,
        query: "status:active"
      });

      if (!customersResponse?.customers?.edges) {
        console.error("Unexpected response fetching customers:", customersResponse);
        throw new Error("Could not fetch customers or response format is incorrect.");
      }
      
      const customerList = customersResponse.customers.edges;
      if (customerList.length === 0) {
        throw new Error("No active customers found");
      }

      return customerList;
    });

    // Step 2: Get recent products
    const products = await step.do("get-products", async () => {
      console.log("Getting recent products");
      
      const productsResponse = await shopify.graphql(GetRecentProducts, {
        first: 10,
        query: "status:active"
      });

      if (!productsResponse?.products?.edges) {
        console.error("Unexpected response fetching products:", productsResponse);
        throw new Error("Could not fetch products or response format is incorrect.");
      }
      
      const productList = productsResponse.products.edges;
      if (productList.length === 0) {
        throw new Error("No active products found");
      }

      return productList;
    });

    // Step 3: Select customer and product
    const { selectedCustomer, selectedProduct, selectedVariant } = await step.do("select-customer-and-product", async () => {
      const customer = customers[0].node;
      console.log(`Selected customer: ${customer.firstName} ${customer.lastName} (${customer.email})`);

      const productWithPrice = products.find(edge =>
        edge?.node?.variants?.edges?.[0]?.node?.price &&
        parseFloat(edge.node.variants.edges[0].node.price) > 0
      );

      if (!productWithPrice) {
        throw new Error("No active products found with a valid variant price greater than zero");
      }

      const product = productWithPrice.node;
      const variant = product.variants.edges[0].node;

      console.log(`Selected product: ${product.title}, variant: ${variant.id}, price: ${variant.price}`);

      return {
        selectedCustomer: customer,
        selectedProduct: product,
        selectedVariant: variant
      };
    });

    // Step 4: Create the order
    const orderResult = await step.do("create-order", async () => {
      const customer = selectedCustomer;
      const product = selectedProduct;
      const variant = selectedVariant;
      const quantity = 1;

      const shippingAddress = customer.defaultAddress;
      if (!shippingAddress) {
        throw new Error(`Customer ${customer.id} has no valid default shipping address`);
      }

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

      if (!orderResponse?.orderCreate?.order) {
        console.error("Unexpected response creating order:", orderResponse);
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
    });

    return orderResult;
  }