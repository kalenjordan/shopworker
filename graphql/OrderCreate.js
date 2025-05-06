export default `#graphql
mutation orderCreate($order: OrderCreateOrderInput!) {
  orderCreate(order: $order) {
    order {
      id
      name
      totalPriceSet {
        shopMoney {
          amount
          currencyCode
        }
      }
    }
    userErrors {
      field
      message
    }
  }
}
`;
