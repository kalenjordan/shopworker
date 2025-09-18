import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Recursively finds all job directories containing both a config file (config.js or config.json) and job.js
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
      const configJsonPath = path.join(fullPath, 'config.json');
      const configJsPath = path.join(fullPath, 'config.js');
      const jobPath = path.join(fullPath, 'job.js');

      // Check for either config.js or config.json
      const hasConfig = fs.existsSync(configJsPath) || fs.existsSync(configJsonPath);

      if (hasConfig && fs.existsSync(jobPath)) {
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
 * Generates a job manifest module that statically imports all jobs
 * This allows Cloudflare Workers to bundle all job modules at build time
 */
export function generateJobManifest() {
  const projectRoot = path.resolve(__dirname, '../..');
  
  // Find all jobs in core and local directories
  const coreJobsDir = path.join(projectRoot, 'core', 'jobs');
  const localJobsDir = path.join(projectRoot, 'local', 'jobs');
  
  const coreJobs = findJobs(coreJobsDir, path.join(projectRoot, 'core', 'jobs'));
  const localJobs = findJobs(localJobsDir, path.join(projectRoot, 'local', 'jobs'));
  
  // Track all jobs with their source and validate uniqueness by job name
  const allJobs = new Map();
  const jobNameMap = new Map(); // jobName -> { source, fullPath }
  
  // Add core jobs
  for (const jobPath of coreJobs) {
    // Use the full path as the job name (e.g., "order/create-test" or "hello-world")
    const jobName = jobPath;
    allJobs.set(jobPath, { source: 'core', path: jobPath, name: jobName });
    jobNameMap.set(jobName, { source: 'core', fullPath: `core/jobs/${jobPath}` });
  }
  
  // Add local jobs and check for conflicts
  for (const jobPath of localJobs) {
    // Use the full path as the job name (e.g., "quiz-get" or "some/nested/job")
    const jobName = jobPath;
    
    if (jobNameMap.has(jobName)) {
      const existing = jobNameMap.get(jobName);
      throw new Error(
        `Job name conflict: "${jobName}" exists in both ${existing.source} (${existing.fullPath}) and local (local/jobs/${jobPath}). ` +
        `Job names must be unique across core and local directories.`
      );
    }
    
    allJobs.set(jobPath, { source: 'local', path: jobPath, name: jobName });
    jobNameMap.set(jobName, { source: 'local', fullPath: `local/jobs/${jobPath}` });
  }
  
  // Generate import statements for each job
  const imports = [];
  const jobModules = [];
  
  let index = 0;
  for (const [jobPath, jobInfo] of allJobs) {
    const varName = `job_${index}`;
    const configVarName = `config_${index}`;

    // Determine the actual file path based on source (relative to project root)
    let importPath;
    let configImportPath;
    if (jobInfo.source === 'core') {
      importPath = `./core/jobs/${jobPath}/job.js`;
      // Check which config file exists
      const configJsPath = path.join(projectRoot, 'core', 'jobs', jobPath, 'config.js');
      const configJsonPath = path.join(projectRoot, 'core', 'jobs', jobPath, 'config.json');
      if (fs.existsSync(configJsPath)) {
        configImportPath = `./core/jobs/${jobPath}/config.js`;
      } else {
        configImportPath = `./core/jobs/${jobPath}/config.json`;
      }
    } else {
      importPath = `./local/jobs/${jobPath}/job.js`;
      // Check which config file exists
      const configJsPath = path.join(projectRoot, 'local', 'jobs', jobPath, 'config.js');
      const configJsonPath = path.join(projectRoot, 'local', 'jobs', jobPath, 'config.json');
      if (fs.existsSync(configJsPath)) {
        configImportPath = `./local/jobs/${jobPath}/config.js`;
      } else {
        configImportPath = `./local/jobs/${jobPath}/config.json`;
      }
    }

    imports.push(`import * as ${varName} from '${importPath}';`);
    imports.push(`import ${configVarName} from '${configImportPath}';`);
    
    jobModules.push(`  '${jobPath}': {
    module: ${varName},
    config: ${configVarName}
  }`);
    
    index++;
  }
  
  // Generate the job manifest module
  const loaderContent = `/**
 * Auto-generated job manifest for Cloudflare Workers
 * This file statically imports all jobs to ensure they're bundled at build time
 */

${imports.join('\n')}

export const jobModules = {
${jobModules.join(',\n')}
};

// Job name to path mapping for clean URL routing
export const jobNameToPath = {
${Array.from(jobNameMap.entries()).map(([name, info]) => 
  `  '${name}': '${info.fullPath.replace(/^(core|local)\/jobs\//, '')}'`
).join(',\n')}
};

export function getJobModule(jobPath) {
  const job = jobModules[jobPath];
  if (!job) {
    throw new Error(\`Job not found: \${jobPath}\`);
  }
  return job.module;
}

export function getJobConfig(jobPath) {
  const job = jobModules[jobPath];
  if (!job) {
    throw new Error(\`Job not found: \${jobPath}\`);
  }
  return job.config;
}

export function getJobPathFromName(jobName) {
  const jobPath = jobNameToPath[jobName];
  if (!jobPath) {
    throw new Error(\`Job not found: \${jobName}\`);
  }
  return jobPath;
}
`;
  
  const outputPath = path.join(projectRoot, 'job-manifest.js');
  fs.writeFileSync(outputPath, loaderContent, 'utf8');

  console.log(`Generated job manifest at ${outputPath}`);
  console.log(`Bundled ${allJobs.size} jobs (${coreJobs.length} core, ${localJobs.length} local)`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  generateJobManifest();
}