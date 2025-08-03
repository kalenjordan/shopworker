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
 * Generates a job loader module that statically imports all jobs
 * This allows Cloudflare Workers to bundle all job modules at build time
 */
export function generateJobLoader() {
  const projectRoot = path.resolve(__dirname, '../..');
  
  // Find all jobs in core and local directories
  const coreJobsDir = path.join(projectRoot, 'core', 'jobs');
  const localJobsDir = path.join(projectRoot, 'local', 'jobs');
  
  const coreJobs = findJobs(coreJobsDir, path.join(projectRoot, 'core', 'jobs'));
  const localJobs = findJobs(localJobsDir, path.join(projectRoot, 'local', 'jobs'));
  
  // Track all jobs with their source
  const allJobs = new Map();
  
  // Add core jobs
  for (const jobPath of coreJobs) {
    allJobs.set(jobPath, { source: 'core', path: jobPath });
  }
  
  // Add local jobs (overrides core if same path)
  for (const jobPath of localJobs) {
    allJobs.set(jobPath, { source: 'local', path: jobPath });
  }
  
  // Generate import statements for each job
  const imports = [];
  const jobModules = [];
  
  let index = 0;
  for (const [jobPath, jobInfo] of allJobs) {
    const varName = `job_${index}`;
    const configVarName = `config_${index}`;
    
    // Determine the actual file path based on source
    let importPath;
    if (jobInfo.source === 'core') {
      importPath = `../jobs/${jobPath}/job.js`;
    } else {
      importPath = `../../local/jobs/${jobPath}/job.js`;
    }
    
    imports.push(`import * as ${varName} from '${importPath}';`);
    imports.push(`import ${configVarName} from '${importPath.replace('/job.js', '/config.json')}';`);
    
    jobModules.push(`  '${jobPath}': {
    module: ${varName},
    config: ${configVarName}
  }`);
    
    index++;
  }
  
  // Generate the job loader module
  const loaderContent = `/**
 * Auto-generated job loader for Cloudflare Workers
 * This file statically imports all jobs to ensure they're bundled at build time
 * Generated at: ${new Date().toISOString()}
 */

${imports.join('\n')}

export const jobModules = {
${jobModules.join(',\n')}
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
`;
  
  const outputPath = path.join(projectRoot, 'core/worker/job-loader-generated.js');
  fs.writeFileSync(outputPath, loaderContent, 'utf8');
  
  console.log(`Generated job loader at ${outputPath}`);
  console.log(`Bundled ${allJobs.size} jobs (${coreJobs.length} core, ${localJobs.length} local)`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  generateJobLoader();
}