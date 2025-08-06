import fs from 'fs';
import path from 'path';

/**
 * Get the Cloudflare worker URL from options or .shopworker.json file
 * @param {Object} options - The command options
 * @param {string} [cliDirname] - Optional directory where cli.js is located (project root)
 * @returns {string|null} The worker URL or null if not found
 */
export function getWorkerUrl(options, cliDirname = process.cwd()) {
  // First check if URL is provided in command options
  if (options.worker) {
    return options.worker;
  }

  // Otherwise, try to load from .shopworker.json
  const shopworkerPath = path.join(cliDirname, '.shopworker.json');
  if (fs.existsSync(shopworkerPath)) {
    try {
      const shopworkerConfig = JSON.parse(fs.readFileSync(shopworkerPath, 'utf8'));
      if (shopworkerConfig.cloudflare_worker_url) {
        return shopworkerConfig.cloudflare_worker_url;
      }
    } catch (error) {
      console.error(`Error reading .shopworker.json: ${error.message}`);
    }
  }

  console.error('Cloudflare worker URL is required. Please set cloudflare_worker_url in your .shopworker.json file or use the -w <workerUrl> option.');
  return null;
}

/**
 * Get shop configuration from .shopworker.json
 * @param {string} cliDirname - The directory where cli.js is located
 * @param {string} shopName - The shop name from job config (ignored in new format)
 * @returns {Object} The shop configuration
 */
export function getShopConfig(cliDirname, shopName) {
  const shopworkerFilePath = path.join(cliDirname, '.shopworker.json');
  if (!fs.existsSync(shopworkerFilePath)) {
    throw new Error('.shopworker.json file not found. Please create one.');
  }

  const shopworkerFileContent = fs.readFileSync(shopworkerFilePath, 'utf8');
  const shopworkerData = JSON.parse(shopworkerFileContent);

  // Check if using new format (direct shop config)
  if (shopworkerData.shopify_domain && shopworkerData.shopify_token) {
    return shopworkerData;
  }

  // Legacy format support
  if (!shopworkerData.shops || !Array.isArray(shopworkerData.shops)) {
    throw new Error('Invalid .shopworker.json format: Missing shop configuration.');
  }

  const shopConfig = shopworkerData.shops.find(s => s.name === shopName);
  if (!shopConfig) {
    throw new Error(`Shop configuration for '${shopName}' not found in .shopworker.json.`);
  }

  return shopConfig;
}

/**
 * Get shop domain from shopworker.json
 * @param {string} cliDirname - The directory where cli.js is located
 * @param {string} shopName - The shop name from job config (ignored in new format)
 * @returns {string} The shop domain or a default value
 */
export function getShopDomain(cliDirname, shopName) {
  try {
    const shopworkerPath = path.join(cliDirname, '.shopworker.json');
    const shopworkerContent = fs.readFileSync(shopworkerPath, 'utf8');
    const shopworkerData = JSON.parse(shopworkerContent);
    
    // Check if using new format
    if (shopworkerData.shopify_domain) {
      return shopworkerData.shopify_domain;
    }
    
    // Legacy format support
    const shopConfig = shopworkerData.shops.find(s => s.name === shopName);
    if (shopConfig && shopConfig.shopify_domain) {
      return shopConfig.shopify_domain;
    }
  } catch (error) {
    console.warn(`Warning: Could not read shop domain from config: ${error.message}`);
  }

  return 'unknown-shop.myshopify.com'; // Default fallback
}

/**
 * Gets the shop configuration with API secret for remote testing
 * @param {string} cliDirname - The directory where cli.js is located
 * @param {string} shopName - The shop name from job config (ignored in new format)
 * @param {string} optionalShopDomain - Optional shop domain override
 * @returns {Object} Object containing shop config, API secret, and shop domain
 * @throws {Error} If API secret is not found
 */
export function getShopConfigWithSecret(cliDirname, shopName, optionalShopDomain) {
  const shopworkerFilePath = path.join(cliDirname, '.shopworker.json');
  const shopworkerContent = fs.readFileSync(shopworkerFilePath, 'utf8');
  const shopworkerData = JSON.parse(shopworkerContent);
  
  let shopConfig, apiSecret;
  
  // Check if using new format
  if (shopworkerData.shopify_domain && shopworkerData.shopify_token) {
    shopConfig = shopworkerData;
    apiSecret = shopworkerData.shopify_api_secret_key;
  } else {
    // Legacy format support
    shopConfig = shopworkerData.shops.find(s => s.name === shopName);
    if (!shopConfig) {
      throw new Error(`Shop configuration for '${shopName}' not found in .shopworker.json.`);
    }
    apiSecret = shopConfig.shopify_api_secret_key;
  }

  if (!apiSecret) {
    throw new Error(`API secret not found. Make sure shopify_api_secret_key is defined in .shopworker.json.`);
  }

  const shopDomain = optionalShopDomain || getShopDomain(cliDirname, shopName);

  return { shopConfig, apiSecret, shopDomain };
}

/**
 * Load secrets from .secrets directory
 * @param {string} cliDirname - The directory where cli.js is located
 * @returns {Object} Object containing secrets with filenames as keys
 */
export function loadSecrets(cliDirname) {
  const secretsDir = path.join(cliDirname, '.secrets');
  const secrets = {};

  if (!fs.existsSync(secretsDir)) {
    // Silently return empty secrets object if .secrets directory doesn't exist
    return secrets;
  }

  // Read all files in the .secrets directory
  const files = fs.readdirSync(secretsDir);
  for (const file of files) {
    const filePath = path.join(secretsDir, file);

    // Skip directories
    if (fs.statSync(filePath).isDirectory()) {
      continue;
    }

    try {
      // Read the file content
      const content = fs.readFileSync(filePath, 'utf8');

      // Get key by removing the file extension
      const key = path.parse(file).name;

      // Try to parse as JSON, if it fails, use the raw content
      try {
        secrets[key] = JSON.parse(content);
      } catch (jsonError) {
        secrets[key] = content;
      }
    } catch (error) {
      console.warn(`Warning: Could not read secret file ${file}: ${error.message}`);
    }
  }

  return secrets;
}
