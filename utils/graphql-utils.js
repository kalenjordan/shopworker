import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the root directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

/**
 * Load a GraphQL query from a file
 * @param {string} queryName - The name of the query file without extension
 * @returns {string} The GraphQL query
 */
export function loadGraphQLQuery(queryName) {
  // If queryName already includes .graphql extension, use it as is
  const fileName = queryName.endsWith('.graphql')
    ? queryName
    : `${queryName}.graphql`;

  const queryPath = path.join(rootDir, 'graphql', fileName);

  try {
    return fs.readFileSync(queryPath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to load GraphQL query '${queryName}': ${error.message}`);
  }
}
