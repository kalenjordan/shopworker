export default `#graphql
query GetOrderWithMetafields($id: ID!) {
  order(id: $id) {
    id
    name
    email
    note
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
}
`;
