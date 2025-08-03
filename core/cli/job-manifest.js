import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Recursively finds all job directories containing both config.json and job.js
 * @param {string} dir - Directory to search
 * @param {string} baseDir - Base directory for relative paths
 * @returns {Array} Array of job paths relative to baseDir
 */
function findJobs(dir, baseDir) {
  const jobs = [];
  
  if (!fs.existsSync(dir)) {
    return jobs;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      // Check if this directory contains a job
      const configPath = path.join(fullPath, 'config.json');
      const jobPath = path.join(fullPath, 'job.js');
      
      if (fs.existsSync(configPath) && fs.existsSync(jobPath)) {
        // This is a job directory
        const relativePath = path.relative(baseDir, fullPath);
        jobs.push(relativePath);
      } else {
        // Recursively search subdirectories
        jobs.push(...findJobs(fullPath, baseDir));
      }
    }
  }
  
  return jobs;
}

/**
 * Generates a job manifest containing all available jobs and their configurations
 * @param {string} projectRoot - The project root directory
 * @returns {Object} The job manifest
 */
export function generateJobManifest(projectRoot) {
  const manifest = {
    generated: new Date().toISOString(),
    jobs: {}
  };

  // Search for jobs in core/jobs
  const coreJobsDir = path.join(projectRoot, 'core', 'jobs');
  const coreJobs = findJobs(coreJobsDir, path.join(projectRoot, 'core', 'jobs'));
  
  // Search for jobs in local/jobs
  const localJobsDir = path.join(projectRoot, 'local', 'jobs');
  const localJobs = findJobs(localJobsDir, path.join(projectRoot, 'local', 'jobs'));

  // Process core jobs
  for (const jobPath of coreJobs) {
    const configPath = path.join(coreJobsDir, jobPath, 'config.json');
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      manifest.jobs[jobPath] = {
        source: 'core',
        configPath: `../jobs/${jobPath}/config.json`,
        jobPath: `../jobs/${jobPath}/job.js`,
        config: config
      };
    } catch (error) {
      console.warn(`Failed to read config for core job ${jobPath}:`, error.message);
    }
  }

  // Process local jobs (overrides core jobs with same path)
  for (const jobPath of localJobs) {
    const configPath = path.join(localJobsDir, jobPath, 'config.json');
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      manifest.jobs[jobPath] = {
        source: 'local',
        configPath: `../../local/jobs/${jobPath}/config.json`,
        jobPath: `../../local/jobs/${jobPath}/job.js`,
        config: config
      };
    } catch (error) {
      console.warn(`Failed to read config for local job ${jobPath}:`, error.message);
    }
  }

  return manifest;
}

/**
 * Writes the job manifest to a file
 * @param {string} projectRoot - The project root directory
 * @param {Object} manifest - The job manifest
 */
export function writeJobManifest(projectRoot, manifest) {
  const manifestPath = path.join(projectRoot, 'job-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`Job manifest written to ${manifestPath}`);
  console.log(`Found ${Object.keys(manifest.jobs).length} jobs (${Object.values(manifest.jobs).filter(j => j.source === 'core').length} core, ${Object.values(manifest.jobs).filter(j => j.source === 'local').length} local)`);
}

/**
 * Generates and writes the job manifest
 * @param {string} projectRoot - The project root directory
 */
export function updateJobManifest(projectRoot) {
  console.log('Generating job manifest...');
  const manifest = generateJobManifest(projectRoot);
  writeJobManifest(projectRoot, manifest);
}