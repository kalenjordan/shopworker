export default `#graphql
mutation OrderMetafieldUpdate($input: OrderInput!) {
  orderUpdate(input: $input) {
    order {
      id
      name
      metafields(first: 250, namespace: "custom") {
        edges {
          node {
            id
            namespace
            key
            value
          }
        }
      }
    }
    userErrors {
      field
      message
    }
  }
}
`;
