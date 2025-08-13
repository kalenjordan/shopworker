#!/usr/bin/env node

import { Command } from 'commander';
import path from 'path';
import { fileURLToPath } from 'url';

// Import all command registration functions
import {
  registerTestCommand,
  registerEnableCommand,
  registerDisableCommand,
  registerStatusCommand,
  registerJsonStatusCommand,
  registerRuntestCommand,
  registerDeployCommand,
  registerPutSecretsCommand,
  registerRemoteTestCommand,
  registerDeleteWebhookCommand
} from './core/cli/commands/index.js';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = __dirname;  // Now cli.js is in the root, so __dirname is the project root

// ================================================================= //
//                        COMMANDER PROGRAM                          //
// ================================================================= //
const program = new Command();

program
  .name('shopworker')
  .description('Shopify worker CLI tool')
  .version('1.0.0');

// Register all commands
registerTestCommand(program, projectRoot);
registerEnableCommand(program, projectRoot);
registerDisableCommand(program, projectRoot);
registerStatusCommand(program, projectRoot);
registerJsonStatusCommand(program, projectRoot);
registerRuntestCommand(program, projectRoot);
registerDeployCommand(program, projectRoot);
registerPutSecretsCommand(program, projectRoot);
registerRemoteTestCommand(program, projectRoot);
registerDeleteWebhookCommand(program, projectRoot);

program.parse(process.argv);