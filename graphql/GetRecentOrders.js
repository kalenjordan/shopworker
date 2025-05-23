export default `#graphql
query GetRecentOrders($first: Int!, $query: String) {
  orders(first: $first, sortKey: CREATED_AT, reverse: true, query: $query) {
    edges {
      node {
        id
        name
        createdAt
        tags
        customer {
          id
          email
          tags
        }
        lineItems(first: 50) {
          edges {
            node {
              id
              sku
              name
              variant {
                id
                sku
                product {
                  id
                }
              }
            }
          }
        }
      }
    }
  }
}
`;
