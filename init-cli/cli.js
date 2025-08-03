#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import prompts from 'prompts';
import { execa } from 'execa';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readdir } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function checkCommand(command) {
  try {
    await execa(command, ['--version']);
    return true;
  } catch {
    return false;
  }
}

async function createShopworkerInstance() {
  console.log(chalk.blue.bold('\n🛍️  Create Shopworker Instance\n'));

  // Check prerequisites
  const spinner = ora('Checking prerequisites...').start();
  
  const hasGit = await checkCommand('git');
  const hasGh = await checkCommand('gh');
  
  if (!hasGit || !hasGh) {
    spinner.fail('Missing prerequisites');
    console.log(chalk.red('\nRequired tools missing:'));
    if (!hasGit) console.log(chalk.red('  - git'));
    if (!hasGh) console.log(chalk.red('  - gh (GitHub CLI)'));
    console.log(chalk.yellow('\nPlease install missing tools and try again.'));
    process.exit(1);
  }
  
  spinner.succeed('Prerequisites checked');

  // Check if current directory is empty
  const currentDir = process.cwd();
  const currentDirName = path.basename(currentDir);
  let isEmptyDir = false;
  
  try {
    const files = await fs.readdir(currentDir);
    // Consider directory empty if it only has hidden files like .git, .DS_Store
    const visibleFiles = files.filter(f => !f.startsWith('.'));
    isEmptyDir = visibleFiles.length === 0;
  } catch (error) {
    console.error(chalk.red('Failed to read current directory'));
    process.exit(1);
  }

  // Get GitHub username
  const ghSpinner = ora('Fetching GitHub account info...').start();
  let ghUser;
  try {
    const { stdout } = await execa('gh', ['api', 'user', '--jq', '.login']);
    ghUser = stdout.trim();
    ghSpinner.succeed(`GitHub account: ${ghUser}`);
  } catch (error) {
    ghSpinner.fail('Failed to get GitHub username');
    console.error(chalk.red(error.message));
    process.exit(1);
  }

  // Build prompts based on current directory state
  const prompts_config = [
    {
      type: 'text',
      name: 'repoName',
      message: 'Repository name:',
      initial: isEmptyDir ? currentDirName : `shopworker-${ghUser}`,
      validate: value => value.match(/^[a-z0-9-_]+$/) ? true : 'Use lowercase letters, numbers, hyphens, and underscores only'
    },
    {
      type: 'confirm',
      name: 'isPrivate',
      message: 'Create private repository?',
      initial: true
    }
  ];

  // Only ask for directory if not in empty directory
  if (!isEmptyDir) {
    prompts_config.push({
      type: 'text',
      name: 'directory',
      message: 'Directory name for Shopworker instance:',
      initial: (prev, values) => values.repoName,
      validate: value => value.match(/^[a-z0-9-_]+$/) ? true : 'Use lowercase letters, numbers, hyphens, and underscores only'
    });
  }

  if (isEmptyDir) {
    console.log(chalk.cyan(`\nUsing current directory: ${currentDirName}\n`));
  }

  // Get configuration from user
  const response = await prompts(prompts_config);

  if (Object.keys(response).length === 0) {
    console.log(chalk.yellow('\nSetup cancelled.'));
    process.exit(0);
  }

  const { repoName, isPrivate, directory } = response;
  const mainRepoUrl = 'https://github.com/kalenjordan/shopworker.git';
  let targetDir;

  if (isEmptyDir) {
    // Use current directory
    targetDir = currentDir;
    
    // Clone main Shopworker repository contents into current directory
    const cloneMainSpinner = ora('Cloning main Shopworker repository...').start();
    try {
      // Git clone directly into current directory
      await execa('git', ['clone', mainRepoUrl, '.']);
      cloneMainSpinner.succeed('Main Shopworker repository cloned');
    } catch (error) {
      cloneMainSpinner.fail('Failed to clone main repository');
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  } else {
    // Create new directory
    targetDir = path.join(currentDir, directory);
    
    // Check if directory already exists
    const dirExists = await fs.access(directory).then(() => true).catch(() => false);
    if (dirExists) {
      console.log(chalk.red(`\nDirectory "${directory}" already exists.`));
      console.log(chalk.yellow('Please choose a different directory name or remove the existing one.'));
      process.exit(1);
    }

    // Clone main Shopworker repository
    const cloneMainSpinner = ora('Cloning main Shopworker repository...').start();
    try {
      await execa('git', ['clone', mainRepoUrl, directory]);
      cloneMainSpinner.succeed('Main Shopworker repository cloned');
    } catch (error) {
      cloneMainSpinner.fail('Failed to clone main repository');
      console.error(chalk.red(error.message));
      process.exit(1);
    }

    // Change to the new directory
    process.chdir(directory);
  }

  // Create account repository
  const createRepoSpinner = ora('Creating GitHub repository...').start();
  try {
    const visibility = isPrivate ? '--private' : '--public';
    await execa('gh', ['repo', 'create', repoName, visibility, '--description', `Shopworker instance`]);
    createRepoSpinner.succeed('GitHub repository created');
  } catch (error) {
    createRepoSpinner.fail('Failed to create repository');
    console.error(chalk.red(error.message));
    process.exit(1);
  }

  // Clone account repository to temp location
  const cloneSpinner = ora('Setting up account repository...').start();
  const tempDir = path.join(process.cwd(), `.shopworker-temp-${Date.now()}`);
  try {
    const accountRepoUrl = `https://github.com/${ghUser}/${repoName}.git`;
    await execa('git', ['clone', accountRepoUrl, tempDir]);
    
    // Copy template files
    const templateDir = path.join(__dirname, 'template');
    await copyTemplateFiles(templateDir, tempDir, { accountName: repoName, repoName });
    
    // Commit template files
    const cwd = process.cwd();
    process.chdir(tempDir);
    await execa('git', ['add', '.']);
    await execa('git', ['commit', '-m', 'Initial commit']);
    await execa('git', ['push', '-u', 'origin', 'main']);
    process.chdir(cwd);
    
    cloneSpinner.succeed('Account repository initialized');
  } catch (error) {
    cloneSpinner.fail('Failed to set up account repository');
    console.error(chalk.red(error.message));
    await execa('rm', ['-rf', tempDir]).catch(() => {});
    process.exit(1);
  }

  // Set up git worktree
  const worktreeSpinner = ora('Setting up git worktree...').start();
  try {
    // Add the account repository as a remote
    const accountRepoUrl = `https://github.com/${ghUser}/${repoName}.git`;
    await execa('git', ['remote', 'add', 'account', accountRepoUrl]);
    
    // Fetch from the account remote
    await execa('git', ['fetch', 'account']);
    
    // Add worktree for the account repository in local directory
    await execa('git', ['worktree', 'add', '-b', 'local', 'local', 'account/main']);
    
    // Clean up temp directory
    await execa('rm', ['-rf', tempDir]);
    
    worktreeSpinner.succeed('Git worktree configured');
  } catch (error) {
    worktreeSpinner.fail('Failed to set up worktree');
    console.error(chalk.red(error.message));
    await execa('rm', ['-rf', tempDir]).catch(() => {});
    process.exit(1);
  }

  // Update .gitignore to exclude local directory
  const gitignoreSpinner = ora('Updating .gitignore...').start();
  try {
    let gitignoreContent = '';
    try {
      gitignoreContent = await fs.readFile('.gitignore', 'utf8');
    } catch (error) {
      // .gitignore doesn't exist, that's ok
    }
    
    if (!gitignoreContent.includes('/local')) {
      gitignoreContent += '\n# Account-specific local directory\n/local\n';
      await fs.writeFile('.gitignore', gitignoreContent);
    }
    
    gitignoreSpinner.succeed('.gitignore updated');
  } catch (error) {
    gitignoreSpinner.warn('Failed to update .gitignore');
  }

  // Success message
  console.log(chalk.green.bold('\n✅ Shopworker instance created successfully!\n'));
  console.log(chalk.cyan('Structure:'));
  if (isEmptyDir) {
    console.log(chalk.white(`  ${currentDirName}/`));
  } else {
    console.log(chalk.white(`  ${directory}/`));
  }
  console.log(chalk.white('    ├── core/     - Main Shopworker code'));
  console.log(chalk.white('    └── local/    - Your account-specific code (git worktree)'));
  console.log(chalk.white('        ├── jobs/'));
  console.log(chalk.white('        ├── triggers/'));
  console.log(chalk.white('        └── connectors/\n'));
  
  console.log(chalk.cyan('Next steps:'));
  if (!isEmptyDir) {
    console.log(chalk.white(`  1. cd ${directory}`));
    console.log(chalk.white('  2. Configure .shopworker.json with your Shopify credentials'));
    console.log(chalk.white('  3. Set up .env with your environment variables'));
    console.log(chalk.white('  4. Install dependencies: npm install'));
    console.log(chalk.white('  5. Create your custom jobs in local/jobs/'));
    console.log(chalk.white('  6. Deploy with: npm run deploy\n'));
  } else {
    console.log(chalk.white('  1. Configure .shopworker.json with your Shopify credentials'));
    console.log(chalk.white('  2. Set up .env with your environment variables'));
    console.log(chalk.white('  3. Install dependencies: npm install'));
    console.log(chalk.white('  4. Create your custom jobs in local/jobs/'));
    console.log(chalk.white('  5. Deploy with: npm run deploy\n'));
  }
  
  console.log(chalk.gray(`Account repository: https://github.com/${ghUser}/${repoName}`));
  console.log(chalk.gray(`Git remote name: account`));
}

async function copyTemplateFiles(src, dest, replacements) {
  const entries = await readdir(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true });
      await copyTemplateFiles(srcPath, destPath, replacements);
    } else {
      let content = await fs.readFile(srcPath, 'utf8');
      
      // Replace placeholders
      for (const [key, value] of Object.entries(replacements)) {
        content = content.replace(new RegExp(`\\{${key.toUpperCase()}\\}`, 'g'), value);
      }
      
      await fs.writeFile(destPath, content);
    }
  }
}

program
  .name('create-shopworker')
  .description('Create a new Shopworker instance with git worktrees')
  .version('1.0.0')
  .action(createShopworkerInstance);

program.parse();