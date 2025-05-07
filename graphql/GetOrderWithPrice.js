export default `#graphql
query GetOrderWithPrice($id: ID!) {
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
    lineItems(first: 10) {
      edges {
        node {
          id
          title
          quantity
          variant {
            id
            title
            price
          }
        }
      }
    }
  }
}
`;
