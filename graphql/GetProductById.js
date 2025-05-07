export default `#graphql
query GetProductById($id: ID!) {
  product(id: $id) {
    id
    legacyResourceId
    title
    handle
    descriptionHtml
    createdAt
    updatedAt
    status
    tags
    productType
    vendor
    totalInventory
    variants(first: 10) {
      edges {
        node {
          id
          sku
          price
          compareAtPrice
          inventoryQuantity
          title
          barcode
        }
      }
    }
    images(first: 5) {
      edges {
        node {
          id
          url
          altText
        }
      }
    }
  }
}
`;
