#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import prompts from 'prompts';
import { execa } from 'execa';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function resetShopworkerInstance() {
  console.log(chalk.blue.bold('\n🔄  Reset Shopworker Instance\n'));

  // Check current directory - capture early before any directory changes
  let currentDir, currentDirName, parentDir;
  try {
    currentDir = process.cwd();
    currentDirName = path.basename(currentDir);
    parentDir = path.dirname(currentDir);
  } catch (error) {
    console.error(chalk.red('Failed to get current directory'));
    process.exit(1);
  }

  // Determine paths based on current location
  let mainDir, localDir, repoName;
  
  // Check if we're in a shopworker directory
  const hasWranglerToml = await fs.access(path.join(currentDir, 'wrangler.toml')).then(() => true).catch(() => false);
  const hasLocalSymlink = await fs.lstat(path.join(currentDir, 'local')).then(stats => stats.isSymbolicLink()).catch(() => false);
  
  if (hasWranglerToml && hasLocalSymlink) {
    // We're in the main shopworker directory
    mainDir = currentDir;
    localDir = path.join(parentDir, `${currentDirName}-local`);
    repoName = currentDirName;
  } else {
    console.log(chalk.red('\n❌ Error: Not in a Shopworker directory.'));
    console.log(chalk.yellow('Please navigate to a Shopworker instance directory and try again.\n'));
    process.exit(1);
  }

  // Show what will be reset
  console.log(chalk.yellow('\n⚠️  The following directories will be reset:'));
  console.log(chalk.white(`  - Main directory: ${mainDir}`));
  console.log(chalk.white(`  - Local directory: ${localDir}`));


  // If we're currently in the directory to be deleted, move to a safe location
  if (currentDir === mainDir || currentDir.startsWith(mainDir + path.sep) || 
      currentDir === localDir || currentDir.startsWith(localDir + path.sep)) {
    console.log(chalk.gray('Moving to parent directory...'));
    try {
      process.chdir(parentDir);
    } catch (error) {
      console.log(chalk.gray('Moving to home directory...'));
      process.chdir(process.env.HOME || '/');
    }
  }

  // Delete main directory
  const deleteMainSpinner = ora(`Deleting ${path.basename(mainDir)} directory...`).start();
  try {
    const mainDirExists = await fs.access(mainDir).then(() => true).catch(() => false);
    if (mainDirExists) {
      await execa('rm', ['-rf', mainDir]);
      deleteMainSpinner.succeed(`${path.basename(mainDir)} directory deleted`);
    } else {
      deleteMainSpinner.warn(`${path.basename(mainDir)} directory not found`);
    }
  } catch (error) {
    deleteMainSpinner.fail(`Failed to delete ${path.basename(mainDir)} directory`);
    console.error(chalk.red(error.message));
  }

  // Delete local directory
  const deleteLocalSpinner = ora(`Deleting ${path.basename(localDir)} directory...`).start();
  try {
    const localDirExists = await fs.access(localDir).then(() => true).catch(() => false);
    if (localDirExists) {
      await execa('rm', ['-rf', localDir]);
      deleteLocalSpinner.succeed(`${path.basename(localDir)} directory deleted`);
    } else {
      deleteLocalSpinner.warn(`${path.basename(localDir)} directory not found`);
    }
  } catch (error) {
    deleteLocalSpinner.fail(`Failed to delete ${path.basename(localDir)} directory`);
    console.error(chalk.red(error.message));
  }

  // Recreate the main directory
  const recreateSpinner = ora(`Recreating ${path.basename(mainDir)} directory...`).start();
  try {
    await fs.mkdir(mainDir, { recursive: true });
    recreateSpinner.succeed(`${path.basename(mainDir)} directory recreated`);
  } catch (error) {
    recreateSpinner.fail(`Failed to recreate ${path.basename(mainDir)} directory`);
    console.error(chalk.red(error.message));
  }

  console.log(chalk.green.bold('\n✅ Shopworker instance reset successfully!\n'));
  console.log(chalk.gray(`The ${repoName} directory is now empty and ready for re-initialization.\n`));
}

program
  .name('reset-shopworker')
  .description('Reset Shopworker instance by clearing directories')
  .version('1.0.0')
  .action(resetShopworkerInstance);

program.parse();