export default `#graphql
  query FindVariantBySku($sku: String!) {
    productVariants(first: 1, query: $sku) {
      nodes {
        id: legacyResourceId
        sku
        price
        product {
          id: legacyResourceId
        }
        selectedOptions {
          name
          value
        }
      }
    }
  }
`;
