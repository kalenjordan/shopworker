export default `#graphql
  mutation orderInvoiceSend($orderId: ID!, $customMessage: String) {
    orderInvoiceSend(id: $orderId, email: {
      customMessage: $customMessage
    }) {
      order {
        id
      }
      userErrors {
        message
      }
    }
  }
`;
