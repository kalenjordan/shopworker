import fs from 'fs';
import path from 'path';

/**
 * Handle Cloudflare deployment logic
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @returns {Promise<boolean>} Whether the deployment was successful
 */
export async function handleCloudflareDeployment(cliDirname) {
  try {
    const { execSync } = await import('child_process');
    const gitStatus = execSync('git status --porcelain', { encoding: 'utf8' });
    if (gitStatus.trim() !== '') {
      console.error('Error: There are uncommitted changes in your Git repository. Please commit or stash them before deploying.');
      console.error('Uncommitted changes:\n' + gitStatus);
      return false;
    }
  } catch (error) {
    console.error('Error checking Git status:', error.message);
    console.warn('Warning: Could not verify Git status. Proceeding, but this might lead to deploying uncommitted code.');
  }

  const shopworkerFilePath = path.join(cliDirname, '.shopworker.json');
  let lastDeployedCommit = null;
  if (fs.existsSync(shopworkerFilePath)) {
    try {
      const shopworkerData = JSON.parse(fs.readFileSync(shopworkerFilePath, 'utf8'));
      lastDeployedCommit = shopworkerData?.lastDeployedCommit;
    } catch (error) {
      console.warn('Warning: Could not read or parse .shopworker file. Will proceed as if no previous deployment was made.', error.message);
    }
  }

  let currentCommit = null;
  try {
    const { execSync } = await import('child_process');
    currentCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch (error) {
    console.error('Error getting current Git commit:', error.message);
    console.error('Cannot proceed without knowing the current commit. Please ensure you are in a Git repository.');
    return false;
  }

  if (currentCommit !== lastDeployedCommit) {
    console.log(`Current commit (${currentCommit}) differs from last deployed commit (${lastDeployedCommit || 'None'}).`);
    console.log('Deploying to Cloudflare via Wrangler...');
    try {
      const { execSync } = await import('child_process');
      execSync('npx wrangler deploy', { stdio: 'inherit', encoding: 'utf8' });
      console.log('Successfully deployed to Cloudflare.');

      // Preserve existing content in .shopworker.json when updating the lastDeployedCommit
      const newShopworkerData = fs.existsSync(shopworkerFilePath)
        ? { ...JSON.parse(fs.readFileSync(shopworkerFilePath, 'utf8')), lastDeployedCommit: currentCommit }
        : { lastDeployedCommit: currentCommit };

      fs.writeFileSync(shopworkerFilePath, JSON.stringify(newShopworkerData, null, 2), 'utf8');
      console.log(`Updated .shopworker with new deployed commit: ${currentCommit}`);
    } catch (error) {
      console.error('Error deploying to Cloudflare with Wrangler:', error.message);
      console.error('Aborting deployment.');
      return false;
    }
  } else {
    console.log(`Current commit (${currentCommit}) matches last deployed commit. No new deployment needed.`);
  }
  return true;
}
