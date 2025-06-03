export default `#graphql
  query FindCustomerByEmail($email: String!) {
    customers(first: 1, query: $email) {
      nodes {
        id: legacyResourceId
      }
    }
  }
`;
