/**
 * Utility functions for loading job configurations
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..', '..');  // Go up two levels to get to project root

/**
 * Resolve config path for a job, checking local first then core
 */
function resolveJobConfigPath(jobPath) {
  const cleanJobPath = jobPath.replace(/^(local|core)\/jobs\//, '');
  
  const localPath = path.join(rootDir, 'local', 'jobs', cleanJobPath, 'config.json');
  const corePath = path.join(rootDir, 'core', 'jobs', cleanJobPath, 'config.json');
  
  // Check local first unless explicitly requesting core
  if (!jobPath.startsWith('core/') && fs.existsSync(localPath)) {
    return { configPath: localPath, location: 'local', cleanPath: cleanJobPath };
  }
  
  if (fs.existsSync(corePath)) {
    return { configPath: corePath, location: 'core', cleanPath: cleanJobPath };
  }
  
  throw new Error(`Job config not found for ${jobPath}`);
}

/**
 * Load trigger information for a job config
 */
function loadTriggerInfo(config) {
  if (!config.trigger) return config;
  
  try {
    const triggerConfig = loadTriggerConfig(config.trigger);
    if (triggerConfig.webhook?.topic) {
      config.webhookTopic = triggerConfig.webhook.topic;
    }
  } catch (triggerError) {
    config.triggerError = triggerError.message;
  }
  
  return config;
}

/**
 * Load the configuration for a specific job
 * @param {string} jobPath - The path of the job (e.g., 'hello-world', 'order/fetch', 'local/jobs/hello-world', 'core/jobs/order/fetch')
 * @returns {Object} The job configuration
 */
export function loadJobConfig(jobPath) {
  try {
    const { configPath, location, cleanPath } = resolveJobConfigPath(jobPath);
    const configData = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configData);

    // Add metadata to config
    config.jobPath = cleanPath;
    config.fullPath = path.join(location, 'jobs', cleanPath);

    return loadTriggerInfo(config);
  } catch (error) {
    console.error(`Error loading job config for ${jobPath}:`, error);
    return null;
  }
}

/**
 * Load trigger configuration with fallback from local to core
 */
function loadTriggerFromPath(triggerPath, location, triggerName) {
  try {
    const triggerData = fs.readFileSync(triggerPath, 'utf8');
    return JSON.parse(triggerData);
  } catch (error) {
    throw new Error(`Error loading ${location} trigger config for ${triggerName}: ${error.message}`);
  }
}

/**
 * Load a trigger configuration
 * @param {string} triggerName - The name of the trigger
 * @returns {Object} The trigger configuration
 * @throws {Error} If trigger configuration cannot be loaded
 */
export function loadTriggerConfig(triggerName) {
  const localPath = path.join(rootDir, 'local', 'triggers', `${triggerName}.json`);
  const corePath = path.join(rootDir, 'core', 'triggers', `${triggerName}.json`);
  
  if (fs.existsSync(localPath)) {
    return loadTriggerFromPath(localPath, 'local', triggerName);
  }
  
  if (fs.existsSync(corePath)) {
    return loadTriggerFromPath(corePath, 'core', triggerName);
  }
  
  throw new Error(`Trigger '${triggerName}' not found in local/triggers/ or core/triggers/`);
}

/**
 * Find all job directories in a given base directory
 */
function findJobDirectories(baseDir) {
  if (!fs.existsSync(baseDir)) return [];
  
  const dirs = fs.readdirSync(baseDir).filter(dir => 
    fs.statSync(path.join(baseDir, dir)).isDirectory()
  );
  
  const jobPaths = [];
  
  for (const dir of dirs) {
    const dirPath = path.join(baseDir, dir);
    
    // Check if this directory is a job (has config.json)
    if (fs.existsSync(path.join(dirPath, 'config.json'))) {
      jobPaths.push(dir);
      continue;
    }
    
    // Check for nested job directories
    const nestedJobs = fs.readdirSync(dirPath)
      .filter(subdir => {
        const subdirPath = path.join(dirPath, subdir);
        return fs.statSync(subdirPath).isDirectory() &&
               fs.existsSync(path.join(subdirPath, 'config.json'));
      })
      .map(subdir => path.join(dir, subdir));
    
    jobPaths.push(...nestedJobs);
  }
  
  return jobPaths;
}

/**
 * Load configurations for all jobs
 * @returns {Object} Map of job paths to their configurations
 */
export async function loadJobsConfig() {
  try {
    const jobs = {};
    const processedJobs = new Set();
    
    // Process local jobs first (higher priority)
    const localJobsDir = path.join(rootDir, 'local', 'jobs');
    const localJobPaths = findJobDirectories(localJobsDir);
    
    for (const jobPath of localJobPaths) {
      const config = loadJobConfig(jobPath);
      if (config) {
        jobs[jobPath] = config;
        processedJobs.add(jobPath);
      }
    }
    
    // Process core jobs (skip duplicates)
    const coreJobsDir = path.join(rootDir, 'core', 'jobs');
    const coreJobPaths = findJobDirectories(coreJobsDir);
    
    for (const jobPath of coreJobPaths) {
      if (!processedJobs.has(jobPath)) {
        const config = loadJobConfig(jobPath);
        if (config) {
          jobs[jobPath] = config;
        }
      }
    }

    return jobs;
  } catch (error) {
    console.error('Error loading jobs:', error);
    return {};
  }
}
