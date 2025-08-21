export default `
  mutation tagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node {
        id
        ... on Order {
          name
          tags
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;