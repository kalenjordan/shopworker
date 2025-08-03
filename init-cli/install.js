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
    localDir = path.join(path.dirname(currentDir), `${currentDirName}-local`);

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
    localDir = path.join(currentDir, `${directory}-local`);

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
  console.log(chalk.gray(`\nStarting local directory setup...`));
  try {
    const accountRepoUrl = `https://github.com/${ghUser}/${repoName}.git`;
    console.log(chalk.gray(`Account repo URL: ${accountRepoUrl}`));
    console.log(chalk.gray(`Local directory path: ${localDir}`));

    // Check if local directory already exists
    const localDirExists = await fs.access(localDir).then(() => true).catch(() => false);
    if (localDirExists) {
      setupLocalSpinner.warn(`Directory "${path.basename(localDir)}" already exists`);

      // Ask user what to do
      const { action } = await prompts({
        type: 'select',
        name: 'action',
        message: `What would you like to do with existing "${path.basename(localDir)}" directory?`,
        choices: [
          { title: 'Use existing directory', value: 'use' },
          { title: 'Delete and recreate', value: 'delete' },
          { title: 'Cancel', value: 'cancel' }
        ]
      });

      if (action === 'cancel' || !action) {
        console.log(chalk.yellow('\nSetup cancelled.'));
        process.exit(0);
      }

      if (action === 'delete') {
        try {
          await execa('rm', ['-rf', localDir]);
          setupLocalSpinner.succeed(`Deleted existing directory`);
        } catch (error) {
          setupLocalSpinner.fail('Failed to delete existing directory');
          console.error(chalk.red(error.message));
          process.exit(1);
        }
      } else if (action === 'use') {
        // Use existing directory but ensure template files are copied
        setupLocalSpinner.succeed('Using existing local directory');

        // Copy template files to ensure they exist
        console.log(chalk.gray('Ensuring template files are present...'));
        const templateDir = path.join(__dirname, 'template');
        await copyTemplateFiles(templateDir, localDir, { accountName: ghUser, repoName });

        // Check if there are changes to commit
        const cwd = process.cwd();
        process.chdir(localDir);

        try {
          const { stdout: gitStatus } = await execa('git', ['status', '--porcelain']);
          if (gitStatus) {
            console.log(chalk.gray('Committing template files...'));
            await execa('git', ['add', '.']);
            await execa('git', ['commit', '-m', 'Add template files']);

            // Try to push
            try {
              await execa('gh', ['auth', 'setup-git']);
              await execa('git', ['push']);
            } catch (pushError) {
              console.log(chalk.yellow('Could not push changes. You may need to push manually.'));
            }
          }
        } catch (gitError) {
          // If git operations fail, continue anyway
          console.log(chalk.gray('Git operations skipped'));
        }

        process.chdir(cwd);

        // Now create symlink
        const symlinkSpinner = ora('Creating symlink...').start();
        try {
          // Ensure we're in the main directory
          process.chdir(mainDir);

          // Create relative symlink
          const relativePath = path.relative(mainDir, localDir);
          await fs.symlink(relativePath, 'local', 'dir');

          symlinkSpinner.succeed('Symlink created');
        } catch (error) {
          symlinkSpinner.fail('Failed to create symlink');
          console.error(chalk.red(error.message));
          process.exit(1);
        }

        // .gitignore already includes /local from the template, no need to update it

        // Create wrangler.toml file
        const wranglerSpinner2 = ora('Creating wrangler.toml...').start();
        try {
          const wranglerTemplatePath = path.join(__dirname, 'template', 'wrangler.toml');
          let wranglerContent = await fs.readFile(wranglerTemplatePath, 'utf8');

          // Replace placeholders
          wranglerContent = wranglerContent.replace(/\{REPONAME\}/g, repoName);

          await fs.writeFile(path.join(mainDir, 'wrangler.toml'), wranglerContent);
          wranglerSpinner2.succeed('wrangler.toml created');
        } catch (error) {
          wranglerSpinner2.fail('Failed to create wrangler.toml');
          console.error(chalk.red(error.message));
        }

        // Create .shopworker.json file
        const configSpinner2 = ora('Creating .shopworker.json...').start();
        try {
          process.chdir(mainDir);

          const shopworkerConfig = {
            shopify_domain: shopifyDomain,
            shopify_token: shopifyToken,
            shopify_api_secret_key: shopifyApiSecret
          };

          await fs.writeFile('.shopworker.json', JSON.stringify(shopworkerConfig, null, 2));
          configSpinner2.succeed('.shopworker.json created');
        } catch (error) {
          configSpinner2.fail('Failed to create .shopworker.json');
          console.error(chalk.red(error.message));
        }

        // Run npm install
        const installSpinner2 = ora('Installing dependencies...').start();
        try {
          await execa('npm', ['install'], { cwd: mainDir });
          installSpinner2.succeed('Dependencies installed');
        } catch (error) {
          installSpinner2.fail('Failed to install dependencies');
          console.error(chalk.red(error.message));
        }

        // Jump to success message
        showSuccessMessage(isEmptyDir, currentDirName, directory, mainDir, localDir, mainRepoUrl, ghUser, repoName, shopifyDomain);
        return;
      }
    }

    if (!repoExists) {
      // New repository - clone and add template files
      await execa('git', ['clone', accountRepoUrl, localDir]);

      // Copy template files
      const templateDir = path.join(__dirname, 'template');
      await copyTemplateFiles(templateDir, localDir, { accountName: ghUser, repoName });

      // Verify files were copied
      const copiedFiles = await fs.readdir(localDir);
      console.log(chalk.gray(`Files copied to local directory: ${copiedFiles.join(', ')}`));

      // Commit template files
      const cwd = process.cwd();
      process.chdir(localDir);
      await execa('git', ['add', '.']);

      // Check git status before commit
      const { stdout: gitStatus } = await execa('git', ['status', '--porcelain']);
      if (!gitStatus) {
        console.log(chalk.yellow('Warning: No files staged for commit'));
      }

      await execa('git', ['commit', '-m', 'Initial commit']);
      await execa('git', ['branch', '-M', 'master']);

      try {
        await execa('git', ['push', '-u', 'origin', 'master'], {
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
        });
      } catch (pushError) {
        console.log(chalk.gray('Initial push failed, trying gh auth setup...'));
        await execa('gh', ['auth', 'setup-git']);
        await execa('git', ['push', '-u', 'origin', 'master']);
      }
      process.chdir(cwd);

      setupLocalSpinner.succeed('Account repository initialized');
    } else {
      // Existing repository - try to clone it
      console.log(chalk.gray('\nExisting repository detected, attempting to clone...'));
      try {
        // First ensure git is set up with gh auth
        console.log(chalk.gray('Setting up git authentication...'));
        await execa('gh', ['auth', 'setup-git']);

        console.log(chalk.gray(`Running: git clone ${accountRepoUrl} ${localDir}`));
        await execa('git', ['clone', accountRepoUrl, localDir], {
          timeout: 30000, // 30 second timeout
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
        });
        console.log(chalk.gray('Clone successful'));
        setupLocalSpinner.succeed('Using existing account repository');

        // Always copy template files to ensure they're up to date
        console.log(chalk.gray('Copying template files...'));
        const templateDir = path.join(__dirname, 'template');
        await copyTemplateFiles(templateDir, localDir, { accountName: ghUser, repoName });
        console.log(chalk.gray('Template files copied'));

        // Check if there are any changes to commit
        console.log(chalk.gray('Checking for changes...'));
        const cwd = process.cwd();
        console.log(chalk.gray(`Current dir: ${cwd}`));
        console.log(chalk.gray(`Changing to: ${localDir}`));
        process.chdir(localDir);

        console.log(chalk.gray('Running: git status --porcelain'));
        const { stdout: gitStatus } = await execa('git', ['status', '--porcelain']);
        console.log(chalk.gray(`Git status result: ${gitStatus ? 'Changes detected' : 'No changes'}`));
        if (gitStatus) {
          console.log(chalk.gray('Template files updated, committing changes...'));
          await execa('git', ['add', '.']);
          await execa('git', ['commit', '-m', 'Update template files']);

          try {
            await execa('git', ['push'], {
              env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
            });
          } catch (pushError) {
            console.log(chalk.gray('Push failed, trying gh auth setup...'));
            await execa('gh', ['auth', 'setup-git']);
            await execa('git', ['push']);
          }
        }

        process.chdir(cwd);
      } catch (cloneError) {
        // Repository exists but might be empty, initialize it
        console.log(chalk.gray(`\nClone failed with error: ${cloneError.message}`));
        if (cloneError.stderr) console.log(chalk.gray(`Stderr: ${cloneError.stderr}`));
        console.log(chalk.gray('Initializing new repository...'));

        console.log(chalk.gray(`Creating directory: ${localDir}`));
        await fs.mkdir(localDir, { recursive: true });
        const cwd = process.cwd();
        console.log(chalk.gray(`Current dir: ${cwd}`));
        console.log(chalk.gray(`Changing to: ${localDir}`));
        process.chdir(localDir);

        try {
          await execa('git', ['init']);
          await execa('git', ['remote', 'add', 'origin', accountRepoUrl]);

          // Set up git auth before fetching
          console.log(chalk.gray('Setting up git authentication...'));
          await execa('gh', ['auth', 'setup-git']);

          // Try to fetch existing content first
          try {
            console.log(chalk.gray('Checking for existing remote content...'));
            await execa('git', ['fetch', 'origin'], {
              timeout: 30000,
              env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
            });
            // If fetch succeeds, try to pull
            await execa('git', ['pull', 'origin', 'master', '--allow-unrelated-histories'], {
              timeout: 30000,
              env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
            });
          } catch (fetchError) {
            // No existing content or branch, that's fine
            console.log(chalk.gray('No existing remote content found'));
            console.log(chalk.gray(`Fetch error: ${fetchError.message}`));
          }

          // Copy template files
          const templateDir = path.join(__dirname, 'template');
          await copyTemplateFiles(templateDir, localDir, { accountName: ghUser, repoName });

          // Verify files were copied
          const copiedFiles2 = await fs.readdir(localDir);
          console.log(chalk.gray(`Files copied to local directory: ${copiedFiles2.join(', ')}`));

          await execa('git', ['add', '.']);

          // Check git status before commit
          const { stdout: gitStatus2 } = await execa('git', ['status', '--porcelain']);
          if (!gitStatus2) {
            console.log(chalk.yellow('Warning: No files staged for commit'));
          }

          await execa('git', ['commit', '-m', 'Initial commit']);
          await execa('git', ['branch', '-M', 'master']);

          console.log(chalk.gray('Pushing to remote repository...'));
          try {
            // First check if we have the right remote URL
            const { stdout: remoteUrl } = await execa('git', ['remote', 'get-url', 'origin']);
            console.log(chalk.gray(`Remote URL: ${remoteUrl.trim()}`));

            // Try to push
            const pushResult = await execa('git', ['push', '-u', 'origin', 'master'], {
              env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
            });
            console.log(chalk.gray('Push successful'));
          } catch (pushError) {
            console.error(chalk.red('Push failed:'), pushError.message);
            if (pushError.stderr) {
              console.error(chalk.red('Error details:'), pushError.stderr);
            }

            // Try using gh to set up authentication
            console.log(chalk.gray('Attempting to configure git with gh auth...'));
            try {
              await execa('gh', ['auth', 'setup-git']);
              console.log(chalk.gray('Retrying push...'));
              await execa('git', ['push', '-u', 'origin', 'master']);
              console.log(chalk.gray('Push successful after auth setup'));
            } catch (retryError) {
              console.error(chalk.red('Push still failed after auth setup'));
              throw retryError;
            }
          }

          process.chdir(cwd);
          setupLocalSpinner.succeed('Account repository initialized');
        } catch (gitError) {
          process.chdir(cwd);
          setupLocalSpinner.fail('Failed to initialize repository');
          console.error(chalk.red('Git error:'), gitError.message);
          throw gitError;
        }
      }
    }
  } catch (error) {
    setupLocalSpinner.fail('Failed to set up local account directory');
    console.error(chalk.red('Error:'), error.message);
    if (error.stderr) console.error(chalk.red('Stderr:'), error.stderr);
    if (error.stack) console.error(chalk.red('Stack:'), error.stack);
    process.exit(1);
  }

  // Create symlink from main/local to local directory
  const symlinkSpinner = ora('Creating symlink...').start();
  try {
    // Ensure we're in the main directory
    process.chdir(mainDir);

    // Create relative symlink
    const relativePath = path.relative(mainDir, localDir);
    await fs.symlink(relativePath, 'local', 'dir');

    symlinkSpinner.succeed('Symlink created');
  } catch (error) {
    symlinkSpinner.fail('Failed to create symlink');
    console.error(chalk.red(error.message));
    process.exit(1);
  }

  // .gitignore already includes /local from the template, no need to update it

  // Create wrangler.toml file
  const wranglerSpinner = ora('Creating wrangler.toml...').start();
  try {
    const wranglerTemplatePath = path.join(__dirname, 'template', 'wrangler.toml');
    let wranglerContent = await fs.readFile(wranglerTemplatePath, 'utf8');

    // Replace placeholders
    wranglerContent = wranglerContent.replace(/\{REPONAME\}/g, repoName);

    await fs.writeFile('wrangler.toml', wranglerContent);
    wranglerSpinner.succeed('wrangler.toml created');
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
    console.log(chalk.white(`    └── local/               - Symlink to ${currentDirName}-local`));
    console.log(chalk.white(`  ${currentDirName}-local/             - Your account-specific code`));
    console.log(chalk.white(`    ├── jobs/`));
    console.log(chalk.white(`    ├── triggers/`));
    console.log(chalk.white(`    └── connectors/\n`));
  } else {
    console.log(chalk.white(`  ${directory}/                    - Main Shopworker repository`));
    console.log(chalk.white(`    ├── core/                - Core Shopworker code`));
    console.log(chalk.white(`    └── local/               - Symlink to ${directory}-local`));
    console.log(chalk.white(`  ${directory}-local/             - Your account-specific code`));
    console.log(chalk.white(`    ├── jobs/`));
    console.log(chalk.white(`    ├── triggers/`));
    console.log(chalk.white(`    └── connectors/\n`));
  }

  console.log(chalk.cyan('Configuration:'));
  console.log(chalk.white(`  ✓ .shopworker.json created with credentials for ${shopifyDomain}`));
  console.log(chalk.white(`  ✓ wrangler.toml created with name: ${repoName}`));
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
  console.log(chalk.gray(`Local directory: ${path.basename(localDir)}`));
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
  .description('Create a new Shopworker instance with symlinks')
  .version('1.0.0')
  .action(createShopworkerInstance);

program.parse();
