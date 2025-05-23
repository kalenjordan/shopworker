export default `#graphql
mutation OrderUpdate($input: OrderInput!) {
  orderUpdate(input: $input) {
    order {
      id
      name
      tags
    }
    userErrors {
      field
      message
    }
  }
}
`;
