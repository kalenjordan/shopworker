import { ensureAndResolveJobName } from '../job-management.js';
import { runJobTest } from '../test-command.js';

export function registerRuntestCommand(program, projectRoot) {
  program
    .command('runtest')
    .description('Run test for the current job directory (or specified with -d)')
    .option('-d, --dir <jobDirectory>', 'Job directory name (if not running from within job dir)')
    .option('-q, --query <queryString>', 'Query string to filter results (e.g. "status:any")')
    .option('-j, --shop <shopDomain>', 'Override the shop domain in the job config')
    .option('-l, --limit <number>', 'Override the limit for the number of records to fetch (default: 1)', parseInt)
    .option('--dry-run [boolean]', 'Override the dry run setting in the job config (true/false)', (value) => {
      if (value === 'false') return false;
      if (value === 'true') return true;
      return value !== undefined ? true : undefined;
    })
    .action(async (options) => {
      const jobName = await ensureAndResolveJobName(projectRoot, null, options.dir, true);
      if (!jobName) return;
      await runJobTest(projectRoot, jobName, options);
    });
}