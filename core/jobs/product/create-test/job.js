/**
 * Random Product Generator for Testing
 *
 * Automatically creates test products in Shopify with randomly generated attributes
 * to facilitate development testing and store population. This job generates unique
 * product names by combining curated lists of adjectives and nouns (e.g., "Vintage Chair",
 * "Modern Lamp"), assigns random product types from predefined categories (Furniture,
 * Home Decor, Lighting, etc.), and creates appropriate HTML descriptions. The products
 * are created with ACTIVE status and "Shopify Worker" as the vendor. This is particularly
 * useful for testing product creation workflows, webhook handlers, inventory management
 * systems, and populating development stores with realistic sample data for UI testing
 * and demonstrations.
 *
*/

import productCreateMutation from '../../../graphql/productCreate.js';

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
