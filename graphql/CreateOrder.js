export default `#graphql
  mutation CreateOrder($input: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
    orderCreate(order: $input, options: $options) {
      order {
        id
        legacyResourceId
        name
      }
      userErrors {
        field
        message
      }
    }
  }
`;
