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
 * Process function called by both the CLI and worker
 * Creates a new product with random attributes.
 * @param {Object} params - Parameters for the job
 * @param {Object} params.data - Trigger data (not typically used for this manual job)
 * @param {Object} params.shopify - Shopify API client
 * @param {Object} [params.env] - Environment variables (not used by this job)
 */
export async function process({ shopify }) {
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
}
