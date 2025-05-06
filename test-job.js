#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get the directory from which npm test was run
const initCwd = process.env.INIT_CWD || process.cwd();
console.log(`Initial working directory: ${initCwd}`);

// Get the directory name from the path
const dirName = path.basename(initCwd);
console.log(`Directory name: ${dirName}`);

// Check if this is a job directory
const jobsDir = path.join(__dirname, 'jobs');
const isDirectJobDir = path.dirname(initCwd) === jobsDir;
console.log(`Is direct job directory: ${isDirectJobDir}`);

// Check if this is a job subdirectory
const relPath = path.relative(jobsDir, initCwd);
const isInJobDir = !relPath.startsWith('..') && relPath !== '';
const jobName = isInJobDir ? relPath.split(path.sep)[0] : null;
console.log(`Is in job directory: ${isInJobDir}, Job name: ${jobName}`);

// Build the command
let args = ['cli.js', 'runtest'];

// If we're in a job directory or subdirectory, add the job name
if (isDirectJobDir) {
  args.push('--dir', dirName);
  console.log(`Using job directory name: ${dirName}`);
} else if (jobName) {
  args.push('--dir', jobName);
  console.log(`Using job name from path: ${jobName}`);
} else {
  // Check if dirName is a valid job directory
  const possibleJobDirs = fs.readdirSync(jobsDir)
    .filter(dir => fs.statSync(path.join(jobsDir, dir)).isDirectory());

  if (possibleJobDirs.includes(dirName)) {
    args.push('--dir', dirName);
    console.log(`Using directory name as job: ${dirName}`);
  }
}

// Add any additional arguments
const extraArgs = process.argv.slice(2);
if (extraArgs.length > 0) {
  args = args.concat(extraArgs);
}

console.log(`Running command: node ${args.join(' ')}`);

// Spawn the process
const child = spawn('node', args, {
  cwd: __dirname,
  stdio: 'inherit'
});

// Handle process exit
child.on('exit', (code) => {
  process.exit(code);
});
