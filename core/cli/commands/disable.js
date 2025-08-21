import { ensureAndResolveJobName } from '../job-discovery.js';
import { getWorkerUrl } from '../../shared/config-helpers.js';
import { disableJobWebhook } from '../webhook-manager.js';

export function registerDisableCommand(program, projectRoot) {
  program
    .command('disable [jobNameArg]')
    .description('Disable a job by removing webhooks from Shopify')
    .option('-d, --dir <jobDirectory>', 'Job directory name')
    .option('-w, --worker <workerUrl>', 'Cloudflare worker URL (overrides .shopworker.json)')
    .action(async (jobNameArg, options) => {
      const jobName = await ensureAndResolveJobName(projectRoot, jobNameArg, options.dir, false);
      if (!jobName) return;

      const workerUrl = getWorkerUrl(options, projectRoot);
      if (!workerUrl) {
        console.error("Worker URL is required to accurately identify and disable webhooks. Please provide with -w or set cloudflare_worker_url in .shopworker.json.");
        return;
      }

      await disableJobWebhook(projectRoot, jobName, workerUrl);
    });
}