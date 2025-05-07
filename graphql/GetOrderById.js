export default `#graphql
query GetOrderById($id: ID!) {
  order(id: $id) {
    id
    name
    email
    phone
    createdAt
    displayFinancialStatus
    displayFulfillmentStatus
    totalPrice # This is a Money scalar, representing the original total
    subtotalPrice
    totalTax
    totalDiscounts
    currencyCode # The currency code for scalar money fields like totalPrice
    currentTotalPriceSet {
      presentmentMoney {
        amount
        currencyCode
      }
      shopMoney {
        amount
        currencyCode
      }
    }
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
    lineItems(first: 10) {
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
`;
