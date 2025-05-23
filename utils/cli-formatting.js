import chalk from 'chalk';

// ===================================================================
// Display Formatting Utilities
// ===================================================================

export const COLUMN_WIDTHS = {
  status: 13,
  path: 40,
  shop: 18,
  job: 35,
  topic: 20
};

export function cropAndPad(str, width) {
  if (!str) return ''.padEnd(width);
  str = String(str);
  return str.length > width ? str.slice(0, width - 3) + '...' : str.padEnd(width);
}

export function formatStatusColumn(status, isDisabled = false) {
  if (status === 'Enabled') {
    return chalk.green(cropAndPad('✓ Enabled', COLUMN_WIDTHS.status));
  } else if (status === 'Disabled') {
    return chalk.gray(cropAndPad('✗ Disabled', COLUMN_WIDTHS.status));
  } else if (status === 'Manual') {
    return chalk.green(cropAndPad('✓ Manual', COLUMN_WIDTHS.status));
  } else {
    return cropAndPad(status, COLUMN_WIDTHS.status);
  }
}

export function applyColorIfDisabled(text, isDisabled) {
  return isDisabled ? chalk.gray(text) : text;
}

/**
 * Display a table of jobs and their webhook status
 */
export function displayJobsTable(jobDisplayInfos, printHeader = true) {
  if (printHeader) {
    console.log('\n' +
      cropAndPad('STATUS', COLUMN_WIDTHS.status) +
      cropAndPad('SHOP', COLUMN_WIDTHS.shop) +
      cropAndPad('PATH', COLUMN_WIDTHS.path) +
      cropAndPad('JOB', COLUMN_WIDTHS.job) +
      cropAndPad('WEBHOOK TOPIC', COLUMN_WIDTHS.topic)
    );
    console.log('-'.repeat(COLUMN_WIDTHS.status + COLUMN_WIDTHS.shop + COLUMN_WIDTHS.path + COLUMN_WIDTHS.job + COLUMN_WIDTHS.topic));
  }

  for (const info of jobDisplayInfos) {
    const isDisabled = info.statusMsg === 'Disabled';

    console.log(
      formatStatusColumn(info.statusMsg, isDisabled) +
      (info.shop ? chalk.magenta(cropAndPad(info.shop, COLUMN_WIDTHS.shop)) : cropAndPad('N/A', COLUMN_WIDTHS.shop)) +
      applyColorIfDisabled(cropAndPad(info.jobPath, COLUMN_WIDTHS.path), isDisabled) +
      applyColorIfDisabled(chalk.blue(cropAndPad(info.displayName, COLUMN_WIDTHS.job)), isDisabled) +
      applyColorIfDisabled(cropAndPad(info.displayTopic, COLUMN_WIDTHS.topic), isDisabled)
    );
  }
}

/**
 * Sort job display infos by status priority then alphabetically
 */
export function sortJobDisplayInfos(jobDisplayInfos) {
  // Define status priority order
  const getStatusPriority = (status) => {
    switch(status) {
      case '⚠️ ERROR': return 1;
      case '⚠️ API ERROR': return 2;
      case '⚠️ NO DATA': return 3;
      case '⚠️ TRIGGER CONFIG ERROR': return 4;
      case 'Enabled': return 5;
      case 'Manual': return 6;
      case 'Disabled': return 7; // Make disabled lower priority so it sorts later
      default: return 8;
    }
  };

  // Sort by status priority then alphabetically by job name
  return jobDisplayInfos.sort((a, b) => {
    // First by status priority (higher priority first)
    const statusDiff = getStatusPriority(a.statusMsg) - getStatusPriority(b.statusMsg);
    if (statusDiff !== 0) return statusDiff;

    // Then by shop name
    if (a.shop !== b.shop) {
      if (!a.shop) return 1;
      if (!b.shop) return -1;
      return a.shop.localeCompare(b.shop);
    }

    // Finally by job name
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
