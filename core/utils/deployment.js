import fs from 'fs';
import path from 'path';

/**
 * Checks Git repository status before deployment
 * @returns {Promise<void>}
 */
export async function checkGitStatus() {
  try {
    const { execSync } = await import('child_process');
    const gitStatus = execSync('git status --porcelain', { encoding: 'utf8' });
    if (gitStatus.trim() !== '') {
      console.error('Warning: There are uncommitted changes in your Git repository. Please commit or stash them before deploying.');
      console.error('Uncommitted changes:\n' + gitStatus);
      // Commented out to allow deployment with uncommitted changes
      // return false;
    }
  } catch (error) {
    console.error('Error checking Git status:', error.message);
    console.warn('Warning: Could not verify Git status. Proceeding, but this might lead to deploying uncommitted code.');
  }
}

/**
 * Gets the last deployed commit from the .shopworker.json file
 * @param {string} cliDirname - The directory where cli.js is located
 * @returns {string|null} The last deployed commit hash or null if not found
 */
export function getLastDeployedCommit(cliDirname) {
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

  return lastDeployedCommit;
}

/**
 * Gets the current Git commit hash
 * @returns {Promise<string|null>} The current commit hash or null if error
 */
export async function getCurrentCommit() {
  try {
    const { execSync } = await import('child_process');
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch (error) {
    console.error('Error getting current Git commit:', error.message);
    console.error('Cannot proceed without knowing the current commit. Please ensure you are in a Git repository.');
    return null;
  }
}

/**
 * Executes the Cloudflare deployment using Wrangler
 * @returns {Promise<boolean>} Whether the deployment was successful
 */
export async function executeCloudflareDeployment() {
  try {
    const { execSync } = await import('child_process');
    execSync('npx wrangler deploy', { stdio: 'inherit', encoding: 'utf8' });
    console.log('Successfully deployed to Cloudflare.');
    return true;
  } catch (error) {
    console.error('Error deploying to Cloudflare with Wrangler:', error.message);
    console.error('Aborting deployment.');
    return false;
  }
}

/**
 * Updates the .shopworker.json file with the new deployed commit
 * @param {string} cliDirname - The directory where cli.js is located
 * @param {string} currentCommit - The current commit hash
 */
export function updateShopworkerFile(cliDirname, currentCommit) {
  const shopworkerFilePath = path.join(cliDirname, '.shopworker.json');

  // Preserve existing content in .shopworker.json when updating the lastDeployedCommit
  const newShopworkerData = fs.existsSync(shopworkerFilePath)
    ? { ...JSON.parse(fs.readFileSync(shopworkerFilePath, 'utf8')), lastDeployedCommit: currentCommit }
    : { lastDeployedCommit: currentCommit };

  fs.writeFileSync(shopworkerFilePath, JSON.stringify(newShopworkerData, null, 2), 'utf8');
  console.log(`Updated .shopworker with new deployed commit: ${currentCommit}`);
}

/**
 * Executes a git push to the remote repository
 * @returns {Promise<boolean>} Whether the git push was successful
 */
export async function executeGitPush() {
  try {
    const { execSync } = await import('child_process');
    console.log('Pushing changes to remote Git repository...');
    execSync('git push origin master', { stdio: 'inherit', encoding: 'utf8' });
    console.log('Successfully pushed to remote Git repository.');
    return true;
  } catch (error) {
    console.error('Error pushing to Git repository:', error.message);
    console.warn('Cloudflare deployment was successful, but Git push failed.');
    return false;
  }
}

/**
 * Handle Cloudflare deployment logic
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @returns {Promise<boolean>} Whether the deployment was successful
 */
export async function handleCloudflareDeployment(cliDirname) {
  // Preparation phase
  await checkGitStatus();

  const lastDeployedCommit = getLastDeployedCommit(cliDirname);
  const currentCommit = await getCurrentCommit();

  if (!currentCommit) {
    return false;
  }

  // Execution phase
  if (currentCommit !== lastDeployedCommit) {
    console.log(`Current commit (${currentCommit}) differs from last deployed commit (${lastDeployedCommit || 'None'}).`);
    console.log('Deploying to Cloudflare via Wrangler...');

    const deploymentSuccess = await executeCloudflareDeployment();

    if (deploymentSuccess) {
      updateShopworkerFile(cliDirname, currentCommit);

      // Execute git push after successful deployment
      await executeGitPush();
    }

    return deploymentSuccess;
  } else {
    console.log(`Current commit (${currentCommit}) matches last deployed commit. No new deployment needed.`);
    return true;
  }
}
