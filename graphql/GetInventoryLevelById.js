export default `#graphql
  query GetInventoryLevelById($id: ID!) {
    inventoryLevel(id: $id) {
      id
      available
      incoming
      committed
      damaged
      onHand
      reserved
      safetyStock
      updatedAt
      item {
        id
        sku
        unitCost {
          amount
        }
        variant {
          id
          displayName
          price
          product {
            id
            title
            handle
          }
        }
      }
      location {
        id
        name
        address {
          address1
          city
          province
          country
          zip
        }
        isActive
      }
    }
  }
`;
