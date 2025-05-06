export default `#graphql
query GetRecentCustomers($first: Int!, $query: String) {
  customers(first: $first, sortKey: UPDATED_AT, reverse: true, query: $query) {
    edges {
      node {
        id
        admin_graphql_api_id: id
        firstName
        lastName
        email
        phone
        createdAt
        updatedAt
        defaultAddress {
          id
          admin_graphql_api_id: id
          address1
          address2
          city
          province
          country
          zip
          phone
        }
      }
    }
  }
}
`;
