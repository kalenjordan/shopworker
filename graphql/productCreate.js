/**
 * GraphQL mutation to create a product
 */
export default `
  mutation productCreate($input: ProductInput!) {
    productCreate(input: $input) {
      product {
        id
        title
        handle
        descriptionHtml
        status
        createdAt
      }
      userErrors {
        field
        message
      }
    }
  }
`;
