export default `#graphql
  query GetOrder($id: ID!) {
    order(id: $id) {
      id
      name
    }
  }
`;
