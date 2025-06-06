/**
 * Shared environment utilities for both CLI and Worker environments
 */

/**
 * Detect if we're running in CLI environment (Node.js) vs Cloudflare Workers
 * @param {Object} env - Environment variables
 * @returns {boolean} True if CLI environment, false if Cloudflare Workers
 */
export function isCliEnvironment(env) {
  // Check for PATH environment variable which exists in Node.js but not in Cloudflare Workers
  return env && typeof env.PATH === 'string';
}

/**
 * Run a sub-job, automatically handling environment differences
 * In CLI: directly imports and calls the job
 * In Cloudflare Workers: queues the job via durable object
 *
 * @param {Object} options - Options for running the sub-job
 * @param {string} options.jobPath - Path to the job (e.g., 'avery/process-single-order')
 * @param {Object} options.record - Record data to pass to the sub-job
 * @param {Object} options.shopify - Shopify API client
 * @param {Object} options.jobConfig - Job configuration
 * @param {Object} options.env - Environment variables
 * @param {Object} [options.shopConfig] - Shop configuration (required for Cloudflare environment)
 * @returns {Promise<void>}
 */
export async function runSubJob({ jobPath, record, shopify, jobConfig, env, shopConfig }) {
  if (isCliEnvironment(env)) {
    console.log(`  ✓ Processing subjob#${record.subJobIndex} directly in CLI`);
    await runSubJobDirectly({ jobPath, record, shopify, jobConfig });
  } else {
    // Cloudflare Workers Environment: Queue the job via durable object
    if (!shopConfig || !shopConfig.shopify_domain) {
      throw new Error('Shop configuration with shopify_domain is required for sub-job queuing in Cloudflare Workers environment');
    }

    console.log(`  ✓ Enqueueing subjob #${record.subJobIndex} in Durable Object`);
    await queueSubJobInWorkerEnvironment({ jobPath, record, shopConfig, env });
  }
}

/**
 * Run a sub-job directly by importing and calling it (CLI environment)
 * @param {Object} options - Options for running the sub-job
 * @param {string} options.jobPath - Path to the job
 * @param {Object} options.record - Record data to pass to the sub-job
 * @param {Object} options.shopify - Shopify API client
 * @param {Object} options.jobConfig - Job configuration
 */
async function runSubJobDirectly({ jobPath, record, shopify, jobConfig }) {
  // Dynamically import the job module
  const jobModule = await import(`../jobs/${jobPath}/job.js`);

  if (!jobModule.process) {
    throw new Error(`Job at ${jobPath} does not export a 'process' function`);
  }

  // Call the job's process function directly
  await jobModule.process({
    record,
    shopify,
    jobConfig
  });
}

/**
 * Queue a sub-job in Cloudflare Workers environment using durable objects
 * @param {Object} options - Options for queuing the sub-job
 * @param {string} options.jobPath - Path to the job
 * @param {Object} options.record - Record data to pass to the sub-job
 * @param {Object} options.shopConfig - Shop configuration (contains shopify_domain)
 * @param {Object} options.env - Environment variables
 */
async function queueSubJobInWorkerEnvironment({ jobPath, record, shopConfig, env }) {
  // Extract shop domain from shop config
  const shopDomain = shopConfig.shopify_domain;

  // Create a unique ID for this specific sub-job
  // Option 1: Completely random (maximum isolation)
  const subJobId = crypto.randomUUID();

  // Option 2: Use order ID for more meaningful tracking (if available)
  // const orderId = record.csOrder?.csOrderId || crypto.randomUUID();
  // const durableObjectId = `order:${shopDomain}:${orderId}`;

  const durableObjectId = `subjob:${shopDomain}:${subJobId}`;

  // Get a unique JobQueue Durable Object for this specific sub-job
  const jobQueueId = env.JOB_QUEUE.idFromName(durableObjectId);
  const jobQueue = env.JOB_QUEUE.get(jobQueueId);

  // Prepare job data for the sub-job
  const jobData = {
    shopDomain,
    jobPath,
    bodyData: record,
    shopConfig,
    topic: 'shopworker/sub-job' // Custom topic for sub-jobs
  };

  // Enqueue the sub-job (it will be the only job in this durable object)
  const jobId = await jobQueue.enqueue(jobData);

  console.log(`  Queued sub-job ${jobId} in dedicated durable object ${durableObjectId}`);

  // Note: Each sub-job now runs in its own isolated durable object instance
  // This allows for better parallelization and isolation
}

/**
 * Log to CLI environment (Node.js) only
 * Will only print if running in Node.js (detects process.env.PATH)
 * @param {Object} env - Environment variables
 * @param {...any} args - Arguments to pass to console.log
 */
export function logToCli(env, ...args) {
  // Check if we're running in Node environment (has PATH variable)
  if (isCliEnvironment(env)) {
    console.log(...args);
  }
}

/**
 * Log to Worker environment only
 * Will only print if running in Cloudflare Worker (no process.env.PATH)
 * @param {Object} env - Environment variables
 * @param {...any} args - Arguments to pass to console.log
 */
export function logToWorker(env, ...args) {
  // If we don't see the PATH environment variable (a Node.js env var),
  // we're likely in a Worker environment
  if (!isCliEnvironment(env)) {
    console.log(...args);
  }
}
