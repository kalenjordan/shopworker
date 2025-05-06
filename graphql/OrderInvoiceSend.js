export default `#graphql
  mutation InvoiceSendMutation($orderId: ID!, $customMessage: String) {
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
