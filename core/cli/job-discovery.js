/**
 * Job discovery and configuration loading utilities
 * Consolidated from job-loader.js and job-management.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..', '..');  // Go up two levels to get to project root

// ===================================================================
// Job Configuration Loading (from job-loader.js)
// ===================================================================

/**
 * Resolve config path for a job, checking local first then core
 * Supports both config.js and config.json (with config.js taking precedence)
 */
function resolveJobConfigPath(jobPath) {
  const cleanJobPath = jobPath.replace(/^(local|core)\/jobs\//, '');

  // Check for both .js and .json extensions
  const tryPaths = [
    { base: path.join(rootDir, 'local', 'jobs', cleanJobPath), location: 'local' },
    { base: path.join(rootDir, 'core', 'jobs', cleanJobPath), location: 'core' },
    { base: path.join(rootDir, jobPath), location: jobPath.includes('local/') ? 'local' : 'core' }
  ];

  // Try each path with both extensions
  for (const { base, location } of tryPaths) {
    // Skip core paths if explicitly not requesting core
    if (location === 'core' && !jobPath.startsWith('core/') && tryPaths[0].location === 'local') {
      // Only check core if local doesn't exist
      const localJs = path.join(tryPaths[0].base, 'config.js');
      const localJson = path.join(tryPaths[0].base, 'config.json');
      if (fs.existsSync(localJs) || fs.existsSync(localJson)) {
        continue;
      }
    }

    // Check for config.js first (takes precedence)
    const jsPath = path.join(base, 'config.js');
    if (fs.existsSync(jsPath)) {
      return { configPath: jsPath, location, cleanPath: cleanJobPath, isJs: true };
    }

    // Then check for config.json
    const jsonPath = path.join(base, 'config.json');
    if (fs.existsSync(jsonPath)) {
      return { configPath: jsonPath, location, cleanPath: cleanJobPath, isJs: false };
    }
  }

  return null;
}

/**
 * Load a job configuration from a config.js or config.json file
 * @param {string} jobPath - The job path relative to jobs/ or fully qualified path
 * @returns {Object} The job configuration
 */
export async function loadJobConfig(jobPath) {
  try {
    const resolved = resolveJobConfigPath(jobPath);
    if (!resolved) {
      throw new Error(`Config file not found for job: ${jobPath}`);
    }

    const { configPath, location, cleanPath: cleanJobPath, isJs } = resolved;
    const jobLocation = location;

    let config;

    if (isJs) {
      // Import the JS module
      const configModule = await import(configPath);
      // Support both default export and named export
      config = configModule.default || configModule.config || configModule;

      // If the module exports a function, call it
      if (typeof config === 'function') {
        config = config();
      }
    } else {
      // Load JSON file
      const configData = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(configData);
    }

    // Add the jobPath and full path to the config for reference
    config.jobPath = cleanJobPath;
    config.fullPath = path.join(jobLocation, 'jobs', cleanJobPath);

    // If there's a trigger, load its information too
    if (config.trigger) {
      try {
        const triggerConfig = loadTriggerConfig(config.trigger);
        if (triggerConfig.webhook && triggerConfig.webhook.topic) {
          config.webhookTopic = triggerConfig.webhook.topic;
        }
      } catch (triggerError) {
        // Still return the config but with trigger error info
        config.triggerError = triggerError.message;
      }
    }

    return config;
  } catch (error) {
    console.error(`Error loading job config for ${jobPath}:`, error);
    return null;
  }
}

/**
 * Load trigger information for a job config
 */
function loadTriggerInfo(config) {
  if (!config.trigger) return;
  
  try {
    const triggerConfig = loadTriggerConfig(config.trigger);
    if (triggerConfig.webhook && triggerConfig.webhook.topic) {
      config.webhookTopic = triggerConfig.webhook.topic;
    }
  } catch (triggerError) {
    config.triggerError = triggerError.message;
  }
}

/**
 * Load trigger from a specific path
 */
function loadTriggerFromPath(triggerPath) {
  if (!fs.existsSync(triggerPath)) {
    return null;
  }
  
  try {
    const triggerData = fs.readFileSync(triggerPath, 'utf8');
    return JSON.parse(triggerData);
  } catch (error) {
    throw new Error(`Error parsing trigger file: ${error.message}`);
  }
}

/**
 * Load a trigger configuration
 * @param {string} triggerName - The name of the trigger
 * @returns {Object} The trigger configuration
 * @throws {Error} If trigger configuration cannot be loaded
 */
export function loadTriggerConfig(triggerName) {
  // Try loading from local triggers first
  const localTriggerPath = path.join(rootDir, 'local', 'triggers', `${triggerName}.json`);
  if (fs.existsSync(localTriggerPath)) {
    try {
      const triggerData = fs.readFileSync(localTriggerPath, 'utf8');
      return JSON.parse(triggerData);
    } catch (error) {
      throw new Error(`Error loading local trigger config for ${triggerName}: ${error.message}`);
    }
  }
  
  // Fall back to core triggers
  const coreTriggerPath = path.join(rootDir, 'core', 'triggers', `${triggerName}.json`);
  if (fs.existsSync(coreTriggerPath)) {
    try {
      const triggerData = fs.readFileSync(coreTriggerPath, 'utf8');
      return JSON.parse(triggerData);
    } catch (error) {
      throw new Error(`Error loading core trigger config for ${triggerName}: ${error.message}`);
    }
  }
  
  // Trigger not found
  throw new Error(`Trigger '${triggerName}' not found in local/triggers/ or core/triggers/`);
}

/**
 * Load configurations for all jobs
 * @returns {Object} Map of job paths to their configurations
 */
export async function loadJobsConfig() {
  const jobs = {};
  const loadPromises = [];

  // Helper function to scan a job directory
  const scanJobDirectory = (jobsDir, prefix) => {
    if (!fs.existsSync(jobsDir)) return;

    const findJobDirectories = (dir, relativePath = '') => {
      const entries = fs.readdirSync(dir);

      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const entryRelativePath = relativePath ? path.join(relativePath, entry) : entry;

        if (fs.statSync(fullPath).isDirectory()) {
          // Check for config.js or config.json
          const hasConfigJs = fs.existsSync(path.join(fullPath, 'config.js'));
          const hasConfigJson = fs.existsSync(path.join(fullPath, 'config.json'));

          if (hasConfigJs || hasConfigJson) {
            const fullJobPath = path.join(prefix, 'jobs', entryRelativePath);
            const promise = loadJobConfig(fullJobPath).then(config => {
              if (config) {
                jobs[fullJobPath] = config;
              }
            }).catch(err => {
              console.error(`Error loading config for ${fullJobPath}:`, err);
            });
            loadPromises.push(promise);
          }
          // Recurse into subdirectories
          findJobDirectories(fullPath, entryRelativePath);
        }
      }
    };

    findJobDirectories(jobsDir);
  };

  // Scan both local and core directories
  scanJobDirectory(path.join(rootDir, 'local', 'jobs'), 'local');
  scanJobDirectory(path.join(rootDir, 'core', 'jobs'), 'core');

  // Wait for all configs to load
  await Promise.all(loadPromises);

  return jobs;
}

// ===================================================================
// Job Discovery and Management (from job-management.js)
// ===================================================================

/**
 * Get all available job directories
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} [currentDir] - If provided, only return jobs under this directory
 * @returns {Array<string>} List of job directory paths relative to jobs/ (e.g., 'hello-world', 'order/fetch')
 */
export const getAvailableJobDirs = (cliDirname, currentDir = null) => {
  const jobDirs = new Set(); // Use Set to avoid duplicates

  // Helper function to recursively find directories with config.json, with correct prefixing
  const findJobDirsWithPrefix = (dir, prefix) => {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir);

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const entryRelativePath = prefix ? path.join(prefix, entry) : entry;

      if (fs.statSync(fullPath).isDirectory()) {
        // Check if this directory contains a config.js or config.json file
        const hasConfigJs = fs.existsSync(path.join(fullPath, 'config.js'));
        const hasConfigJson = fs.existsSync(path.join(fullPath, 'config.json'));

        if (hasConfigJs || hasConfigJson) {
          jobDirs.add(entryRelativePath);
        }

        // Recursively search subdirectories
        findJobDirsWithPrefix(fullPath, entryRelativePath);
      }
    }
  };

  // If currentDir is provided, check if we're in a local or core context
  if (currentDir) {
    const relativePath = path.relative(cliDirname, currentDir);
    
    // Check if we're in local/jobs or core/jobs
    if (relativePath.startsWith('local/jobs') || relativePath.startsWith('local\\jobs')) {
      const localJobsBase = path.join(cliDirname, 'local', 'jobs');
      const jobSubpath = path.relative(localJobsBase, currentDir);
      
      // Search from the current directory within local/jobs
      findJobDirsWithPrefix(currentDir, path.join('local/jobs', jobSubpath));
    } else if (relativePath.startsWith('core/jobs') || relativePath.startsWith('core\\jobs')) {
      const coreJobsBase = path.join(cliDirname, 'core', 'jobs');
      const jobSubpath = path.relative(coreJobsBase, currentDir);
      
      // Search from the current directory within core/jobs
      findJobDirsWithPrefix(currentDir, path.join('core/jobs', jobSubpath));
    } else {
      // Not in a jobs directory, return all jobs
      findJobDirsWithPrefix(path.join(cliDirname, 'local', 'jobs'), 'local/jobs');
      findJobDirsWithPrefix(path.join(cliDirname, 'core', 'jobs'), 'core/jobs');
    }
  } else {
    // No current directory specified, return all jobs
    findJobDirsWithPrefix(path.join(cliDirname, 'local', 'jobs'), 'local/jobs');
    findJobDirsWithPrefix(path.join(cliDirname, 'core', 'jobs'), 'core/jobs');
  }

  return Array.from(jobDirs);
};

/**
 * Ensure a job name is provided and resolve it to a valid job directory
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string|null} jobNameArg - Job name from command line argument (optional)
 * @param {string|null} jobDirOption - Job directory from --dir option (optional)
 * @param {boolean} throwOnError - Whether to throw an error if job is not found (default: true)
 * @returns {string|null} The resolved job directory path, or null if not found and throwOnError is false
 */
export const ensureAndResolveJobName = async (cliDirname, jobNameArg, jobDirOption, throwOnError = true) => {
  // First check if job name was provided as argument
  if (jobNameArg) {
    // Clean up the job name - remove any local/jobs or core/jobs prefix
    const cleanJobName = jobNameArg.replace(/^(local|core)\/jobs\//, '');
    
    // Try to load the job config to verify it exists
    const config = await loadJobConfig(cleanJobName);
    if (config) {
      // Return the full path from the config
      return config.fullPath;
    }
    
    // If not found and throwOnError is true, throw an error
    if (throwOnError) {
      throw new Error(`Job '${jobNameArg}' not found`);
    }
    return null;
  }

  // If directory option is provided, use it
  if (jobDirOption) {
    // Clean up the job directory path
    const cleanJobDir = jobDirOption.replace(/^(local|core)\/jobs\//, '');
    
    // Try to load the job config to verify it exists
    const config = await loadJobConfig(cleanJobDir);
    if (config) {
      return config.fullPath;
    }
    
    if (throwOnError) {
      throw new Error(`Job directory '${jobDirOption}' not found`);
    }
    return null;
  }

  // Try to detect from current directory
  const detectedJob = detectJobDirectory(cliDirname, process.cwd());
  if (detectedJob) {
    return detectedJob;
  }

  // No job found
  if (throwOnError) {
    throw new Error('No job specified. Use a job name argument or --dir option, or run from a job directory.');
  }
  return null;
};

/**
 * Detect if the current directory is within a job directory
 * @param {string} cliDirname - The directory where cli.js is located (project root)
 * @param {string} currentDir - The current working directory
 * @returns {string|null} The job directory path if found, null otherwise
 */
export const detectJobDirectory = (cliDirname, currentDir) => {
  // Handle missing currentDir
  if (!currentDir) {
    currentDir = process.cwd();
  }
  
  // Get the relative path from project root to current directory
  const relativePath = path.relative(cliDirname, currentDir);
  
  // Check if we're in a jobs directory
  if (!relativePath.includes('jobs')) {
    return null;
  }

  // Walk up the directory tree looking for a config.json file
  let checkDir = currentDir;
  const projectRoot = path.resolve(cliDirname);
  
  while (checkDir.startsWith(projectRoot) && checkDir !== projectRoot) {
    // Check if this directory has a config.js or config.json file
    const hasConfigJs = fs.existsSync(path.join(checkDir, 'config.js'));
    const hasConfigJson = fs.existsSync(path.join(checkDir, 'config.json'));

    if (hasConfigJs || hasConfigJson) {
      // Found a job directory - determine its path relative to the jobs root
      const relativeToRoot = path.relative(cliDirname, checkDir);

      // Return the full path format (e.g., "local/jobs/my-job" or "core/jobs/my-job")
      if (relativeToRoot.includes('local') && relativeToRoot.includes('jobs')) {
        return relativeToRoot;
      } else if (relativeToRoot.includes('core') && relativeToRoot.includes('jobs')) {
        return relativeToRoot;
      }
    }

    // Move up one directory
    checkDir = path.dirname(checkDir);
  }
  
  return null;
};

/**
 * Load and validate webhook configurations for all jobs
 * @param {string} cliDirname - The directory where cli.js is located
 * @returns {Object} Object with validConfigs array and errors array
 */
export const loadAndValidateWebhookConfigs = async (cliDirname) => {
  const validConfigs = [];
  const errors = [];

  const jobDirs = getAvailableJobDirs(cliDirname);

  for (const jobDir of jobDirs) {
    try {
      const config = await loadJobConfig(jobDir);
      if (!config) {
        errors.push({ job: jobDir, error: 'Could not load config' });
        continue;
      }
      
      // Check if job has a trigger
      if (!config.trigger) {
        // Jobs without triggers are valid but won't have webhooks
        continue;
      }
      
      // Try to load trigger config
      try {
        const triggerConfig = loadTriggerConfig(config.trigger);
        if (triggerConfig.webhook && triggerConfig.webhook.topic) {
          // This job has a valid webhook configuration
          validConfigs.push({
            jobPath: jobDir,
            config: config,
            triggerConfig: triggerConfig
          });
        }
      } catch (triggerError) {
        errors.push({ 
          job: jobDir, 
          error: `Trigger error: ${triggerError.message}` 
        });
      }
    } catch (error) {
      errors.push({ 
        job: jobDir, 
        error: error.message 
      });
    }
  }
  
  return { validConfigs, errors };
};