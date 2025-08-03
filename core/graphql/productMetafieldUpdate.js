export default `#graphql
mutation ProductMetafieldUpdate($input: ProductInput!) {
  productUpdate(input: $input) {
    product {
      id
      title
      metafields(first: 10) {
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
