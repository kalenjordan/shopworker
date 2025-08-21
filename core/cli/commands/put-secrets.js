import { executePutSecrets } from '../cloudflare-secrets.js';

export function registerPutSecretsCommand(program, projectRoot) {
  program
    .command('put-secrets')
    .description('Save .shopworker.json and all files from .secrets directory as Cloudflare secrets')
    .action(async () => {
      const success = await executePutSecrets(projectRoot);
      if (!success) {
        console.error('Failed to upload secrets.');
        process.exit(1);
      }
    });
}