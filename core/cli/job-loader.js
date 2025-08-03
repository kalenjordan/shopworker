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
 * Load the configuration for a specific job
 * @param {string} jobPath - The path of the job (e.g., 'hello-world', 'order/fetch')
 * @returns {Object} The job configuration
 */
export function loadJobConfig(jobPath) {
  // First try local jobs directory
  let configPath = path.join(rootDir, 'local', 'jobs', jobPath, 'config.json');
  
  if (!fs.existsSync(configPath)) {
    // If not found in local, try core jobs directory
    configPath = path.join(rootDir, 'core', 'jobs', jobPath, 'config.json');
  }
  
  try {
    const configData = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configData);

    // Add the jobPath to the config for reference
    config.jobPath = jobPath;

    // If there's a trigger, load its information too
    if (config.trigger) {
      const triggerConfig = loadTriggerConfig(config.trigger);
      if (triggerConfig.webhook && triggerConfig.webhook.topic) {
        config.webhookTopic = triggerConfig.webhook.topic;
      }
    }

    return config;
  } catch (error) {
    console.error(`Error loading job config for ${jobPath}:`, error);
    return null;
  }
}

/**
 * Load a trigger configuration
 * @param {string} triggerName - The name of the trigger
 * @returns {Object} The trigger configuration
 */
export function loadTriggerConfig(triggerName) {
  const triggerPath = path.join(rootDir, 'core', 'triggers', `${triggerName}.json`);
  try {
    const triggerData = fs.readFileSync(triggerPath, 'utf8');
    return JSON.parse(triggerData);
  } catch (error) {
    console.error(`Error loading trigger config for ${triggerName}:`, error);
    return {};
  }
}

/**
 * Load configurations for all jobs
 * @returns {Object} Map of job paths to their configurations
 */
export async function loadJobsConfig() {
  const jobs = {};

  // Helper function to scan a job directory
  const scanJobDirectory = (baseDir) => {
    if (!fs.existsSync(baseDir)) return [];
    
    return fs.readdirSync(baseDir)
      .filter(dir => fs.statSync(path.join(baseDir, dir)).isDirectory())
      .flatMap(dir => {
        // Check if this is a job directory (has config.json)
        if (fs.existsSync(path.join(baseDir, dir, 'config.json'))) {
          return [dir];
        }

        // Check for nested job directories
        const nestedDir = path.join(baseDir, dir);
        return fs.readdirSync(nestedDir)
          .filter(subdir => fs.statSync(path.join(nestedDir, subdir)).isDirectory())
          .filter(subdir => fs.existsSync(path.join(nestedDir, subdir, 'config.json')))
          .map(subdir => path.join(dir, subdir));
      });
  };

  try {
    // Scan both local and core job directories
    const localJobsDir = path.join(rootDir, 'local', 'jobs');
    const coreJobsDir = path.join(rootDir, 'core', 'jobs');
    
    // Use a Set to handle potential duplicates (local takes priority)
    const processedJobs = new Set();
    
    // Process local jobs first (higher priority)
    const localJobPaths = scanJobDirectory(localJobsDir);
    for (const jobPath of localJobPaths) {
      const config = loadJobConfig(jobPath);
      if (config) {
        jobs[jobPath] = config;
        processedJobs.add(jobPath);
      }
    }
    
    // Process core jobs (skip if already processed from local)
    const coreJobPaths = scanJobDirectory(coreJobsDir);
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
