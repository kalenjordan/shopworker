import { handleCloudflareDeployment } from '../deployment.js';

export function registerDeployCommand(program, projectRoot) {
  program
    .command('deploy')
    .description('Deploy the current state to Cloudflare and record the commit hash.')
    .option('-f, --force', 'Force deployment even if no changes detected')
    .action(async (options) => {
      console.log('Starting Cloudflare deployment process...');
      const success = await handleCloudflareDeployment(projectRoot, options.force);
      if (success) {
        console.log('Deployment process completed successfully.');
      } else {
        console.error('Deployment process failed.');
      }
    });
}