import { fetchSalesforceCustomers } from "../../../connectors/salesforce.js";

/**
 * Fetch customers from Salesforce and display them
 * @param {Object} params - Parameters for the job
 * @param {Object} params.payload - The payload data (empty for manual trigger)
 * @param {Object} params.shopify - Shopify API client (not used in this job)
 * @param {Object} params.env - Environment variables containing Salesforce credentials
 */
export async function process({ payload, shopify, env }) {
  console.log('🔄 Starting Salesforce customer fetch...');

  // Extract Salesforce credentials from environment
  const salesforceAuth = {
    clientId: env.SALESFORCE_CLIENT_ID,
    clientSecret: env.SALESFORCE_CLIENT_SECRET,
    username: env.SALESFORCE_USERNAME,
    password: env.SALESFORCE_PASSWORD,
    instanceUrl: env.SALESFORCE_INSTANCE_URL
  };

  // Check if all required credentials are present
  const missingCredentials = [];
  if (!salesforceAuth.clientId) missingCredentials.push('SALESFORCE_CLIENT_ID');
  if (!salesforceAuth.clientSecret) missingCredentials.push('SALESFORCE_CLIENT_SECRET');
  if (!salesforceAuth.username) missingCredentials.push('SALESFORCE_USERNAME');
  if (!salesforceAuth.password) missingCredentials.push('SALESFORCE_PASSWORD');
  if (!salesforceAuth.instanceUrl) missingCredentials.push('SALESFORCE_INSTANCE_URL');

  if (missingCredentials.length > 0) {
    throw new Error(`Missing required Salesforce environment variables: ${missingCredentials.join(', ')}`);
  }

  try {
    // Fetch customers with options
    const options = {
      limit: 50, // Fetch up to 50 customers
      orderBy: 'CreatedDate DESC',
      // Optional: Add WHERE clause to filter customers
      // where: "Type = 'Customer'"
    };

    console.log('📡 Fetching customers from Salesforce...');
    const customers = await fetchSalesforceCustomers(salesforceAuth, options);

    console.log(`✅ Successfully fetched ${customers.length} customers from Salesforce`);

    // Display customer information
    if (customers.length > 0) {
      console.log('\n📋 Customer Details:');
      console.log('==================');

      customers.forEach((customer, index) => {
        console.log(`\n${index + 1}. ${customer.Name}`);
        console.log(`   ID: ${customer.Id}`);
        console.log(`   Type: ${customer.Type || 'N/A'}`);
        console.log(`   Industry: ${customer.Industry || 'N/A'}`);
        console.log(`   Phone: ${customer.Phone || 'N/A'}`);
        console.log(`   Website: ${customer.Website || 'N/A'}`);
        console.log(`   Created: ${customer.CreatedDate}`);

        if (customer.BillingAddress) {
          const billing = customer.BillingAddress;
          const address = [billing.street, billing.city, billing.state, billing.postalCode, billing.country]
            .filter(Boolean)
            .join(', ');
          if (address) {
            console.log(`   Billing Address: ${address}`);
          }
        }
      });
    } else {
      console.log('ℹ️  No customers found matching the criteria');
    }

    return {
      success: true,
      customerCount: customers.length,
      customers: customers
    };

  } catch (error) {
    console.error('❌ Error fetching Salesforce customers:', error.message);
    throw error;
  }
}
