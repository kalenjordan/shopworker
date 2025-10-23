/**
 * R2/Local Storage connector
 * Provides unified interface for storing and retrieving data
 * Compatible with both Cloudflare Workers (R2) and CLI (local filesystem) environments
 */

import { isCliEnvironment } from '../shared/env.js';

/**
 * Save content to storage (R2 in worker, local filesystem in CLI)
 * @param {string} content - Content to save
 * @param {Object} options - Save options
 * @param {string} options.path - Storage path (e.g., 'csv-imports/file.csv')
 * @param {string} [options.contentType] - MIME type for R2 storage
 * @param {Object} [options.metadata] - Custom metadata for R2 storage
 * @param {Object} env - Environment object
 * @returns {Promise<string>} Returns the storage path
 */
export async function saveContent(content, options, env) {
  const { path, contentType = 'text/plain', metadata = {} } = options;

  if (!isCliEnvironment(env)) {
    // Worker environment - save to R2
    console.log(`Saving to R2: ${path}`);
    try {
      await env.R2_BUCKET.put(path, content, {
        httpMetadata: { contentType },
        customMetadata: {
          timestamp: new Date().toISOString(),
          ...metadata
        }
      });
      return path;
    } catch (error) {
      console.error(`Failed to save to R2: ${error.message}`);
      throw error;
    }
  } else {
    // CLI environment - save to Desktop
    const filename = path.split('/').pop();
    console.log(`Saving to Desktop: ${filename}`);
    try {
      const { default: fs } = await import('fs');
      const { default: pathModule } = await import('path');
      const { default: os } = await import('os');

      const desktopPath = pathModule.join(os.homedir(), 'Desktop', filename);
      fs.writeFileSync(desktopPath, content, 'utf8');
      return desktopPath;
    } catch (error) {
      console.error(`Failed to save to Desktop: ${error.message}`);
      throw error;
    }
  }
}

/**
 * Load content from storage (R2 in worker, local filesystem in CLI)
 * @param {string} path - Storage path
 * @param {Object} env - Environment object
 * @returns {Promise<string>} Returns the content
 */
export async function loadContent(path, env) {
  if (!isCliEnvironment(env)) {
    // Worker environment - load from R2
    console.log(`Loading from R2: ${path}`);
    try {
      const r2Object = await env.R2_BUCKET.get(path);
      if (!r2Object) {
        throw new Error(`File not found in R2: ${path}`);
      }
      return await r2Object.text();
    } catch (error) {
      console.error(`Failed to load from R2: ${error.message}`);
      throw error;
    }
  } else {
    // CLI environment - load from Desktop
    const filename = path.split('/').pop();
    console.log(`Loading from Desktop: ${filename}`);
    try {
      const { default: fs } = await import('fs');
      const { default: pathModule } = await import('path');
      const { default: os } = await import('os');

      const desktopPath = pathModule.join(os.homedir(), 'Desktop', filename);
      return fs.readFileSync(desktopPath, 'utf8');
    } catch (error) {
      console.error(`Failed to load from Desktop: ${error.message}`);
      throw error;
    }
  }
}

/**
 * Save JSON data to storage
 * @param {any} data - Data to save as JSON
 * @param {Object} options - Save options
 * @param {string} options.path - Storage path
 * @param {Object} [options.metadata] - Custom metadata for R2 storage
 * @param {Object} env - Environment object
 * @returns {Promise<string>} Returns the storage path
 */
export async function saveJSON(data, options, env) {
  return saveContent(
    JSON.stringify(data),
    {
      ...options,
      contentType: 'application/json'
    },
    env
  );
}

/**
 * Load JSON data from storage
 * @param {string} path - Storage path
 * @param {Object} env - Environment object
 * @returns {Promise<any>} Returns the parsed JSON data
 */
export async function loadJSON(path, env) {
  const content = await loadContent(path, env);
  return JSON.parse(content);
}

/**
 * Check if a file exists in storage
 * @param {string} path - Storage path
 * @param {Object} env - Environment object
 * @returns {Promise<boolean>} Returns true if file exists
 */
export async function exists(path, env) {
  if (!isCliEnvironment(env)) {
    // Worker environment - check R2
    try {
      const r2Object = await env.R2_BUCKET.head(path);
      return r2Object !== null;
    } catch {
      return false;
    }
  } else {
    // CLI environment - check Desktop
    const filename = path.split('/').pop();
    try {
      const { default: fs } = await import('fs');
      const { default: pathModule } = await import('path');
      const { default: os } = await import('os');

      const desktopPath = pathModule.join(os.homedir(), 'Desktop', filename);
      return fs.existsSync(desktopPath);
    } catch {
      return false;
    }
  }
}

/**
 * Delete a file from storage
 * @param {string} path - Storage path
 * @param {Object} env - Environment object
 * @returns {Promise<void>}
 */
export async function deleteFile(path, env) {
  if (!isCliEnvironment(env)) {
    // Worker environment - delete from R2
    console.log(`Deleting from R2: ${path}`);
    try {
      await env.R2_BUCKET.delete(path);
    } catch (error) {
      console.error(`Failed to delete from R2: ${error.message}`);
      throw error;
    }
  } else {
    // CLI environment - delete from Desktop
    const filename = path.split('/').pop();
    console.log(`Deleting from Desktop: ${filename}`);
    try {
      const { default: fs } = await import('fs');
      const { default: pathModule } = await import('path');
      const { default: os } = await import('os');

      const desktopPath = pathModule.join(os.homedir(), 'Desktop', filename);
      fs.unlinkSync(desktopPath);
    } catch (error) {
      console.error(`Failed to delete from Desktop: ${error.message}`);
      throw error;
    }
  }
}