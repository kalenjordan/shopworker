import { detectJobDirectory, ensureAndResolveJobName } from '../job-discovery.js';
import { handleAllJobsStatus, handleSingleJobStatus } from '../webhook-manager.js';

export function registerStatusCommand(program, projectRoot) {
  program
    .command('status [jobNameArg]')
    .description('Check the status of webhooks for a job or all jobs')
    .option('-d, --dir <jobDirectory>', 'Job directory name')
    .option('-a, --all', 'Show status of all jobs (both local and core)')
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
      const jobName = detectJobDirectory(projectRoot, process.cwd());
      if (jobName && !options.all) {
        // We detected a specific job directory
        await handleSingleJobStatus(projectRoot, jobName);
      } else {
        // Show all jobs based on the --all flag
        const includeCore = options.all;  // --all means include core jobs
        const filterByCurrentDir = !options.all;  // Only filter by current dir if not showing all

        // When filtering by current dir, explicitly pass the actual working directory
        if (filterByCurrentDir) {
          await handleAllJobsStatus(projectRoot, actualWorkingDir, includeCore);
        } else {
          await handleAllJobsStatus(projectRoot, false, includeCore);
        }
      }
    });
}