import chalk from 'chalk';
import { getShopDomain } from '../../shared/config-helpers.js';
import { createShopifyClient } from '../../shared/shopify.js';

const GET_WEBHOOKS_QUERY = `
  query {
    webhookSubscriptions(first: 100) {
      nodes {
        id
        topic
        endpoint {
          __typename
          ... on WebhookHttpEndpoint {
            callbackUrl
          }
        }
        includeFields
        metafieldNamespaces
        createdAt
        updatedAt
      }
    }
  }
`;

export function registerWebhooksCommand(program, projectRoot) {
  program
    .command('webhook:list')
    .description('List all webhooks registered in Shopify for troubleshooting')
    .option('-s, --shop <shopDomain>', 'Specify a shop domain to check webhooks for')
    .option('-v, --verbose', 'Show detailed webhook information including fields')
    .action(async (options) => {
      try {
        // Get shop domain
        let shopDomain;
        try {
          shopDomain = getShopDomain(projectRoot, options.shop);
        } catch (error) {
          console.error('Error: Could not determine shop domain. Use -s option to specify.');
          return;
        }

        console.log(chalk.magenta(`Shop: ${shopDomain}`));
        console.log('Fetching all webhooks...\n');

        // Load shop configuration from .shopworker.json for access token
        const fs = await import('fs');
        const path = await import('path');
        const shopworkerFilePath = path.join(projectRoot, '.shopworker.json');
        
        if (!fs.existsSync(shopworkerFilePath)) {
          console.error('Error: .shopworker.json file not found. Please create one.');
          return;
        }
        
        const shopworkerFileContent = fs.readFileSync(shopworkerFilePath, 'utf8');
        const shopworkerData = JSON.parse(shopworkerFileContent);
        
        // Initialize Shopify client with proper configuration
        const shopifyConfig = {
          shop: shopDomain,
          accessToken: shopworkerData.shopify_token,
          apiVersion: process.env.SHOPIFY_API_VERSION || '2025-04'
        };

        const shopify = createShopifyClient(shopifyConfig);

        // Fetch webhooks
        const response = await shopify.graphql(GET_WEBHOOKS_QUERY);

        if (!response.webhookSubscriptions?.nodes) {
          console.log(chalk.yellow('No webhooks found or unable to fetch webhooks.'));
          return;
        }

        const webhooks = response.webhookSubscriptions.nodes;

        if (webhooks.length === 0) {
          console.log(chalk.yellow('No webhooks registered for this shop.'));
          return;
        }

        console.log(chalk.cyan(`Found ${webhooks.length} webhook(s):\n`));

        // Display webhooks
        webhooks.forEach((webhook, index) => {
          const topic = webhook.topic ? webhook.topic.replace(/_/g, '/') : 'UNKNOWN';
          console.log(chalk.bold(`${index + 1}. ${topic}`));
          console.log(`   ID: ${webhook.id ? webhook.id.split('/').pop() : 'N/A'}`);
          
          if (webhook.endpoint?.__typename === 'WebhookHttpEndpoint') {
            console.log(`   URL: ${webhook.endpoint.callbackUrl}`);
            
            // Try to extract job from URL
            try {
              const url = new URL(webhook.endpoint.callbackUrl);
              const jobParam = url.searchParams.get('job');
              if (jobParam) {
                console.log(`   Job: ${chalk.green(jobParam)}`);
              }
            } catch (e) {
              // Ignore URL parsing errors
            }
          }
          
          if (options.verbose) {
            if (webhook.includeFields && webhook.includeFields.length > 0) {
              console.log(`   Fields: ${webhook.includeFields.join(', ')}`);
            }
            if (webhook.metafieldNamespaces && webhook.metafieldNamespaces.length > 0) {
              console.log(`   Metafields: ${webhook.metafieldNamespaces.join(', ')}`);
            }
          }
          
          console.log(`   Created: ${webhook.createdAt ? new Date(webhook.createdAt).toLocaleString() : 'N/A'}`);
          console.log(`   Updated: ${webhook.updatedAt ? new Date(webhook.updatedAt).toLocaleString() : 'N/A'}`);
          console.log();
        });

        // Show summary
        const topicCounts = {};
        webhooks.forEach(webhook => {
          const topic = webhook.topic ? webhook.topic.replace(/_/g, '/') : 'UNKNOWN';
          topicCounts[topic] = (topicCounts[topic] || 0) + 1;
        });

        console.log(chalk.cyan('Summary by topic:'));
        Object.entries(topicCounts)
          .sort(([a], [b]) => a.localeCompare(b))
          .forEach(([topic, count]) => {
            console.log(`  ${topic}: ${count}`);
          });

      } catch (error) {
        console.error(chalk.red(`Error fetching webhooks: ${error.message}`));
        if (error.stack && process.env.DEBUG) {
          console.error(error.stack);
        }
      }
    });
}