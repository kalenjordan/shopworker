export default `#graphql
  mutation AddCustomerTags($customerId: ID!, $tags: [String!]!) {
    tagsAdd(id: $customerId, tags: $tags) {
      userErrors {
        field
        message
      }
    }
  }
`;
