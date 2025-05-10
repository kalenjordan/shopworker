export default `#graphql
query GetOrdersForBackfill($first: Int!, $query: String) {
  orders(first: $first, sortKey: CREATED_AT, reverse: false, query: $query) {
    edges {
      node {
        id
        name
        email
        phone
        createdAt
        displayFinancialStatus
        displayFulfillmentStatus
        totalPrice
        subtotalPrice
        totalTax
        totalDiscounts
        currencyCode
        note
        customer {
          id
          email
          firstName
          lastName
        }
        shippingAddress {
          firstName
          lastName
          company
          address1
          address2
          city
          zip
          country
          phone
        }
        tags
        lineItems(first: 50) {
          edges {
            node {
              id
              title
              quantity
              variant {
                id
                title
                sku
                price
              }
            }
          }
        }
        fulfillments(first: 1) {
          trackingInfo {
            number
            url
          }
        }
      }
    }
  }
}
`;
