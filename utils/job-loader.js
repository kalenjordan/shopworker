/**
 * Utility functions for loading job configurations
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

/**
 * Load the configuration for a specific job
 * @param {string} jobPath - The path of the job relative to jobs/
 * @returns {Object} The job configuration
 */
export function loadJobConfig(jobPath) {
  const configPath = path.join(rootDir, 'jobs', jobPath, 'config.json');
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
  const triggerPath = path.join(rootDir, 'triggers', `${triggerName}.json`);
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
  const jobsDir = path.join(rootDir, 'jobs');
  const jobs = {};

  try {
    const jobPaths = fs.readdirSync(jobsDir)
      .filter(dir => fs.statSync(path.join(jobsDir, dir)).isDirectory())
      .flatMap(dir => {
        // Check if this is a job directory (has config.json)
        if (fs.existsSync(path.join(jobsDir, dir, 'config.json'))) {
          return [dir];
        }

        // Check for nested job directories
        const nestedDir = path.join(jobsDir, dir);
        return fs.readdirSync(nestedDir)
          .filter(subdir => fs.statSync(path.join(nestedDir, subdir)).isDirectory())
          .filter(subdir => fs.existsSync(path.join(nestedDir, subdir, 'config.json')))
          .map(subdir => path.join(dir, subdir));
      });

    for (const jobPath of jobPaths) {
      const config = loadJobConfig(jobPath);
      if (config) {
        jobs[jobPath] = config;
      }
    }

    return jobs;
  } catch (error) {
    console.error('Error loading jobs:', error);
    return {};
  }
}
