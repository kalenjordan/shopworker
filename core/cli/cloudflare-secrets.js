import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';
import { getStateData, updateStateData } from './state-manager.js';

/**
 * Updates the lastSecretsPush timestamp in state file
 * @param {string} projectRoot - The project root directory
 */
export function updateLastSecretsPush(projectRoot) {
  const shopworkerPath = path.join(projectRoot, '.shopworker.json');
  
  let shopworkerData = {};
  if (fs.existsSync(shopworkerPath)) {
    shopworkerData = JSON.parse(fs.readFileSync(shopworkerPath, 'utf8'));
  }
  
  // Store the content hash and timestamp in state file
  updateStateData(projectRoot, {
    lastSecretsPush: new Date().toISOString(),
    lastSecretsPushContentHash: getSecretsContentHash(shopworkerData)
  });
  
  console.log('Updated lastSecretsPush timestamp in state file');
}

/**
 * Gets a SHA-256 hash of the secrets-relevant content (excluding tracking fields)
 * @param {object} shopworkerData - The shopworker configuration object
 * @returns {string} A hash representing the secrets content
 */
function getSecretsContentHash(shopworkerData) {
  // Since state fields are now in separate file, just hash the entire shopworker data
  const content = JSON.stringify(shopworkerData);
  const hash = crypto.createHash('sha256');
  hash.update(content);
  return hash.digest('hex');
}

/**
 * Checks if secrets need to be pushed based on content changes
 * @param {string} projectRoot - The project root directory
 * @returns {boolean} True if secrets need to be pushed
 */
export function needsSecretsPush(projectRoot) {
  const shopworkerPath = path.join(projectRoot, '.shopworker.json');
  
  if (!fs.existsSync(shopworkerPath)) {
    return true; // If no config exists, we need to push
  }
  
  const shopworkerData = JSON.parse(fs.readFileSync(shopworkerPath, 'utf8'));
  const stateData = getStateData(projectRoot);
  
  const lastSecretsPush = stateData.lastSecretsPush ? new Date(stateData.lastSecretsPush) : null;
  
  // If never pushed, we need to push
  if (!lastSecretsPush) {
    return true;
  }
  
  // Compare content hashes
  const lastPushContentHash = stateData.lastSecretsPushContentHash;
  const currentContentHash = getSecretsContentHash(shopworkerData);
  
  // Check if content has changed
  if (lastPushContentHash !== currentContentHash) {
    return true;
  }
  
  // Check if any files in .secrets directory were modified after last push
  const secretsDir = path.join(projectRoot, '.secrets');
  if (fs.existsSync(secretsDir)) {
    const files = fs.readdirSync(secretsDir);
    for (const file of files) {
      const filePath = path.join(secretsDir, file);
      if (!fs.statSync(filePath).isDirectory()) {
        const fileStats = fs.statSync(filePath);
        if (fileStats.mtime > lastSecretsPush) {
          return true;
        }
      }
    }
  }
  
  return false;
}

/**
 * Executes the put-secrets logic
 * @param {string} projectRoot - The project root directory
 * @returns {Promise<boolean>} True if successful
 */
export async function executePutSecrets(projectRoot) {
  console.log('Setting up Cloudflare secrets...');

  // 1. Handle .shopworker.json
  const shopworkerPath = path.join(projectRoot, '.shopworker.json');
  if (!fs.existsSync(shopworkerPath)) {
    console.error('Error: .shopworker.json file not found.');
    return false;
  }
  
  try {
    // Read the file
    const fileContent = fs.readFileSync(shopworkerPath, 'utf8');
    const configData = JSON.parse(fileContent);

    // Stringify the content for the secret
    const stringifiedContent = JSON.stringify(configData);

    // Create a temporary file with the config
    const tempFile = path.join(projectRoot, '.temp_config.json');
    fs.writeFileSync(tempFile, stringifiedContent, 'utf8');

    try {
      // Use the file content as input to wrangler
      console.log('Uploading SHOPWORKER_CONFIG secret...');
      execSync(`cat ${tempFile} | npx wrangler secret put SHOPWORKER_CONFIG`,
        { stdio: 'inherit', encoding: 'utf8' });

      console.log('Successfully saved .shopworker.json as SHOPWORKER_CONFIG secret.');
    } catch (error) {
      console.error('Error uploading SHOPWORKER_CONFIG secret:', error.message);
      return false;
    } finally {
      // Clean up temporary file
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  } catch (error) {
    console.error('Error processing .shopworker.json:', error.message);
    return false;
  }

  // 2. Handle secrets from .secrets directory
  const secretsDir = path.join(projectRoot, '.secrets');
  if (!fs.existsSync(secretsDir)) {
    console.log('Note: .secrets directory not found. No additional secrets uploaded.');
  } else {
    try {
      // Get all files in the .secrets directory
      const files = fs.readdirSync(secretsDir);

      if (files.length === 0) {
        console.log('No secret files found in .secrets directory.');
      } else {
        console.log(`\nUploading ${files.length} secrets from .secrets directory...`);

        // Process each file in the directory
        for (const file of files) {
          const filePath = path.join(secretsDir, file);

          // Skip directories
          if (fs.statSync(filePath).isDirectory()) {
            continue;
          }

          // Get key by removing the file extension
          const secretKey = path.parse(file).name;
          // Add SECRET_ prefix for the Cloudflare variable name
          const envVarName = `SECRET_${secretKey}`;

          // Read the file
          const content = fs.readFileSync(filePath, 'utf8');

          // Create a temporary file with the content
          const tempFile = path.join(projectRoot, `.temp_secret_${secretKey}`);
          fs.writeFileSync(tempFile, content, 'utf8');

          try {
            // Use the file content as input to wrangler
            console.log(`Uploading secret: ${envVarName}`);
            execSync(`cat ${tempFile} | npx wrangler secret put ${envVarName}`,
              { stdio: 'inherit', encoding: 'utf8' });

            console.log(`Successfully saved ${file} as ${envVarName} secret.`);
          } catch (error) {
            console.error(`Error uploading secret ${envVarName}:`, error.message);
          } finally {
            // Clean up temporary file
            if (fs.existsSync(tempFile)) {
              fs.unlinkSync(tempFile);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error processing secrets directory:', error.message);
      return false;
    }
  }

  console.log('\nAll secrets have been uploaded successfully.');
  
  // Update the lastSecretsPush timestamp
  updateLastSecretsPush(projectRoot);
  
  return true;
}