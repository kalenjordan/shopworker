/**
 * Salesforce connector for fetching customers and other Salesforce operations
 * Uses Salesforce REST API with OAuth 2.0 authentication
 */

/**
 * Get Salesforce access token using OAuth 2.0
 * @param {Object} auth - Salesforce authentication credentials
 * @param {string} auth.clientId - Salesforce Connected App Client ID
 * @param {string} auth.clientSecret - Salesforce Connected App Client Secret
 * @param {string} auth.username - Salesforce username
 * @param {string} auth.password - Salesforce password + security token
 * @param {string} auth.instanceUrl - Salesforce instance URL (e.g., https://yourorg.my.salesforce.com)
 * @returns {Promise<string>} Access token
 */
export async function getSalesforceAccessToken(auth) {
  const { clientId, clientSecret, username, password, instanceUrl } = auth;

  if (!clientId || !clientSecret || !username || !password || !instanceUrl) {
    throw new Error('Missing Salesforce credentials: clientId, clientSecret, username, password, and instanceUrl are required');
  }

  const tokenUrl = `${instanceUrl}/services/oauth2/token`;

  const params = new URLSearchParams({
    grant_type: 'password',
    client_id: clientId,
    client_secret: clientSecret,
    username: username,
    password: password
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Salesforce authentication failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const tokenData = await response.json();
  return tokenData.access_token;
}

/**
 * Fetch customers (Accounts) from Salesforce
 * @param {Object} auth - Salesforce authentication credentials
 * @param {Object} options - Query options
 * @param {number} [options.limit=100] - Maximum number of records to fetch
 * @param {string} [options.orderBy='CreatedDate DESC'] - Order by clause
 * @param {string} [options.where] - WHERE clause for filtering
 * @returns {Promise<Array>} Array of customer records
 */
export async function fetchSalesforceCustomers(auth, options = {}) {
  const { limit = 100, orderBy = 'CreatedDate DESC', where } = options;

  const accessToken = await getSalesforceAccessToken(auth);

  // Build SOQL query
  let soql = `SELECT Id, Name, Type, Industry, Phone, Website, BillingAddress, ShippingAddress, CreatedDate, LastModifiedDate FROM Account`;

  if (where) {
    soql += ` WHERE ${where}`;
  }

  soql += ` ORDER BY ${orderBy}`;
  soql += ` LIMIT ${limit}`;

  const queryUrl = `${auth.instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(soql)}`;

  const response = await fetch(queryUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Salesforce query failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  return data.records;
}

/**
 * Execute a custom SOQL query
 * @param {Object} auth - Salesforce authentication credentials
 * @param {string} soql - SOQL query string
 * @returns {Promise<Array>} Query results
 */
export async function executeSalesforceQuery(auth, soql) {
  const accessToken = await getSalesforceAccessToken(auth);

  const queryUrl = `${auth.instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(soql)}`;

  const response = await fetch(queryUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Salesforce query failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  return data.records;
}
