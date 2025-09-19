import { execSync } from 'child_process';
import { format } from 'date-fns';

export function registerWorkflowRunsCommand(program, projectRoot) {
  program
    .command('workflow-runs')
    .alias('runs')
    .description('Show workflow instances/runs')
    .option('-n, --name <workflowName>', 'Workflow name (defaults to shopworker-averymae)')
    .option('-l, --limit <number>', 'Number of instances to show', '10')
    .option('-d, --describe <instanceId>', 'Describe a specific instance with detailed logs')
    .action(async (options) => {
      const workflowName = options.name || 'shopworker-averymae';

      try {
        if (options.describe) {
          await describeWorkflowInstance(workflowName, options.describe);
        } else {
          await listWorkflowInstances(workflowName, options.limit);
        }
      } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
      }
    });
}

async function listWorkflowInstances(workflowName, limit) {
  console.log(`📋 Workflow Instances for: ${workflowName}\n`);

  try {
    // Execute wrangler command and capture output
    const result = execSync(`wrangler workflows instances list ${workflowName} --per-page ${limit}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Parse the JSON output from wrangler
    const instances = JSON.parse(result);

    if (!instances || instances.length === 0) {
      console.log('No workflow instances found.');
      return;
    }

    // Display instances in a formatted table
    console.log('ID'.padEnd(40) + 'Status'.padEnd(12) + 'Created'.padEnd(20) + 'Updated');
    console.log('-'.repeat(80));

    instances.forEach(instance => {
      const id = instance.id.substring(0, 37) + '...';
      const status = getStatusDisplay(instance.status);
      const created = formatDate(instance.created_on);
      const updated = formatDate(instance.modified_on);

      console.log(
        id.padEnd(40) +
        status.padEnd(12) +
        created.padEnd(20) +
        updated
      );
    });

    console.log(`\n💡 Use --describe <instanceId> to see detailed logs for a specific instance`);

  } catch (error) {
    if (error.stdout) {
      // Try to parse error response
      try {
        const errorData = JSON.parse(error.stdout);
        throw new Error(errorData.error || 'Unknown error from Wrangler');
      } catch {
        throw new Error(`Wrangler command failed: ${error.message}`);
      }
    } else {
      throw new Error(`Failed to list workflow instances: ${error.message}`);
    }
  }
}

async function describeWorkflowInstance(workflowName, instanceId) {
  console.log(`🔍 Workflow Instance Details\n`);
  console.log(`Workflow: ${workflowName}`);
  console.log(`Instance: ${instanceId}\n`);

  try {
    // Execute wrangler describe command
    const result = execSync(`wrangler workflows instances describe ${workflowName} ${instanceId}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Parse the JSON output
    const instance = JSON.parse(result);

    // Display basic info
    console.log(`Status: ${getStatusDisplay(instance.status)}`);
    console.log(`Created: ${formatDate(instance.created_on)}`);
    console.log(`Updated: ${formatDate(instance.modified_on)}`);

    if (instance.error) {
      console.log(`\n❌ Error: ${instance.error}`);
    }

    // Display steps if available
    if (instance.steps && instance.steps.length > 0) {
      console.log(`\n📋 Steps (${instance.steps.length} total):`);
      console.log('-'.repeat(80));

      instance.steps.forEach((step, index) => {
        const stepNum = (index + 1).toString().padStart(2, '0');
        const stepStatus = getStatusDisplay(step.status);
        const stepName = step.name || 'unnamed';

        console.log(`${stepNum}. ${stepName.padEnd(30)} ${stepStatus}`);

        if (step.error) {
          console.log(`    ❌ Error: ${step.error}`);
        }

        if (step.output && typeof step.output === 'object') {
          const outputStr = JSON.stringify(step.output, null, 2);
          if (outputStr.length < 200) {
            console.log(`    📤 Output: ${outputStr}`);
          }
        }
      });
    }

    // Display logs if available
    if (instance.logs && instance.logs.length > 0) {
      console.log(`\n📝 Recent Logs (${instance.logs.length} entries):`);
      console.log('-'.repeat(80));

      instance.logs.slice(-20).forEach(log => {
        const timestamp = formatDate(log.timestamp);
        const level = log.level || 'info';
        const message = log.message || JSON.stringify(log);

        console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
      });
    }

  } catch (error) {
    if (error.stdout) {
      try {
        const errorData = JSON.parse(error.stdout);
        throw new Error(errorData.error || 'Unknown error from Wrangler');
      } catch {
        throw new Error(`Wrangler command failed: ${error.message}`);
      }
    } else {
      throw new Error(`Failed to describe workflow instance: ${error.message}`);
    }
  }
}

function getStatusDisplay(status) {
  const statusMap = {
    'running': '🔄 Running',
    'completed': '✅ Complete',
    'failed': '❌ Failed',
    'terminated': '🛑 Terminated',
    'paused': '⏸️  Paused',
    'pending': '⏳ Pending'
  };

  return statusMap[status] || status;
}

function formatDate(dateString) {
  if (!dateString) return 'N/A';

  try {
    const date = new Date(dateString);
    return format(date, 'MMM dd HH:mm');
  } catch {
    return dateString;
  }
}