export default `#graphql
  query FindCustomerByTag($tag: String!) {
    customers(first: 1, query: $tag) {
      nodes {
        id: legacyResourceId
        firstName
        lastName
        tags
      }
    }
  }
`;
