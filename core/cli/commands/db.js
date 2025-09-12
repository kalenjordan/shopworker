import { spawn } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Find the local D1 database file
 * @param {string} projectRoot - Project root directory
 * @returns {string|null} Path to the database file or null if not found
 */
function findD1Database(projectRoot) {
  const wranglerDir = join(projectRoot, '.wrangler');
  
  if (!existsSync(wranglerDir)) {
    console.error('❌ .wrangler directory not found. Have you run the worker locally yet?');
    console.error('   Run: wrangler dev');
    return null;
  }
  
  // Search for SQLite files in the D1 state directory
  const d1Dir = join(wranglerDir, 'state/v3/d1/miniflare-D1DatabaseObject');
  
  if (!existsSync(d1Dir)) {
    console.error('❌ No D1 database directory found. Run the worker locally first to initialize the database.');
    console.error('   Run: wrangler dev');
    return null;
  }
  
  const files = readdirSync(d1Dir)
    .filter(file => file.endsWith('.sqlite'))
    .map(file => join(d1Dir, file));
  
  if (files.length === 0) {
    console.error('❌ No D1 database found. Run the worker locally first to initialize the database.');
    console.error('   Run: wrangler dev');
    return null;
  }
  
  if (files.length > 1) {
    console.warn('⚠️  Multiple databases found. Using the first one:');
    files.forEach(file => console.log(`  - ${file}`));
  }
  
  return files[0];
}

/**
 * Open the local D1 database in TablePlus or default SQLite app
 * @param {string} projectRoot - Project root directory
 */
function openDatabase(projectRoot) {
  const dbPath = findD1Database(projectRoot);
  
  if (!dbPath) {
    process.exit(1);
  }
  
  console.log('📂 Opening D1 database in TablePlus/SQLite viewer...');
  console.log('📍 Path:', dbPath);
  
  // Use macOS 'open' command to open with default .sqlite handler (usually TablePlus if installed)
  const openProcess = spawn('open', [dbPath], { 
    stdio: 'inherit'
  });
  
  openProcess.on('error', (err) => {
    if (err.code === 'ENOENT') {
      console.error('❌ "open" command not found. This command is for macOS only.');
      console.error('💡 On other systems, manually open this file in your SQLite viewer:');
      console.error('   ', dbPath);
    } else {
      console.error('❌ Error opening database:', err.message);
      console.error('💡 Try opening this file manually in TablePlus or your SQLite viewer:');
      console.error('   ', dbPath);
    }
    process.exit(1);
  });
  
  openProcess.on('close', (code) => {
    if (code === 0) {
      console.log('✅ Database opened successfully');
    } else if (code !== null) {
      console.error(`❌ Failed to open database (exit code ${code})`);
      console.error('💡 Try opening this file manually in TablePlus or your SQLite viewer:');
      console.error('   ', dbPath);
      process.exit(code);
    }
  });
}

/**
 * Show database info
 * @param {string} projectRoot - Project root directory
 */
function showDatabaseInfo(projectRoot) {
  const dbPath = findD1Database(projectRoot);
  
  if (!dbPath) {
    process.exit(1);
  }
  
  console.log('📊 D1 Database Information');
  console.log('━'.repeat(50));
  console.log('📍 Path:', dbPath);
  
  // Get file size
  const stats = statSync(dbPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  console.log('📏 Size:', sizeMB, 'MB');
  console.log('📅 Modified:', stats.mtime.toLocaleString());
  console.log('');
  console.log('💡 Commands:');
  console.log('   node cli.js db open    - Open database in TablePlus/SQLite viewer');
  console.log('   node cli.js db info    - Show this information');
  console.log('   node cli.js db         - Show available commands');
}

/**
 * Register the db command with the CLI
 */
export function registerDbCommand(program, projectRoot) {
  const dbCommand = program
    .command('db')
    .description('Manage local D1 database')
    .action(() => {
      // Show available subcommands when no subcommand is provided
      console.log('📚 Database CLI Commands:');
      console.log('   node cli.js db open  - Open D1 database in TablePlus/SQLite viewer');
      console.log('   node cli.js db info  - Show database information');
    });
  
  dbCommand
    .command('open')
    .description('Open local D1 database in TablePlus or default SQLite viewer')
    .action(() => {
      openDatabase(projectRoot);
    });
  
  dbCommand
    .command('info')
    .description('Show local D1 database information')
    .action(() => {
      showDatabaseInfo(projectRoot);
    });
}