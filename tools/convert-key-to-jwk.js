#!/usr/bin/env node

/**
 * Utility to convert a Google service account private key to JWK format
 * for use with Cloudflare Workers.
 *
 * Usage: node tools/convert-key-to-jwk.js
 *
 * This will read .shopworker.json and update it with JWK versions of the private keys.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createPrivateKey } from 'crypto';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Path to config file
const configPath = path.join(rootDir, '.shopworker.json');

// Convert PEM to JWK
function pemToJwk(pemKey) {
  const privateKey = createPrivateKey(pemKey);
  const jwk = privateKey.export({ format: 'jwk' });

  // Add necessary properties for jose
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  jwk.key_ops = ['sign'];

  return jwk;
}

async function main() {
  if (!fs.existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    process.exit(1);
  }

  // Read config
  const configContent = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(configContent);

  if (!config.shops || !Array.isArray(config.shops)) {
    console.error('Invalid config: shops array not found');
    process.exit(1);
  }

  let modified = false;

  // Process each shop
  for (const shop of config.shops) {
    if (shop.google_sheets_credentials?.private_key && !shop.google_sheets_credentials.private_key_jwk) {
      try {
        console.log(`Converting private key for shop ${shop.name}...`);

        // Convert to JWK
        const jwk = pemToJwk(shop.google_sheets_credentials.private_key);

        // Add JWK to credentials
        shop.google_sheets_credentials.private_key_jwk = jwk;

        modified = true;
        console.log(`Successfully added JWK for shop ${shop.name}`);
      } catch (error) {
        console.error(`Error converting key for shop ${shop.name}:`, error);
      }
    }
  }

  if (modified) {
    // Write updated config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    console.log(`Updated ${configPath} with JWK keys`);
    console.log('Remember to run "npm run shopworker put-secrets" to update your Cloudflare secret');
  } else {
    console.log('No changes needed - all credentials already have JWK keys or no credentials found');
  }
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
