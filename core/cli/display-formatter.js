import chalk from 'chalk';
import Table from 'cli-table3';

// ===================================================================
// Display Formatting Utilities
// ===================================================================

// Status formatting configuration
const STATUS_CONFIG = {
  'Enabled': { symbol: '✓', color: chalk.green },
  'Manual': { symbol: '✓', color: chalk.green },
  'Disabled': { symbol: '✗', color: chalk.gray }
};

// Status priority for sorting (lower numbers = higher priority)
const STATUS_PRIORITY = {
  '⚠️ ERROR': 1,
  '⚠️ API ERROR': 2,
  '⚠️ NO DATA': 3,
  '⚠️ TRIGGER CONFIG ERROR': 4,
  '⚠️ TRIGGER MISSING': 4,
  '⚠️ INVALID TRIGGER': 4,
  '⚠️ INVALID CONFIG': 4,
  'Enabled': 5,
  'Manual': 6,
  'Disabled': 7
};

/**
 * Format status text with appropriate styling
 */
function formatStatus(status) {
  const config = STATUS_CONFIG[status];
  if (config) {
    return config.color(`${config.symbol} ${status}`);
  }
  
  // Handle error statuses with red color
  if (status.includes('⚠️')) {
    return chalk.red(status);
  }
  
  return status;
}

/**
 * Apply disabled styling to text if needed
 */
function applyDisabledStyling(text, isDisabled) {
  return isDisabled ? chalk.gray(text) : text;
}

/**
 * Display a table of jobs and their webhook status
 */
export function displayJobsTable(jobDisplayInfos) {
  const table = new Table({
    head: ['STATUS', 'TYPE', 'ID', 'TITLE', 'TRIGGER'],
    colWidths: [15, 8, 42, 37, 25],
    style: { head: ['cyan'] }
  });

  for (const info of jobDisplayInfos) {
    const isDisabled = info.statusMsg === 'Disabled';
    const jobType = info.fullPath?.startsWith('core/jobs/') ? 'Core' : 'Local';
    
    const row = [
      formatStatus(info.statusMsg),
      applyDisabledStyling(jobType, isDisabled),
      applyDisabledStyling(info.jobId, isDisabled),
      applyDisabledStyling(isDisabled ? info.displayName : chalk.blue(info.displayName), isDisabled),
      applyDisabledStyling(info.displayTopic, isDisabled)
    ];

    table.push(row);
  }

  console.log('\n' + table.toString());
}

/**
 * Sort job display infos by status priority then alphabetically
 */
export function sortJobDisplayInfos(jobDisplayInfos) {
  return jobDisplayInfos.sort((a, b) => {
    // Sort by status priority first
    const priorityDiff = (STATUS_PRIORITY[a.statusMsg] || 8) - (STATUS_PRIORITY[b.statusMsg] || 8);
    if (priorityDiff !== 0) return priorityDiff;

    // Then alphabetically by display name
    return a.displayName.localeCompare(b.displayName);
  });
}

/**
 * Display information about webhook include fields
 */
export function displayIncludeFieldsInfo(jobConfig, triggerConfig) {
  const configuredFields = jobConfig.webhook?.includeFields;

  if (configuredFields && Array.isArray(configuredFields)) {
    console.log(chalk.bold('\nConfigured webhook fields:'));
    configuredFields.forEach(field => console.log(`- ${field}`));
  } else {
    console.log('\nNo specific webhook fields configured (will receive all available fields).');
  }
}

/**
 * Display details of a webhook
 */
export function displayWebhookDetails(webhook, jobConfig) {
  console.log(`Webhook ID: ${webhook.id}`);
  console.log(`Webhook Topic: ${webhook.topic}`);

  if (webhook.endpoint?.__typename === 'WebhookHttpEndpoint') {
    console.log(`Callback URL: ${webhook.endpoint.callbackUrl}`);
  } else {
    console.log(`Endpoint Type: ${webhook.endpoint?.__typename || 'Unknown'}`);
  }

  if (webhook.metafieldNamespaces && webhook.metafieldNamespaces.length > 0) {
    console.log('Metafield Namespaces:');
    webhook.metafieldNamespaces.forEach(ns => console.log(`- ${ns}`));
  }

  console.log(`Created: ${new Date(webhook.createdAt).toLocaleString()}`);
  console.log(`Last updated: ${new Date(webhook.updatedAt).toLocaleString()}`);
}

/**
 * Display orphaned webhooks warning
 * @param {Array<Object>} orphanedWebhooks - List of orphaned webhooks
 * @param {Function} getWebhookIdSuffix - Function to get the webhook ID suffix
 */
export function displayOrphanedWebhooksWarning(orphanedWebhooks, getWebhookIdSuffix) {
  if (orphanedWebhooks.length === 0) return;

  console.log('\n' + chalk.yellow('⚠️  Warning: Found webhooks pointing to non-existent jobs:'));

  for (const webhook of orphanedWebhooks) {
    console.log('\n' + chalk.yellow(`Topic: ${webhook.topic.replace(/_/g, '/')}`));
    console.log(chalk.yellow(`ID: ${getWebhookIdSuffix(webhook.id)}`));
    console.log(chalk.yellow(`URL: ${webhook.endpoint.callbackUrl}`));

    try {
      const url = new URL(webhook.endpoint.callbackUrl);
      const jobPath = url.searchParams.get('job');
      if (jobPath) {
        console.log(chalk.yellow(`Referenced job: ${jobPath} (not found)`));
      }
    } catch (e) {
      // Ignore URL parsing errors
    }

    console.log(chalk.yellow(`Created: ${new Date(webhook.createdAt).toLocaleString()}`));
  }

  console.log('\n' + chalk.yellow('These webhooks may be left over from deleted jobs and should be cleaned up.'));
  console.log(chalk.yellow('To delete a webhook, use:'));
  console.log(chalk.cyan('shopworker delete-webhook <webhook-id> --job <any-active-job>'));
}
