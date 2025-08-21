import fs from 'fs';
import path from 'path';

/**
 * Manages the .shopworker-state.json file for deployment and operational state
 */

/**
 * Gets the state data from .shopworker-state.json
 * @param {string} projectRoot - The project root directory
 * @returns {object} The state data
 */
export function getStateData(projectRoot) {
  const statePath = path.join(projectRoot, '.shopworker-state.json');
  
  if (!fs.existsSync(statePath)) {
    return {};
  }
  
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (error) {
    console.warn('Warning: Could not parse .shopworker-state.json:', error.message);
    return {};
  }
}

/**
 * Updates the state data in .shopworker-state.json
 * @param {string} projectRoot - The project root directory
 * @param {object} updates - Object with fields to update
 */
export function updateStateData(projectRoot, updates) {
  const statePath = path.join(projectRoot, '.shopworker-state.json');
  
  let stateData = getStateData(projectRoot);
  stateData = { ...stateData, ...updates };
  
  fs.writeFileSync(statePath, JSON.stringify(stateData, null, 2), 'utf8');
}