export default `#graphql
  query FindOrdersByTag($tag: String!) {
    orders(first: 1, query: $tag) {
      nodes {
        id: legacyResourceId
      }
    }
  }
`;
