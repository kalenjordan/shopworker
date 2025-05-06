/**
 * Product Create Job
 * Creates a new product with a random name
 */

import productCreateMutation from '../../graphql/productCreate.js';

// Array of adjectives for random product names
const adjectives = [
  'Vintage', 'Modern', 'Sleek', 'Rustic', 'Elegant',
  'Classic', 'Premium', 'Deluxe', 'Handcrafted', 'Artisan',
  'Luxury', 'Eco-friendly', 'Sustainable', 'Durable', 'Portable'
];

// Array of nouns for random product names
const nouns = [
  'Chair', 'Table', 'Lamp', 'Desk', 'Vase',
  'Sofa', 'Bookshelf', 'Cabinet', 'Rug', 'Clock',
  'Mirror', 'Planter', 'Frame', 'Bowl', 'Basket'
];

// Array of product types
const productTypes = [
  'Furniture', 'Home Decor', 'Lighting', 'Storage', 'Textiles'
];

/**
 * Generate a random product name
 * @returns {string} Random product name
 */
function generateRandomProductName() {
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adjective} ${noun}`;
}

/**
 * Generate a random product type
 * @returns {string} Random product type
 */
function generateRandomProductType() {
  return productTypes[Math.floor(Math.random() * productTypes.length)];
}

/**
 * Process function called by the worker
 * @param {Object} data - Not used for manual jobs
 * @param {Object} shopify - Shopify client
 */
export async function process(data, shopify) {
  // Generate a random product name
  const productName = generateRandomProductName();
  const productType = generateRandomProductType();

  console.log(`Creating new product: "${productName}" (Type: ${productType})`);

  // Create product variables
  const variables = {
    input: {
      title: productName,
      productType: productType,
      descriptionHtml: `<p>This is a randomly generated ${productType.toLowerCase()} product created by the Shopify Worker job.</p>`,
      status: "ACTIVE",
      vendor: "Shopify Worker"
    }
  };

  try {
    // Execute the product creation mutation
    const response = await shopify.graphql(productCreateMutation, variables);

    // Check for user errors
    if (response?.productCreate?.userErrors &&
        response.productCreate.userErrors.length > 0) {
      const errors = response.productCreate.userErrors
        .map(err => `${err.field}: ${err.message}`)
        .join(', ');

      console.error(`Failed to create product: ${errors}`);
      return;
    }

    // Get the created product
    const product = response.productCreate.product;

    console.log(`Successfully created product!`);
    console.log(`ID: ${product.id}`);
    console.log(`Title: ${product.title}`);
    console.log(`Handle: ${product.handle}`);
    console.log(`Status: ${product.status}`);
    console.log(`Created at: ${product.createdAt}`);

  } catch (error) {
    console.error('Error creating product:', error.message);
  }
}

/**
 * Run function called by the CLI
 * @param {Object} props - Properties passed from CLI
 */
export async function run(props) {
  const { admin, logger } = props;

  // Generate a random product name
  const productName = generateRandomProductName();
  const productType = generateRandomProductType();

  logger.info(`Creating new product: "${productName}" (Type: ${productType})`);

  // Create product variables
  const variables = {
    input: {
      title: productName,
      productType: productType,
      descriptionHtml: `<p>This is a randomly generated ${productType.toLowerCase()} product created by the Shopify Worker job.</p>`,
      status: "ACTIVE",
      vendor: "Shopify Worker"
    }
  };

  try {
    // Execute the product creation mutation
    const response = await admin.graphql(productCreateMutation, variables);
    const json = await response.json();

    // Check for user errors
    if (json?.productCreate?.userErrors &&
        json.productCreate.userErrors.length > 0) {
      const errors = json.productCreate.userErrors
        .map(err => `${err.field}: ${err.message}`)
        .join(', ');

      logger.error(`Failed to create product: ${errors}`);
      return;
    }

    // Get the created product
    const product = json.productCreate.product;

    logger.info(`Successfully created product!`);
    logger.info(`ID: ${product.id}`);
    logger.info(`Title: ${product.title}`);
    logger.info(`Handle: ${product.handle}`);
    logger.info(`Status: ${product.status}`);
    logger.info(`Created at: ${product.createdAt}`);

  } catch (error) {
    logger.error(`Error creating product: ${error.message}`);
  }
}
