import { detectJobDirectory, ensureAndResolveJobName } from '../job-discovery.js';
import { handleAllJobsStatus, handleSingleJobStatus } from '../webhook-manager.js';
import { execSync } from 'child_process';
import path from 'path';
import chalk from 'chalk';

export function registerStatusCommand(program, projectRoot) {
  program
    .command('status [jobNameArg]')
    .description('Check the status of webhooks for a job or all jobs')
    .option('-d, --dir <jobDirectory>', 'Job directory name')
    .option('-a, --all', 'Show status of all jobs (both local and core)')
    .action(async (jobNameArg, options) => {
      // Determine the actual working directory - when run via npm, INIT_CWD contains the real directory
      const actualWorkingDir = process.env.INIT_CWD || process.cwd();

      // Check for git diffs in local/ directory
      try {
        const localDir = path.join(projectRoot, 'local');
        const diff = execSync('git diff', {
          cwd: localDir,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe']
        });

        if (diff.trim()) {
          console.log('\n' + chalk.yellow('Changes detected in local/') + '\n');
          console.log(diff);
          console.log(''); // Add blank line after diff
        }
      } catch (error) {
        // Silently ignore git errors (not a git repo, git not installed, etc.)
      }

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