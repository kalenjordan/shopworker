export function registerJsonStatusCommand(program, projectRoot) {
  program
    .command('json-status [jobNameArg]')
    .description('Get the status of webhooks in JSON format')
    .option('-d, --dir <jobDirectory>', 'Job directory name')
    .option('-a, --all', 'Show status of all jobs, ignoring current directory context')
    .action(async (jobNameArg, options) => {
      const { handleJsonStatusCommand } = await import('../json-commands.js');
      await handleJsonStatusCommand(projectRoot, jobNameArg, options);
    });
}