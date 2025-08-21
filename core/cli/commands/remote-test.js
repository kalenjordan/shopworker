import { ensureAndResolveJobName } from '../job-discovery.js';
import { runJobRemoteTest } from '../test-remote.js';
import { handleCloudflareDeployment } from '../deployment-manager.js';
import { isDeploymentNeeded } from '../deployment-hash.js';
import { getWorkerUrl } from '../../shared/config-helpers.js';

export function registerRemoteTestCommand(program, projectRoot) {
  program
    .command('remote-test [jobNameArg]')
    .description('Test a job by sending a POST request to the worker URL with a record ID')
    .option('-d, --dir <jobDirectory>', 'Job directory name (if not running from within job dir)')
    .option('-i, --id <recordId>', 'ID of the record to process (optional, will find a sample record if not provided)')
    .option('-q, --query <queryString>', 'Query string to filter results when automatically finding a record')
    .option('-w, --worker <workerUrl>', 'Cloudflare worker URL (overrides .shopworker.json)')
    .option('-j, --shop <shopDomain>', 'Override the shop domain in the job config')
    .option('-l, --limit <number>', 'Override the limit for the number of records to fetch (default: 1)', parseInt)
    .option('-b, --batch-size <number>', 'Override the batch size for the number of records to fetch (default: 50)', parseInt)
    .action(async (jobNameArg, options) => {
      try {
        const jobName = await ensureAndResolveJobName(projectRoot, jobNameArg, options.dir, true);
        if (!jobName) return;

        const workerUrl = getWorkerUrl(options, projectRoot);
        if (!workerUrl) {
          console.error("Worker URL is required for remote testing. Please provide with -w or set cloudflare_worker_url in .shopworker.json.");
          return;
        }

        // Check if deployment is needed before remote test
        const { getStateData } = await import('../state-manager.js');
        const stateData = getStateData(projectRoot);
        const lastDeploymentHash = stateData.lastDeploymentHash;
        const { needed } = await isDeploymentNeeded(projectRoot, lastDeploymentHash);
        
        if (needed) {
          console.log('\nDetected changes since last deployment. Deploying to Cloudflare...');
          const deploymentSuccessful = await handleCloudflareDeployment(projectRoot);
          if (!deploymentSuccessful) {
            console.error("Deployment failed. Aborting remote test.");
            return;
          }
          console.log(''); // Add blank line after deployment
        }

        // Pass the workerUrl in the options
        options.worker = workerUrl;

        // Execute the remote test
        await runJobRemoteTest(projectRoot, jobName, options);
      } catch (error) {
        console.error(`Error running remote test: ${error.message}`);
        process.exit(1);
      }
    });
}