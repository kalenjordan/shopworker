export default `#graphql
query GetRecentProducts($first: Int!, $query: String) {
  products(first: $first, sortKey: UPDATED_AT, reverse: true, query: $query) {
    edges {
      node {
        id: legacyResourceId
        admin_graphql_api_id: id
        title
        handle
        createdAt
        updatedAt
        status
        tags
        productType
        vendor
        variants(first: 10) {
          edges {
            node {
              id
              sku
              price
              inventoryQuantity
            }
          }
        }
        images(first: 1) {
          edges {
            node {
              id
              url
            }
          }
        }
      }
    }
  }
}
`;
