/**
 * Paginate Products Job
 * 
 * This job paginates through all products in the store, fetching them in pages of 5,
 * and counts the total number of products by type.
 */

import paginateQuery from '../../../graphql/productsGetPaginated.js';

/**
 * Process function that paginates through products using workflow steps
 * @param {Object} params - Parameters for the job
 * @param {Object} params.shopify - Shopify API client
 * @param {Object} params.step - Workflow step function
 */
export async function process({ shopify, step }) {
  console.log("====== Starting product pagination job ======");

  // Step 1: Initialize pagination state
  const initialState = await step.do("initialize-pagination", async () => {
    const pageSize = 5;
    console.log(`Starting pagination with page size: ${pageSize}`);
    
    return {
      pageSize,
      hasNextPage: true,
      cursor: null,
      pageNumber: 0,
      productCounts: [],
      productTypeCount: {}
    };
  });

  // Process pages iteratively, passing state through each step
  let currentState = initialState;
  let stepIndex = 0;

  while (currentState.hasNextPage) {
    const stepName = `fetch-page-${stepIndex}`;
    
    currentState = await step.do(stepName, async () => {
      const { pageSize, cursor, pageNumber, productCounts, productTypeCount } = currentState;
      
      console.log(`Fetching page ${pageNumber + 1}...`);
      
      const response = await shopify.graphql(paginateQuery, {
        first: pageSize,
        after: cursor
      });

      const products = response.products.edges;
      const pageInfo = response.products.pageInfo;
      
      console.log(`Page ${pageNumber + 1}: Found ${products.length} products`);
      
      // Create a copy of the accumulated type counts
      const updatedTypeCount = { ...productTypeCount };
      
      // Log product details for this page and count by type
      products.forEach((edge, index) => {
        const product = edge.node;
        console.log(`  ${index + 1}. ${product.title} (${product.handle}) - Type: ${product.productType || 'None'}`);
        
        // Count products by type
        const type = product.productType || 'None';
        updatedTypeCount[type] = (updatedTypeCount[type] || 0) + 1;
      });

      // Create updated product counts array
      const updatedProductCounts = [
        ...productCounts,
        {
          page: pageNumber + 1,
          count: products.length
        }
      ];

      // Return the complete state for the next iteration
      return {
        pageSize,
        hasNextPage: pageInfo.hasNextPage,
        cursor: pageInfo.endCursor,
        pageNumber: pageNumber + 1,
        productCounts: updatedProductCounts,
        productTypeCount: updatedTypeCount
      };
    });

    stepIndex++;
  }

  // Step 3: Summarize the results using the final state
  const summary = await step.do("summarize-results", async () => {
    const { productCounts, productTypeCount, pageSize } = currentState;
    const totalProducts = productCounts.reduce((sum, page) => sum + page.count, 0);
    const totalPages = productCounts.length;

    console.log("\n====== Pagination Summary ======");
    console.log(`Total pages fetched: ${totalPages}`);
    console.log(`Page size: ${pageSize}`);
    console.log(`Total products counted: ${totalProducts}`);
    
    console.log("\nBreakdown by page:");
    productCounts.forEach(({ page, count }) => {
      console.log(`  Page ${page}: ${count} products`);
    });

    console.log("\n====== Product Type Counts ======");
    const sortedTypes = Object.entries(productTypeCount).sort((a, b) => b[1] - a[1]);
    sortedTypes.forEach(([type, count]) => {
      console.log(`  ${type}: ${count} products`);
    });

    return {
      totalPages,
      pageSize,
      totalProducts,
      pageBreakdown: productCounts,
      productTypeCount
    };
  });

  return summary;
}