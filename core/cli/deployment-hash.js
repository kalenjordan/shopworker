import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Recursively find all files in a directory
 * @param {string} dir - Directory to search
 * @param {function} filter - Filter function for files
 * @returns {Array<string>} Array of file paths relative to dir
 */
function findFilesRecursively(dir, filter = () => true) {
  const files = [];
  
  if (!fs.existsSync(dir)) {
    return files;
  }
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      // Skip node_modules and test directories
      if (entry.name === 'node_modules' || entry.name === 'test') {
        continue;
      }
      // Recursively search subdirectories
      const subFiles = findFilesRecursively(fullPath, filter);
      files.push(...subFiles);
    } else if (entry.isFile() && filter(fullPath)) {
      files.push(fullPath);
    }
  }
  
  return files;
}

/**
 * Calculate SHA-256 hash for deployment files
 * @param {string} projectRoot - The project root directory
 * @returns {Promise<string>} The calculated hash
 */
export async function calculateDeploymentHash(projectRoot) {
  const hash = crypto.createHash('sha256');
  
  // Collect all deployment-relevant files
  const allFiles = new Set();
  
  // Add core JavaScript files
  const coreJsFiles = findFilesRecursively(
    path.join(projectRoot, 'core'),
    file => file.endsWith('.js') && !file.endsWith('job-loader-generated.js')
  );
  coreJsFiles.forEach(file => allFiles.add(file));
  
  // Add core job config files
  const coreConfigFiles = findFilesRecursively(
    path.join(projectRoot, 'core', 'jobs'),
    file => file.endsWith('config.json')
  );
  coreConfigFiles.forEach(file => allFiles.add(file));
  
  // Add local JavaScript and config files if they exist
  const localDir = path.join(projectRoot, 'local');
  if (fs.existsSync(localDir)) {
    const localJsFiles = findFilesRecursively(
      localDir,
      file => file.endsWith('.js')
    );
    localJsFiles.forEach(file => allFiles.add(file));
    
    const localConfigFiles = findFilesRecursively(
      path.join(localDir, 'jobs'),
      file => file.endsWith('config.json')
    );
    localConfigFiles.forEach(file => allFiles.add(file));
  }
  
  // Add specific root files
  const rootFiles = ['wrangler.toml', 'package.json', 'package-lock.json'];
  for (const file of rootFiles) {
    const filePath = path.join(projectRoot, file);
    if (fs.existsSync(filePath)) {
      allFiles.add(filePath);
    }
  }
  
  // Sort files for consistent hashing
  const sortedFiles = Array.from(allFiles).sort();
  
  // Hash each file's content
  for (const file of sortedFiles) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      // Include relative file path in hash to detect file moves/renames
      const relativePath = path.relative(projectRoot, file);
      hash.update(relativePath);
      hash.update('\0'); // null separator
      hash.update(content);
      hash.update('\0'); // null separator
    } catch (error) {
      // Skip files that can't be read (e.g., broken symlinks)
      if (error.code !== 'ENOENT' && error.code !== 'EISDIR') {
        console.warn(`Warning: Could not read file ${file}: ${error.message}`);
      }
    }
  }
  
  return hash.digest('hex');
}

/**
 * Check if deployment is needed based on hash comparison
 * @param {string} projectRoot - The project root directory
 * @param {string} lastDeploymentHash - The hash from last deployment
 * @returns {Promise<{needed: boolean, currentHash: string}>}
 */
export async function isDeploymentNeeded(projectRoot, lastDeploymentHash) {
  const currentHash = await calculateDeploymentHash(projectRoot);
  
  return {
    needed: currentHash !== lastDeploymentHash,
    currentHash
  };
}