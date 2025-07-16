export default `#graphql
  query GetInventoryLevels($first: Int = 10) {
    inventoryLevels(first: $first) {
      edges {
        node {
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
    }
  }
`;
