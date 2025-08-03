export default `#graphql
query GetProductsPage($first: Int!, $after: String) {
  products(first: $first, after: $after) {
    edges {
      node {
        id: legacyResourceId
        admin_graphql_api_id: id
        title
        handle
        status
        createdAt
        updatedAt
      }
      cursor
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;