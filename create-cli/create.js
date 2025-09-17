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
    // Enhanced PATH to ensure homebrew and common locations are included
    const enhancedPath = [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      process.env.PATH
    ].join(':');

    // First try the command directly with enhanced PATH
    const result = await execa(command, ['--version'], {
      reject: false,
      stdio: 'pipe',
      env: {
        ...process.env,
        PATH: enhancedPath
      },
      timeout: 5000 // 5 second timeout
    });

    if (result && result.exitCode === 0) return true;

    // If that fails, try to find it with which
    const whichResult = await execa('which', [command], {
      reject: false,
      stdio: 'pipe',
      env: {
        ...process.env,
        PATH: enhancedPath
      }
    });

    return whichResult && whichResult.exitCode === 0;
  } catch (error) {
    console.error(chalk.gray(`Error checking ${command}: ${error.message}`));
    return false;
  }
}

async function createShopworkerInstance() {
  console.log(chalk.blue.bold('\n🛍️  Create Shopworker Instance\n'));

  // Check if current directory is valid
  try {
    process.cwd();
  } catch (error) {
    console.log(chalk.red('\n❌ Error: Current directory is invalid.'));
    console.log(chalk.yellow('This usually happens after deleting and recreating the directory you\'re in.'));
    console.log(chalk.yellow('\nPlease run: cd "$(pwd)" to refresh your shell\'s directory.\n'));
    process.exit(1);
  }

  // Load default credentials if available
  let defaultCredentials = {};
  try {
    const defaultCredPath = path.join(__dirname, '..', '.secrets', 'default-shopify-app-credentials.json');
    const credContent = await fs.readFile(defaultCredPath, 'utf8');
    defaultCredentials = JSON.parse(credContent);
  } catch (error) {
    // If file doesn't exist or is invalid, leave defaults empty
    defaultCredentials = {};
  }

  // Check prerequisites
  const spinner = ora('Checking prerequisites...').start();

  // Add PATH debugging
  if (process.env.DEBUG) {
    console.log(chalk.gray(`\nPATH: ${process.env.PATH}`));
  }

  const hasGit = await checkCommand('git');
  const hasGh = await checkCommand('gh');

  if (!hasGit || !hasGh) {
    spinner.fail('Missing prerequisites');
    console.log(chalk.red('\nRequired tools missing:'));
    if (!hasGit) {
      console.log(chalk.red('  - git'));
      // Try to show where git might be
      try {
        const { stdout } = await execa('which', ['git'], { reject: false });
        if (stdout) console.log(chalk.gray(`    (which git: ${stdout})`));
      } catch {}
    }
    if (!hasGh) {
      console.log(chalk.red('  - gh (GitHub CLI)'));
      // Try to show where gh might be
      try {
        const { stdout } = await execa('which', ['gh'], { reject: false });
        if (stdout) console.log(chalk.gray(`    (which gh: ${stdout})`));
      } catch {}
    }
    console.log(chalk.yellow('\nPlease install missing tools and try again.'));
    console.log(chalk.gray('If tools are installed, try running with DEBUG=1 to see PATH'));
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
    },
    {
      type: 'text',
      name: 'shopifyDomain',
      message: 'Shopify domain (e.g., my-store.myshopify.com):',
      initial: defaultCredentials.shopify_domain || undefined,
      validate: value => {
        // Allow just the store name or full domain
        if (value.match(/^[a-z0-9-]+$/)) {
          return true; // Just store name
        } else if (value.match(/^[a-z0-9-]+\.myshopify\.com$/)) {
          return true; // Full domain
        }
        return 'Invalid domain format. Use: store-name or store-name.myshopify.com';
      },
      format: value => {
        // If just store name provided, append .myshopify.com
        if (value.match(/^[a-z0-9-]+$/) && !value.includes('.myshopify.com')) {
          return `${value}.myshopify.com`;
        }
        return value;
      }
    },
    {
      type: 'text',
      name: 'shopifyToken',
      message: 'Shopify access token (shpat_...):',
      initial: defaultCredentials.shopify_token || undefined,
      validate: value => value.startsWith('shpat_') ? true : 'Access token should start with shpat_'
    },
    {
      type: 'text',
      name: 'shopifyApiSecret',
      message: 'Shopify API secret key:',
      initial: defaultCredentials.shopify_api_secret_key || undefined,
      validate: value => value.length > 0 ? true : 'API secret key is required'
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

  const { repoName, isPrivate, directory, shopifyDomain, shopifyToken, shopifyApiSecret } = response;
  const mainRepoUrl = 'https://github.com/kalenjordan/shopworker.git';
  let mainDir, localDir;

  if (isEmptyDir) {
    // Use current directory for main repo
    mainDir = currentDir;
    localDir = path.join(currentDir, 'local');

    // Clone main Shopworker repository contents into current directory
    const cloneMainSpinner = ora('Cloning main Shopworker repository...').start();
    try {
      // Git clone directly into current directory from coreRefactor branch
      await execa('git', ['clone', '-b', 'master', mainRepoUrl, '.']);
      cloneMainSpinner.succeed('Main Shopworker repository cloned');
    } catch (error) {
      cloneMainSpinner.fail('Failed to clone main repository');
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  } else {
    // Create new directories
    mainDir = path.join(currentDir, directory);
    localDir = path.join(mainDir, 'local');

    // Check if directory already exists
    const dirExists = await fs.access(mainDir).then(() => true).catch(() => false);
    if (dirExists) {
      console.log(chalk.red(`\nDirectory "${directory}" already exists.`));
      console.log(chalk.yellow('Please choose a different directory name or remove the existing one.'));
      process.exit(1);
    }

    // Clone main Shopworker repository
    const cloneMainSpinner = ora('Cloning main Shopworker repository...').start();
    try {
      await execa('git', ['clone', '-b', 'master', mainRepoUrl, mainDir]);
      cloneMainSpinner.succeed('Main Shopworker repository cloned');
    } catch (error) {
      cloneMainSpinner.fail('Failed to clone main repository');
      console.error(chalk.red(error.message));
      process.exit(1);
    }

    // Change to the main directory
    process.chdir(mainDir);
  }

  // Create account repository
  const createRepoSpinner = ora('Creating GitHub repository...').start();
  let repoExists = false;
  try {
    const visibility = isPrivate ? '--private' : '--public';
    await execa('gh', ['repo', 'create', repoName, visibility, '--description', `Shopworker instance`]);
    createRepoSpinner.succeed('GitHub repository created');
  } catch (error) {
    // Check if error is because repo already exists
    if (error.message.includes('Name already exists')) {
      createRepoSpinner.warn('Repository already exists, continuing with existing repository');
      repoExists = true;
    } else {
      createRepoSpinner.fail('Failed to create repository');
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  }

  // Set up local directory with account repository
  const setupLocalSpinner = ora('Setting up local account directory...').start();
  try {
    const accountRepoUrl = `https://github.com/${ghUser}/${repoName}.git`;

    // Ensure we're in the main directory
    process.chdir(mainDir);

    // Check if local directory already exists
    const localDirExists = await fs.access(localDir).then(() => true).catch(() => false);
    if (localDirExists) {
      setupLocalSpinner.warn(`Directory "local" already exists`);

      // Ask user what to do
      const { action } = await prompts({
        type: 'select',
        name: 'action',
        message: `What would you like to do with existing "local" directory?`,
        choices: [
          { title: 'Delete and recreate', value: 'delete' },
          { title: 'Cancel', value: 'cancel' }
        ]
      });

      if (action === 'cancel' || !action) {
        console.log(chalk.yellow('\nSetup cancelled.'));
        process.exit(0);
      }

      if (action === 'delete') {
        await execa('rm', ['-rf', localDir]);
        setupLocalSpinner.succeed(`Deleted existing directory`);
      }
    }

    if (!repoExists) {
      // New repository - clone directly into local directory
      await execa('git', ['clone', accountRepoUrl, 'local']);

      // Copy template files
      const templateDir = path.join(__dirname, 'template');
      await copyTemplateFiles(templateDir, localDir, { accountName: ghUser, repoName });

      // Commit template files
      const cwd = process.cwd();
      process.chdir(localDir);
      await execa('git', ['add', '.']);
      await execa('git', ['commit', '-m', 'Initial commit']);
      await execa('git', ['branch', '-M', 'master']);

      try {
        await execa('git', ['push', '-u', 'origin', 'master'], {
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
        });
      } catch (pushError) {
        await execa('gh', ['auth', 'setup-git']);
        await execa('git', ['push', '-u', 'origin', 'master']);
      }
      process.chdir(cwd);

      setupLocalSpinner.succeed('Account repository initialized');
    } else {
      // Existing repository - try to clone it directly
      try {
        await execa('gh', ['auth', 'setup-git']);
        await execa('git', ['clone', accountRepoUrl, 'local'], {
          timeout: 30000,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
        });
        
        // Always copy template files to ensure they're up to date
        const templateDir = path.join(__dirname, 'template');
        await copyTemplateFiles(templateDir, localDir, { accountName: ghUser, repoName });

        // Check if there are any changes to commit
        const cwd = process.cwd();
        process.chdir(localDir);

        const { stdout: gitStatus } = await execa('git', ['status', '--porcelain']);
        if (gitStatus) {
          await execa('git', ['add', '.']);
          await execa('git', ['commit', '-m', 'Update template files']);
          try {
            await execa('git', ['push'], {
              env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
            });
          } catch (pushError) {
            await execa('gh', ['auth', 'setup-git']);
            await execa('git', ['push']);
          }
        }

        process.chdir(cwd);
        setupLocalSpinner.succeed('Using existing account repository');
      } catch (cloneError) {
        // Repository exists but might be empty, initialize it
        await fs.mkdir(localDir, { recursive: true });
        const cwd = process.cwd();
        process.chdir(localDir);

        await execa('git', ['init']);
        await execa('git', ['remote', 'add', 'origin', accountRepoUrl]);
        await execa('gh', ['auth', 'setup-git']);

        // Try to fetch existing content first
        try {
          await execa('git', ['fetch', 'origin'], {
            timeout: 30000,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
          });
          await execa('git', ['pull', 'origin', 'master', '--allow-unrelated-histories'], {
            timeout: 30000,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
          });
        } catch (fetchError) {
          // No existing content or branch, that's fine
        }

        // Copy template files
        const templateDir = path.join(__dirname, 'template');
        await copyTemplateFiles(templateDir, localDir, { accountName: ghUser, repoName });

        await execa('git', ['add', '.']);
        await execa('git', ['commit', '-m', 'Initial commit']);
        await execa('git', ['branch', '-M', 'master']);

        try {
          await execa('git', ['push', '-u', 'origin', 'master'], {
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
          });
        } catch (pushError) {
          await execa('gh', ['auth', 'setup-git']);
          await execa('git', ['push', '-u', 'origin', 'master']);
        }

        process.chdir(cwd);
        setupLocalSpinner.succeed('Account repository initialized');
      }
    }
  } catch (error) {
    setupLocalSpinner.fail('Failed to set up local account directory');
    console.error(chalk.red('Error:'), error.message);
    if (error.stderr) console.error(chalk.red('Stderr:'), error.stderr);
    process.exit(1);
  }

  // .gitignore already includes /local from the template, no need to update it

  // Create wrangler.toml files (in local directory and root)
  // Note: The template wrangler.toml is already copied to local by copyTemplateFiles,
  // but we need to also create one at the root for wrangler commands
  const wranglerSpinner = ora('Creating wrangler.toml...').start();
  try {
    // Read the wrangler.toml that was copied to local directory
    const localWranglerPath = path.join(localDir, 'wrangler.toml');
    const wranglerContent = await fs.readFile(localWranglerPath, 'utf8');

    // Also write to root (gitignored but needed for wrangler commands)
    await fs.writeFile('wrangler.toml', wranglerContent);

    wranglerSpinner.succeed('wrangler.toml created in local and root');
  } catch (error) {
    wranglerSpinner.fail('Failed to create wrangler.toml');
    console.error(chalk.red(error.message));
  }

  // Create .shopworker.json file
  const configSpinner = ora('Creating .shopworker.json...').start();
  try {
    process.chdir(mainDir);

    const shopworkerConfig = {
      shopify_domain: shopifyDomain,
      shopify_token: shopifyToken,
      shopify_api_secret_key: shopifyApiSecret
    };

    await fs.writeFile('.shopworker.json', JSON.stringify(shopworkerConfig, null, 2));
    configSpinner.succeed('.shopworker.json created');
  } catch (error) {
    configSpinner.fail('Failed to create .shopworker.json');
    console.error(chalk.red(error.message));
  }

  // Run npm install
  const installSpinner = ora('Installing dependencies...').start();
  try {
    await execa('npm', ['install'], { cwd: mainDir });
    installSpinner.succeed('Dependencies installed');
  } catch (error) {
    installSpinner.fail('Failed to install dependencies');
    console.error(chalk.red(error.message));
  }

  showSuccessMessage(isEmptyDir, currentDirName, directory, mainDir, localDir, mainRepoUrl, ghUser, repoName, shopifyDomain);
}

function showSuccessMessage(isEmptyDir, currentDirName, directory, mainDir, localDir, mainRepoUrl, ghUser, repoName, shopifyDomain) {
  console.log(chalk.green.bold('\n✅ Shopworker instance created successfully!\n'));
  console.log(chalk.cyan('Structure:'));
  if (isEmptyDir) {
    console.log(chalk.white(`  ${currentDirName}/                    - Main Shopworker repository`));
    console.log(chalk.white(`    ├── core/                - Core Shopworker code`));
    console.log(chalk.white(`    └── local/               - Your account-specific code repository`));
    console.log(chalk.white(`        ├── jobs/`));
    console.log(chalk.white(`        ├── triggers/`));
    console.log(chalk.white(`        └── connectors/\n`));
  } else {
    console.log(chalk.white(`  ${directory}/                    - Main Shopworker repository`));
    console.log(chalk.white(`    ├── core/                - Core Shopworker code`));
    console.log(chalk.white(`    └── local/               - Your account-specific code repository`));
    console.log(chalk.white(`        ├── jobs/`));
    console.log(chalk.white(`        ├── triggers/`));
    console.log(chalk.white(`        └── connectors/\n`));
  }

  console.log(chalk.cyan('Configuration:'));
  console.log(chalk.white(`  ✓ .shopworker.json created with credentials for ${shopifyDomain}`));
  console.log(chalk.white(`  ✓ wrangler.toml created with name: ${repoName} (in local and root)`));
  console.log(chalk.white(`  ✓ Dependencies installed\n`));

  console.log(chalk.cyan('Next steps:'));
  if (!isEmptyDir) {
    console.log(chalk.white(`  1. cd ${directory}`));
    console.log(chalk.white('  2. Create .env file with CLOUDFLARE_ACCOUNT_ID'));
    console.log(chalk.white('  3. Create your custom jobs in local/jobs/'));
    console.log(chalk.white('  4. Deploy with: npm run deploy\n'));
  } else {
    console.log(chalk.white('  1. Create .env file with CLOUDFLARE_ACCOUNT_ID'));
    console.log(chalk.white('  2. Create your custom jobs in local/jobs/'));
    console.log(chalk.white('  3. Deploy with: npm run deploy\n'));
  }

  console.log(chalk.gray(`Main repository: ${mainRepoUrl}`));
  console.log(chalk.gray(`Account repository: https://github.com/${ghUser}/${repoName}`));
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
  .description('Create a new Shopworker instance with cloned local repository')
  .version('1.0.0')
  .action(createShopworkerInstance);

program.parse();
