/**
 * Database connector for Cloudflare D1
 * Uses D1 in both worker and local development environments
 */

import { isWorkerEnvironment, isCliEnvironment } from '../shared/env.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';

/**
 * Database connector class that provides unified interface for D1
 */
export class DatabaseConnector {
  constructor(config = {}) {
    this.config = config;
    this.db = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the D1 database connection
   * @param {Object} context - Environment context (env from worker or local config)
   */
  async init(context) {
    if (this.isInitialized) {
      return this.db;
    }

    if (isWorkerEnvironment(context)) {
      // Use D1 database in Cloudflare Workers
      if (!context.QUIZ_DB) {
        throw new Error('QUIZ_DB binding not found in worker environment');
      }
      this.db = new D1DatabaseAdapter(context.QUIZ_DB);
      console.log('Initialized D1 database connection (Worker)');
    } else if (isCliEnvironment(context)) {
      // Use local D1 database via better-sqlite3 for CLI testing
      this.db = new LocalD1Adapter();
      await this.db.init();
      console.log('Initialized D1 database connection (Local)');
    } else {
      throw new Error('Unable to determine environment for database initialization');
    }

    this.isInitialized = true;
    return this.db;
  }

  /**
   * Get the underlying database instance
   */
  getDatabase() {
    if (!this.isInitialized) {
      throw new Error('Database not initialized. Call init() first.');
    }
    return this.db;
  }

  /**
   * Execute a prepared statement with parameters
   * @param {string} query - SQL query with placeholders
   * @param {Array} params - Parameters for the query
   * @returns {Promise<Object>} Query result
   */
  async execute(query, params = []) {
    const db = await this.init();
    return db.execute(query, params);
  }

  /**
   * Get the first result from a query
   * @param {string} query - SQL query with placeholders
   * @param {Array} params - Parameters for the query
   * @returns {Promise<Object|null>} First result or null
   */
  async first(query, params = []) {
    const db = await this.init();
    return db.first(query, params);
  }

  /**
   * Get all results from a query
   * @param {string} query - SQL query with placeholders
   * @param {Array} params - Parameters for the query
   * @returns {Promise<Array>} Array of results
   */
  async all(query, params = []) {
    const db = await this.init();
    return db.all(query, params);
  }
}

/**
 * D1 Database Adapter for Cloudflare Workers
 * Note: Schema is managed by D1 migrations, not by this adapter
 */
class D1DatabaseAdapter {
  constructor(d1Database) {
    this.d1 = d1Database;
  }

  async execute(query, params = []) {
    const statement = this.d1.prepare(query);
    if (params.length > 0) {
      return statement.bind(...params).run();
    }
    return statement.run();
  }

  async first(query, params = []) {
    const statement = this.d1.prepare(query);
    if (params.length > 0) {
      return statement.bind(...params).first();
    }
    return statement.first();
  }

  async all(query, params = []) {
    const statement = this.d1.prepare(query);
    if (params.length > 0) {
      return statement.bind(...params).all();
    }
    return statement.all();
  }
}

/**
 * Local D1 Adapter for CLI/testing environment
 * Connects directly to the Wrangler local D1 SQLite database
 */
class LocalD1Adapter {
  constructor() {
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;

    try {
      // Get the project root directory
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const projectRoot = join(__dirname, '..', '..');
      
      // Path to the local D1 database created by Wrangler
      const dbPath = join(projectRoot, '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject', 
        '5b20f538b0120769d3976a850f52402ae26ae21ba6161c2ef3b47737bcad2c11.sqlite');
      
      // Connect to the local D1 database
      this.db = new Database(dbPath);
      return this.db;
    } catch (error) {
      if (error.code === 'SQLITE_CANTOPEN') {
        throw new Error(
          'Local D1 database not found. Run "wrangler d1 migrations apply shopworker --local" first.'
        );
      }
      throw error;
    }
  }

  async execute(query, params = []) {
    await this.init();
    try {
      const stmt = this.db.prepare(query);
      const result = stmt.run(...params);
      return {
        success: result.changes > 0,
        changes: result.changes,
        lastRowId: result.lastInsertRowid
      };
    } catch (error) {
      console.error('Database execute error:', error);
      throw error;
    }
  }

  async first(query, params = []) {
    await this.init();
    try {
      const stmt = this.db.prepare(query);
      return stmt.get(...params);
    } catch (error) {
      console.error('Database first error:', error);
      throw error;
    }
  }

  async all(query, params = []) {
    await this.init();
    try {
      const stmt = this.db.prepare(query);
      const results = stmt.all(...params);
      return { results };
    } catch (error) {
      console.error('Database all error:', error);
      throw error;
    }
  }
}

/**
 * Create a generic database connector instance
 * @param {Object} config - Configuration options
 * @returns {DatabaseConnector} Database connector instance
 */
export function createDatabase(config = {}) {
  return new DatabaseConnector(config);
}