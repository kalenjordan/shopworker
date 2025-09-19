import { ensureAndResolveJobName, selectJobInteractively } from '../job-discovery.js';
import { runJobTest } from '../test-runner.js';

export function registerTestCommand(program, projectRoot) {
  program
    .command('test [jobNameArg]')
    .description('Test a job with the most recent order data or manual trigger')
    .option('-d, --dir <jobDirectory>', 'Job directory name (if not running from within job dir)')
    .option('-q, --query <queryString>', 'Query string to filter results (e.g. "status:any")')
    .option('-s, --shop <shopDomain>', 'Override the shop domain in the job config')
    .option('-l, --limit <number>', 'Override the limit for the number of records to fetch (default: 1)', parseInt)
    .option('-p, --params <params>', 'Override or add payload parameters (JSON or key=value pairs)')
    .option('--dry-run [boolean]', 'Override the dry run setting in the job config (true/false)', (value) => {
      if (value === 'false') return false;
      if (value === 'true') return true;
      return value !== undefined ? true : undefined;
    })
    .action(async (jobNameArg, options) => {
      let jobName = jobNameArg;

      // If no job specified, try to resolve it
      if (!jobName) {
        // First try to resolve from directory option or current directory
        jobName = await ensureAndResolveJobName(projectRoot, null, options.dir, false);

        // If still no job, use interactive selection
        if (!jobName) {
          try {
            jobName = await selectJobInteractively(projectRoot);
          } catch (error) {
            console.error(`\n❌ ${error.message}`);
            return;
          }
        }
      } else {
        // Resolve the provided job name
        jobName = await ensureAndResolveJobName(projectRoot, jobName, options.dir, true);
      }

      if (!jobName) return;
      await runJobTest(projectRoot, jobName, options);
    });
}