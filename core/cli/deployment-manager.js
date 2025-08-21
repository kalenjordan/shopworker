import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import readline from 'readline';
import { needsSecretsPush, executePutSecrets } from './cloudflare-secrets.js';
import { calculateDeploymentHash, isDeploymentNeeded } from './deployment-hash.js';
import { getStateData, updateStateData } from './state-manager.js';

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
 * Gets the last deployed commit from the state file
 * @param {string} cliDirname - The directory where cli.js is located
 * @returns {string|null} The last deployed commit hash or null if not found
 */
export function getLastDeployedCommit(cliDirname) {
  const stateData = getStateData(cliDirname);
  return stateData.lastDeployedCommit || null;
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
    // Check if 'local' exists at all
    if (!fs.existsSync(localPath)) {
      console.log("'local' directory not found, proceeding with deployment without it.");
      return true;
    }

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
      // No backup means either:
      // 1. local directory didn't exist originally
      // 2. local was not a symlink
      // 3. symlink replacement wasn't performed
      // In all cases, nothing to restore
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
 * Gets the R2 bucket name from wrangler.toml
 * @param {string} projectRoot - The project root directory
 * @returns {string|null} The bucket name or null if not found
 */
export function getR2BucketName(projectRoot) {
  try {
    const wranglerPath = path.join(projectRoot, 'wrangler.toml');
    const wranglerContent = fs.readFileSync(wranglerPath, 'utf8');

    // Look for bucket_name in the wrangler.toml
    const bucketMatch = wranglerContent.match(/bucket_name\s*=\s*"([^"]+)"/);
    if (bucketMatch && bucketMatch[1]) {
      return bucketMatch[1];
    }

    console.warn('Could not find bucket_name in wrangler.toml');
    return null;
  } catch (error) {
    console.error('Error reading wrangler.toml:', error.message);
    return null;
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
 * Prompts the user for input
 * @param {string} question - The question to ask
 * @returns {Promise<string>} The user's input
 */
export function promptUser(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Ensures cloudflare_worker_url is set in .shopworker.json
 * @param {string} cliDirname - The directory where cli.js is located
 * @returns {Promise<string>} The cloudflare_worker_url
 */
export async function ensureWorkerUrl(cliDirname) {
  const shopworkerFilePath = path.join(cliDirname, '.shopworker.json');

  let shopworkerData = {};
  if (fs.existsSync(shopworkerFilePath)) {
    shopworkerData = JSON.parse(fs.readFileSync(shopworkerFilePath, 'utf8'));
  }

  // Check if cloudflare_worker_url exists
  if (!shopworkerData.cloudflare_worker_url) {
    console.log('\nCloudflare worker URL not found in .shopworker.json');
    const projectName = getProjectName(cliDirname);
    console.log(`Project name from wrangler.toml: ${projectName}`);
    console.log('\nPlease enter your Cloudflare subdomain');
    console.log('(e.g., your-subdomain.workers.dev or just your-subdomain)');

    const input = await promptUser('Subdomain: ');

    let workerUrl;

    // Check if user entered full URL
    if (input.startsWith('https://')) {
      // Validate full URL format
      if (!input.match(/^https:\/\/[^.]+\.[^.]+\.workers\.dev$/)) {
        throw new Error('Invalid worker URL format. Expected format: https://project-name.subdomain.workers.dev');
      }
      workerUrl = input;
    } else if (input.endsWith('.workers.dev')) {
      // User entered subdomain.workers.dev
      workerUrl = `https://${projectName}.${input}`;
    } else {
      // User entered just the subdomain
      workerUrl = `https://${projectName}.${input}.workers.dev`;
    }

    // Save to .shopworker.json
    shopworkerData.cloudflare_worker_url = workerUrl;
    fs.writeFileSync(shopworkerFilePath, JSON.stringify(shopworkerData, null, 2), 'utf8');
    console.log(`Worker URL saved to .shopworker.json: ${workerUrl}`);
  }

  return shopworkerData.cloudflare_worker_url;
}

/**
 * Updates the state file with the new deployed commit and hash
 * @param {string} cliDirname - The directory where cli.js is located
 * @param {string} currentCommit - The current commit hash
 * @param {string} deploymentHash - The deployment hash
 */
export function updateShopworkerFile(cliDirname, currentCommit, deploymentHash) {
  updateStateData(cliDirname, {
    lastDeployedCommit: currentCommit,
    lastDeploymentHash: deploymentHash
  });
  console.log(`Updated deployment state with commit: ${currentCommit}`);
  console.log(`Updated deployment state with hash: ${deploymentHash}`);
}


/**
 * Handle Cloudflare deployment logic
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {boolean} force - Force deployment even if no changes detected
 * @returns {Promise<boolean>} Whether the deployment was successful
 */
export async function handleCloudflareDeployment(cliDirname, force = false) {
  // Preparation phase
  await checkGitStatus();

  // Ensure cloudflare_worker_url is set
  await ensureWorkerUrl(cliDirname);

  // Check if secrets need to be pushed
  if (needsSecretsPush(cliDirname)) {
    console.log('\nDetected changes to secrets that need to be pushed...');
    const secretsSuccess = await executePutSecrets(cliDirname);
    if (!secretsSuccess) {
      console.error('Failed to push secrets. Aborting deployment.');
      return false;
    }
    console.log('');
  }

  const currentCommit = await getCurrentCommit();

  if (!currentCommit) {
    return false;
  }

  // Get R2 bucket name from wrangler.toml
  const bucketName = getR2BucketName(cliDirname);
  if (!bucketName) {
    console.error('Could not determine R2 bucket name from wrangler.toml. Aborting deployment.');
    return false;
  }

  // Ensure R2 bucket exists
  const bucketCreated = await ensureR2BucketExists(bucketName);
  if (!bucketCreated) {
    console.error('Failed to ensure R2 bucket exists. Aborting deployment.');
    return false;
  }

  // Generate the job loader for Cloudflare Workers
  console.log('Generating job loader for Cloudflare Workers...');
  try {
    execSync('node core/cli/bundle-jobs.js', {
      stdio: 'inherit',
      encoding: 'utf8',
      cwd: cliDirname
    });
  } catch (error) {
    console.error('Failed to generate job loader:', error.message);
    return false;
  }

  // Replace symlink with directory copy
  const symlinkReplaced = await replaceSymlinkWithCopy(cliDirname);
  if (!symlinkReplaced) {
    console.error('Failed to prepare local directory for deployment. Aborting.');
    return false;
  }

  let deploymentSuccess = false;
  let currentHash = null;

  try {
    // Check if deployment is needed based on hash
    if (!force) {
      const stateData = getStateData(cliDirname);
      const lastDeploymentHash = stateData.lastDeploymentHash;
      const { needed, currentHash: calculatedHash } = await isDeploymentNeeded(cliDirname, lastDeploymentHash);
      currentHash = calculatedHash;
      
      if (!needed) {
        console.log('No changes detected since last deployment. Skipping deployment.');
        console.log('Use --force flag to force deployment.');
        return true; // Return true since nothing needs to be done
      }
    } else {
      // If forcing, still calculate hash for storing
      currentHash = await calculateDeploymentHash(cliDirname);
      console.log('Forcing deployment (--force flag used)...');
    }

    // Execution phase
    console.log('Deploying to Cloudflare via Wrangler...');

    deploymentSuccess = await executeCloudflareDeployment();

    if (deploymentSuccess) {
      updateShopworkerFile(cliDirname, currentCommit, currentHash);
    }
  } finally {
    // Always restore symlink, regardless of deployment success
    await restoreSymlink(cliDirname);
  }

  return deploymentSuccess;
}
