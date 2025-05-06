export default `#graphql
query getOrder($id: ID!) {
  order(id: $id) {
    id
    name
    createdAt
    customer {
      id
      email
    }
    lineItems(first: 10) {
      edges {
        node {
          id
          title
          quantity
          variant {
            id
            title
            price
          }
        }
      }
    }
  }
}
`;
