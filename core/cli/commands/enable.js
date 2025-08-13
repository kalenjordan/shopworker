import { ensureAndResolveJobName } from '../job-management.js';
import { handleCloudflareDeployment } from '../deployment.js';
import { getWorkerUrl } from '../../shared/config-helpers.js';
import { enableJobWebhook } from '../webhook-cli.js';

export function registerEnableCommand(program, projectRoot) {
  program
    .command('enable [jobNameArg]')
    .description('Enable a job by registering webhooks with Shopify after ensuring the latest code is deployed')
    .option('-d, --dir <jobDirectory>', 'Job directory name')
    .option('-w, --worker <workerUrl>', 'Cloudflare worker URL (overrides .shopworker.json)')
    .option('-f, --force', 'Force deployment even if no changes detected')
    .action(async (jobNameArg, options) => {
      const deploymentSuccessful = await handleCloudflareDeployment(projectRoot, options.force);
      if (!deploymentSuccessful) {
        console.error("Halting 'enable' command due to deployment issues.");
        return;
      }

      const jobName = await ensureAndResolveJobName(projectRoot, jobNameArg, options.dir, false);
      if (!jobName) return;

      const workerUrl = getWorkerUrl(options, projectRoot);
      if (!workerUrl) return;

      await enableJobWebhook(projectRoot, jobName, workerUrl);
    });
}