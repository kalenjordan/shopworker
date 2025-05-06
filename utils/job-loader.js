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
 * @param {string} jobName - The name of the job
 * @returns {Object} The job configuration
 */
export function loadJobConfig(jobName) {
  const configPath = path.join(rootDir, 'jobs', jobName, 'config.json');
  try {
    const configData = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configData);

    // If there's a trigger, load its information too
    if (config.trigger) {
      const triggerConfig = loadTriggerConfig(config.trigger);
      if (triggerConfig.webhook && triggerConfig.webhook.topic) {
        config.webhookTopic = triggerConfig.webhook.topic;
      }
    }

    return config;
  } catch (error) {
    console.error(`Error loading job config for ${jobName}:`, error);
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
 * @returns {Object} Map of job names to their configurations
 */
export async function loadJobsConfig() {
  const jobsDir = path.join(rootDir, 'jobs');
  const jobs = {};

  try {
    const jobDirs = fs.readdirSync(jobsDir)
      .filter(dir => fs.statSync(path.join(jobsDir, dir)).isDirectory());

    for (const jobName of jobDirs) {
      const config = loadJobConfig(jobName);
      if (config) {
        jobs[jobName] = config;
      }
    }

    return jobs;
  } catch (error) {
    console.error('Error loading jobs:', error);
    return {};
  }
}
