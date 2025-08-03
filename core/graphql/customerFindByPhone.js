export default `#graphql
  query FindCustomerByPhone($phone: String!) {
    customers(first: 1, query: $phone) {
      nodes {
        id: legacyResourceId
      }
    }
  }
`;
