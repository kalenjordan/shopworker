export default `#graphql
  mutation CreateOrder($input: OrderInput!) {
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
