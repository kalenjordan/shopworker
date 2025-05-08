/**
 * GraphQL query to fetch webhook subscriptions
 */
export default `
  query getWebhooks($first: Int) {
    webhookSubscriptions(first: $first) {
      nodes {
        id
        topic
        includeFields
        endpoint {
          __typename
          ... on WebhookHttpEndpoint {
            callbackUrl
          }
        }
        createdAt
      }
    }
  }
`;
