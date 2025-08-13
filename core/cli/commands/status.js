import { detectJobDirectory, ensureAndResolveJobName } from '../job-management.js';
import { handleAllJobsStatus, handleSingleJobStatus } from '../webhook-cli.js';

export function registerStatusCommand(program, projectRoot) {
  program
    .command('status [jobNameArg]')
    .description('Check the status of webhooks for a job or all jobs (local jobs only by default)')
    .option('-d, --dir <jobDirectory>', 'Job directory name')
    .option('-a, --all', 'Show status of all jobs, ignoring current directory context')
    .option('-c, --include-core', 'Include core jobs in the status output')
    .action(async (jobNameArg, options) => {
      // Determine the actual working directory - when run via npm, INIT_CWD contains the real directory
      const actualWorkingDir = process.env.INIT_CWD || process.cwd();

      // If a specific job is specified, use that
      if (jobNameArg) {
        await handleSingleJobStatus(projectRoot, jobNameArg);
        return;
      }

      // If directory option is specified, use that
      if (options.dir) {
        const resolved = await ensureAndResolveJobName(projectRoot, null, options.dir, false);
        if (resolved) {
          await handleSingleJobStatus(projectRoot, resolved);
          return;
        }
      }

      // Otherwise, try to auto-detect current directory context
      const jobName = detectJobDirectory(projectRoot, null);
      if (jobName && !options.all) {
        // We detected a specific job directory
        await handleSingleJobStatus(projectRoot, jobName);
      } else {
        // We're not in a specific job directory, show filtered or all jobs
        const filterByCurrentDir = !options.all;

        // When filtering by current dir, explicitly pass the actual working directory
        if (filterByCurrentDir) {
          await handleAllJobsStatus(projectRoot, actualWorkingDir, options.includeCore);
        } else {
          await handleAllJobsStatus(projectRoot, false, options.includeCore);
        }
      }
    });
}