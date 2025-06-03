export default `#graphql
  mutation CreateOrder($input: OrderCreateOrderInput!) {
    orderCreate(order: $input) {
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
