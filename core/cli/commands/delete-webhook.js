import { createShopifyClient } from '../../shared/shopify.js';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

async function deleteWebhook(shopify, webhookId) {
  const DELETE_WEBHOOK_MUTATION = `
    mutation deleteWebhook($id: ID!) {
      webhookSubscriptionDelete(id: $id) {
        deletedWebhookSubscriptionId
        userErrors {
          field
          message
        }
      }
    }
  `;

  const response = await shopify.graphql(DELETE_WEBHOOK_MUTATION, { id: webhookId });
  
  if (response.webhookSubscriptionDelete?.userErrors?.length > 0) {
    const errors = response.webhookSubscriptionDelete.userErrors;
    throw new Error(`Failed to delete webhook: ${errors.map(e => e.message).join(', ')}`);
  }
  
  return true;
}

function getFullWebhookId(webhookId) {
  // If the ID is already a full GID, return it
  if (webhookId.startsWith('gid://')) {
    return webhookId;
  }
  // Otherwise, construct the full GID
  return `gid://shopify/WebhookSubscription/${webhookId}`;
}

export function registerDeleteWebhookCommand(program, projectRoot) {
  program
    .command('delete-webhook')
    .description('Delete a webhook by its ID')
    .argument('<webhookId>', 'ID of the webhook to delete')
    .action(async (webhookId) => {
      try {
        // Load shop configuration from .shopworker.json
        const shopworkerFilePath = path.join(projectRoot, '.shopworker.json');
        if (!fs.existsSync(shopworkerFilePath)) {
          console.error('Error: .shopworker.json file not found. Please create one.');
          process.exit(1);
        }
        
        const shopworkerFileContent = fs.readFileSync(shopworkerFilePath, 'utf8');
        const shopworkerData = JSON.parse(shopworkerFileContent);
        
        // Check if using new format (direct shop config)
        if (!shopworkerData.shopify_domain || !shopworkerData.shopify_token) {
          console.error('Error: Invalid .shopworker.json format. Missing shopify_domain or shopify_token.');
          process.exit(1);
        }
        
        const fullWebhookId = getFullWebhookId(webhookId);
        
        console.log(`Shop: ${chalk.magenta(shopworkerData.shopify_domain)}`);
        console.log(`Deleting webhook ID: ${webhookId}`);
        
        // Create Shopify client directly from .shopworker.json
        const shopify = createShopifyClient({
          shop: shopworkerData.shopify_domain,
          accessToken: shopworkerData.shopify_token
        });
        
        await deleteWebhook(shopify, fullWebhookId);
        
        console.log(chalk.green('\n✓ Webhook deleted successfully'));
      } catch (error) {
        console.error(`Error deleting webhook: ${error.message}`);
        process.exit(1);
      }
    });
}