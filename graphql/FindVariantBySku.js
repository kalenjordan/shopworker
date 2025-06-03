export default `#graphql
  query FindVariantBySku($sku: String!) {
    productVariants(first: 1, query: $sku) {
      nodes {
        id
        sku
        price
        product {
          id
        }
        selectedOptions {
          name
          value
        }
      }
    }
  }
`;
