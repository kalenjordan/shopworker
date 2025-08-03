import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

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
 * Temporarily replaces the 'local' symlink with a full directory copy
 * @param {string} projectRoot - The project root directory
 * @returns {Promise<boolean>} Whether the replacement was successful
 */
export async function replaceSymlinkWithCopy(projectRoot) {
  const localPath = path.join(projectRoot, 'local');
  const tempPath = path.join(projectRoot, 'local-temp');
  
  try {
    // Check if 'local' exists and is a symlink
    const stats = fs.lstatSync(localPath);
    if (!stats.isSymbolicLink()) {
      console.log("'local' is not a symlink, proceeding with deployment as-is.");
      return true;
    }
    
    // Get the target of the symlink
    const symlinkTarget = fs.readlinkSync(localPath);
    const absoluteTarget = path.resolve(projectRoot, symlinkTarget);
    
    console.log(`Temporarily replacing symlink with directory copy...`);
    
    // Rename symlink to local-temp
    fs.renameSync(localPath, tempPath);
    
    // Copy the target directory to 'local'
    execSync(`cp -R "${absoluteTarget}" "${localPath}"`, { 
      stdio: 'pipe', 
      encoding: 'utf8' 
    });
    
    console.log('Successfully replaced symlink with directory copy.');
    return true;
  } catch (error) {
    console.error('Error replacing symlink:', error.message);
    // Try to restore if something went wrong
    if (fs.existsSync(tempPath) && !fs.existsSync(localPath)) {
      fs.renameSync(tempPath, localPath);
    }
    return false;
  }
}

/**
 * Restores the 'local' symlink after deployment
 * @param {string} projectRoot - The project root directory
 * @returns {Promise<boolean>} Whether the restoration was successful
 */
export async function restoreSymlink(projectRoot) {
  const localPath = path.join(projectRoot, 'local');
  const tempPath = path.join(projectRoot, 'local-temp');
  
  try {
    // Check if local-temp exists (our backed up symlink)
    if (!fs.existsSync(tempPath)) {
      console.log("No symlink backup found, skipping restoration.");
      return true;
    }
    
    console.log('Restoring symlink...');
    
    // Remove the copied directory
    if (fs.existsSync(localPath)) {
      execSync(`rm -rf "${localPath}"`, { 
        stdio: 'pipe', 
        encoding: 'utf8' 
      });
    }
    
    // Rename local-temp back to local
    fs.renameSync(tempPath, localPath);
    
    console.log('Successfully restored symlink.');
    return true;
  } catch (error) {
    console.error('Error restoring symlink:', error.message);
    return false;
  }
}

/**
 * Executes the Cloudflare deployment using Wrangler
 * @returns {Promise<boolean>} Whether the deployment was successful
 */
export async function executeCloudflareDeployment() {
  try {
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
 * Gets the project name from wrangler.toml
 * @param {string} projectRoot - The project root directory
 * @returns {string} The project name
 */
export function getProjectName(projectRoot) {
  const wranglerPath = path.join(projectRoot, 'wrangler.toml');
  try {
    const wranglerContent = fs.readFileSync(wranglerPath, 'utf8');
    const nameMatch = wranglerContent.match(/^name\s*=\s*"([^"]+)"/m);
    if (nameMatch && nameMatch[1]) {
      return nameMatch[1];
    }
    throw new Error('Project name not found in wrangler.toml');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`wrangler.toml not found at ${wranglerPath}`);
    }
    throw error;
  }
}

/**
 * Creates R2 bucket if it doesn't exist
 * @param {string} bucketName - The name of the R2 bucket
 * @returns {Promise<boolean>} Whether the bucket creation was successful
 */
export async function ensureR2BucketExists(bucketName) {
  try {
    // First check if bucket exists
    console.log(`Checking if R2 bucket '${bucketName}' exists...`);
    try {
      execSync(`npx wrangler r2 bucket list | grep -q "name:\\s*${bucketName}"`, { 
        encoding: 'utf8',
        stdio: 'pipe'
      });
      console.log(`R2 bucket '${bucketName}' already exists.`);
      return true;
    } catch (checkError) {
      // Bucket doesn't exist, create it
      console.log(`R2 bucket '${bucketName}' not found. Creating...`);
      execSync(`npx wrangler r2 bucket create ${bucketName}`, { 
        stdio: 'inherit', 
        encoding: 'utf8' 
      });
      console.log(`Successfully created R2 bucket '${bucketName}'.`);
      return true;
    }
  } catch (error) {
    console.error(`Error ensuring R2 bucket exists: ${error.message}`);
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

  // Ensure R2 bucket exists
  const projectName = getProjectName(cliDirname);
  const bucketName = `${projectName}--data`;
  const bucketCreated = await ensureR2BucketExists(bucketName);
  if (!bucketCreated) {
    console.error('Failed to ensure R2 bucket exists. Aborting deployment.');
    return false;
  }

  // Replace symlink with directory copy
  const symlinkReplaced = await replaceSymlinkWithCopy(cliDirname);
  if (!symlinkReplaced) {
    console.error('Failed to prepare local directory for deployment. Aborting.');
    return false;
  }

  let deploymentSuccess = false;
  
  try {
    // Execution phase
    if (currentCommit !== lastDeployedCommit) {
      console.log(`Current commit (${currentCommit}) differs from last deployed commit (${lastDeployedCommit || 'None'}).`);
      console.log('Deploying to Cloudflare via Wrangler...');

      deploymentSuccess = await executeCloudflareDeployment();

      if (deploymentSuccess) {
        updateShopworkerFile(cliDirname, currentCommit);

        // Execute git push after successful deployment
        await executeGitPush();
      }
    } else {
      console.log(`Current commit (${currentCommit}) matches last deployed commit. No new deployment needed.`);
      deploymentSuccess = true;
    }
  } finally {
    // Always restore symlink, regardless of deployment success
    await restoreSymlink(cliDirname);
  }

  return deploymentSuccess;
}
