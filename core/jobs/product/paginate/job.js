/**
 * Paginate Products Job
 * 
 * This job paginates through all products in the store, fetching them in pages of 5,
 * and counts the total number of products.
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
  const { pageSize, totalPages } = await step.do("initialize-pagination", async () => {
    const pageSize = 5;
    console.log(`Starting pagination with page size: ${pageSize}`);
    
    return {
      pageSize,
      totalPages: 0,
      productCounts: []
    };
  });

  // Step 2: Fetch pages of products
  let hasNextPage = true;
  let cursor = null;
  let pageNumber = 0;
  const productCounts = [];

  // Continue fetching pages until there are no more
  while (hasNextPage) {
    const currentPageNumber = pageNumber;
    const currentCursor = cursor;
    
    // Fetch a page of products
    const pageResult = await step.do(`fetch-page-${currentPageNumber}`, async () => {
      console.log(`Fetching page ${currentPageNumber + 1}...`);
      
      const response = await shopify.graphql(paginateQuery, {
        first: pageSize,
        after: currentCursor
      });

      const products = response.products.edges;
      const pageInfo = response.products.pageInfo;
      
      console.log(`Page ${currentPageNumber + 1}: Found ${products.length} products`);
      
      // Log product details for this page
      products.forEach((edge, index) => {
        const product = edge.node;
        console.log(`  ${index + 1}. ${product.title} (${product.handle})`);
      });

      return {
        pageNumber: currentPageNumber + 1,
        productCount: products.length,
        hasNextPage: pageInfo.hasNextPage,
        endCursor: pageInfo.endCursor,
        products: products.map(edge => ({
          id: edge.node.admin_graphql_api_id,
          title: edge.node.title,
          handle: edge.node.handle
        }))
      };
    });

    productCounts.push({
      page: pageResult.pageNumber,
      count: pageResult.productCount
    });

    hasNextPage = pageResult.hasNextPage;
    cursor = pageResult.endCursor;
    pageNumber++;
  }

  // Step 3: Summarize the results
  const summary = await step.do("summarize-results", async () => {
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

    return {
      totalPages,
      pageSize,
      totalProducts,
      pageBreakdown: productCounts
    };
  });

  return summary;
}