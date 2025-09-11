/**
 * Database connector that abstracts between SQLite (local/CLI) and D1 (Cloudflare Workers)
 * Automatically detects environment and uses appropriate database implementation
 */

import { isWorkerEnvironment, isCliEnvironment } from '../shared/env.js';

/**
 * Database connector class that provides unified interface for both SQLite and D1
 */
export class DatabaseConnector {
  constructor(config = {}) {
    this.config = config;
    this.db = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the database connection based on environment
   * @param {Object} context - Environment context (env from worker or local config)
   */
  async init(context) {
    if (this.isInitialized) {
      return this.db;
    }

    if (isWorkerEnvironment(context)) {
      // Use D1 database in Cloudflare Workers
      this.db = new D1DatabaseAdapter(context.QUIZ_DB);
      console.log('Initialized D1 database connection');
    } else if (isCliEnvironment(context)) {
      // Use SQLite in Node.js/CLI environment
      this.db = new SQLiteDatabaseAdapter(this.config.sqliteFile || './quiz-sessions.db');
      await this.db.init();
      console.log('Initialized SQLite database connection');
    } else {
      throw new Error('Unsupported environment for database connector');
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
 * SQLite Database Adapter for Node.js/CLI environment
 */
class SQLiteDatabaseAdapter {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.sqlite = null;
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;

    try {
      // Dynamic import of sqlite3 for Node.js environments
      const { default: sqlite3 } = await import('sqlite3');
      const { open } = await import('sqlite');
      
      this.db = await open({
        filename: this.dbPath,
        driver: sqlite3.Database
      });

      // Create tables if they don't exist
      await this.createTables();
      
      return this.db;
    } catch (error) {
      // If sqlite dependencies aren't available, provide helpful error
      if (error.code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error(
          'SQLite dependencies not found. Install with: npm install sqlite3 sqlite'
        );
      }
      throw error;
    }
  }

  async createTables() {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS quiz_sessions (
        id TEXT PRIMARY KEY,
        questions TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        shop_domain TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_quiz_sessions_shop_domain 
      ON quiz_sessions(shop_domain);
      
      CREATE INDEX IF NOT EXISTS idx_quiz_sessions_created_at 
      ON quiz_sessions(created_at);
    `);
  }

  async execute(query, params = []) {
    await this.init();
    const result = await this.db.run(query, params);
    return {
      success: result.changes > 0,
      changes: result.changes,
      lastRowId: result.lastID
    };
  }

  async first(query, params = []) {
    await this.init();
    return this.db.get(query, params);
  }

  async all(query, params = []) {
    await this.init();
    return this.db.all(query, params);
  }
}

/**
 * Create a database connector instance for quiz operations
 * @param {Object} config - Configuration options
 * @param {string} config.sqliteFile - SQLite file path for local environment
 * @returns {DatabaseConnector} Database connector instance
 */
export function createQuizDatabase(config = {}) {
  return new DatabaseConnector({
    sqliteFile: config.sqliteFile || './local/data/quiz-sessions.db'
  });
}

/**
 * Quiz-specific database operations
 */
export class QuizDatabase {
  constructor(dbConnector) {
    this.db = dbConnector;
  }

  /**
   * Save a quiz session
   * @param {string} sessionHash - Unique session identifier
   * @param {Array} questions - Array of quiz questions
   * @param {string} shopDomain - Shop domain
   * @returns {Promise<Object>} Save result
   */
  async saveQuizSession(sessionHash, questions, shopDomain) {
    const timestamp = Math.floor(Date.now() / 1000);
    const questionsJson = JSON.stringify(questions);

    return this.db.execute(
      'INSERT INTO quiz_sessions (id, questions, created_at, shop_domain) VALUES (?, ?, ?, ?)',
      [sessionHash, questionsJson, timestamp, shopDomain]
    );
  }

  /**
   * Get a quiz session by hash and shop domain
   * @param {string} sessionHash - Session identifier
   * @param {string} shopDomain - Shop domain
   * @returns {Promise<Object|null>} Quiz session data or null
   */
  async getQuizSession(sessionHash, shopDomain) {
    const result = await this.db.first(
      'SELECT id, questions, created_at, shop_domain FROM quiz_sessions WHERE id = ? AND shop_domain = ?',
      [sessionHash, shopDomain]
    );

    if (result && result.questions) {
      try {
        result.questions = JSON.parse(result.questions);
      } catch (parseError) {
        console.error('Error parsing stored questions JSON:', parseError);
        throw new Error('Data corruption: Unable to parse quiz questions');
      }
    }

    return result;
  }

  /**
   * Get all quiz sessions for a shop (optional, for analytics)
   * @param {string} shopDomain - Shop domain
   * @param {number} limit - Maximum number of results
   * @returns {Promise<Array>} Array of quiz sessions
   */
  async getShopQuizSessions(shopDomain, limit = 100) {
    return this.db.all(
      'SELECT id, created_at, shop_domain FROM quiz_sessions WHERE shop_domain = ? ORDER BY created_at DESC LIMIT ?',
      [shopDomain, limit]
    );
  }
}