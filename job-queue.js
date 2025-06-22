/**
 * JobQueue Durable Object for processing Shopify webhook jobs
 */

import { createShopifyClient } from './utils/shopify.js';
import { DurableObject } from "cloudflare:workers";

export class JobQueue extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.queue = [];
    this.processing = false;
    console.log(`🚀 JobQueue Durable Object initialized`);
  }

  /**
   * Add a job to the queue
   */
  async enqueue(jobData) {
    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Check payload size
    const dataStr = JSON.stringify(jobData);
    const dataSizeKB = new Blob([dataStr]).size / 1024;

    let job;

    if (dataSizeKB > 100) { // If larger than 100KB, store in R2
      console.log(`📦 Job ${jobId}: ${dataSizeKB.toFixed(1)}KB → R2 storage`);

      // Store only bodyData in R2, keep metadata in job object
      const r2Key = `job-data/${jobId}.json`;
      const bodyDataStr = JSON.stringify(jobData.bodyData);

      try {
        await this.env.R2_BUCKET.put(r2Key, bodyDataStr, {
          httpMetadata: {
            contentType: 'application/json'
          }
        });
        console.log(`✅ R2 saved: ${r2Key}`);
      } catch (error) {
        console.error(`❌ R2 save failed: ${r2Key}`, error);
        throw error;
      }

      job = {
        id: jobId,
        createdAt: now,
        status: 'pending',
        isLargePayload: true,
        r2Key: r2Key,
        payloadSize: dataSizeKB,
        // Store metadata needed for processing
        shopDomain: jobData.shopDomain,
        jobPath: jobData.jobPath,
        shopConfig: jobData.shopConfig,
        topic: jobData.topic
      };
    } else {
      console.log(`📝 Job ${jobId}: ${dataSizeKB.toFixed(1)}KB → local storage`);
      // Small payload, store directly in Durable Object storage
      job = {
        id: jobId,
        data: jobData,
        createdAt: now,
        status: 'pending',
        isLargePayload: false,
        payloadSize: dataSizeKB
      };
    }

    // Store job metadata
    await this.ctx.storage.put(`job:${jobId}:meta`, job);

    // Add to in-memory queue for processing
    this.queue.push(job);

    // Start processing if not already processing
    if (!this.processing) {
      this.processQueue();
    }

    return jobId;
  }

  /**
   * Retrieve complete job data (from R2 if necessary)
   */
  async getJobData(jobId) {
    const jobMeta = await this.ctx.storage.get(`job:${jobId}:meta`);
    if (!jobMeta) {
      throw new Error(`Job metadata not found for job ${jobId}`);
    }

    if (jobMeta.isLargePayload) {
      // Fetch bodyData from R2 and combine with metadata
      try {
        const r2Object = await this.env.R2_BUCKET.get(jobMeta.r2Key);
        if (!r2Object) {
          throw new Error(`Large payload not found in R2: ${jobMeta.r2Key}`);
        }
        const bodyDataStr = await r2Object.text();
        const bodyData = JSON.parse(bodyDataStr);

        // Reconstruct full job data
        return {
          shopDomain: jobMeta.shopDomain,
          jobPath: jobMeta.jobPath,
          bodyData: bodyData,
          shopConfig: jobMeta.shopConfig,
          topic: jobMeta.topic
        };
      } catch (error) {
        console.error(`❌ R2 fetch failed: ${jobMeta.r2Key}`, error);
        throw error;
      }
    } else {
      // Data is stored directly in job metadata
      return jobMeta.data;
    }
  }

  /**
   * Process jobs in the queue
   */
  async processQueue() {
    if (this.processing) return;

    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift();
        console.log(`🔄 Processing job ${job.id}`);

        try {
          await this.processJob(job);
          // Update job status to completed
          const updatedJob = { ...job, status: 'completed', updatedAt: new Date().toISOString() };
          await this.ctx.storage.put(`job:${job.id}:meta`, updatedJob);

          console.log(`✅ Job ${job.id} completed`);
        } catch (error) {
          console.error(`❌ Job ${job.id} failed:`, error);
          // Update job status to failed with error message
          const updatedJob = {
            ...job,
            status: 'failed',
            error: error.message,
            updatedAt: new Date().toISOString()
          };
          await this.ctx.storage.put(`job:${job.id}:meta`, updatedJob);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Process a single job
   */
  async processJob(job) {
    const jobData = await this.getJobData(job.id);
    const { shopDomain, jobPath, bodyData, shopConfig, topic } = jobData;

    try {
      // Dynamically load the job handler
      const jobModule = await import(`./jobs/${jobPath}/job.js`);
      if (!jobModule) {
        throw new Error(`Job handler not found for: ${jobPath}`);
      }

      // Load job config
      const jobConfigModule = await import(`./jobs/${jobPath}/config.json`);
      let jobConfig = jobConfigModule.default;

      // Check for config overrides in the payload
      if (bodyData._configOverrides) {
        jobConfig = {
          ...jobConfig,
          test: {
            ...jobConfig.test,
            ...bodyData._configOverrides
          }
        };

        console.log('  Updated jobConfig.test:', JSON.stringify(jobConfig.test));
      }

      // Create Shopify client
      const shopify = this.createShopifyClient(shopDomain, shopConfig, jobConfig);

      // Load secrets from environment
      const secrets = this.loadSecretsFromEnv(this.env);

      // For batch processing jobs, provide durable object context
      const processParams = {
        payload: bodyData,
        shopify,
        env: this.env,
        shopConfig,
        jobConfig,
        secrets
      };

      // Add durable object state for batch processing if job supports it
      if (jobModule.onBatchItem) {
        processParams.durableObjectState = {
          storage: this.ctx.storage,
          setAlarm: (date) => this.ctx.storage.setAlarm(date),
          getAlarm: () => this.ctx.storage.getAlarm(),
          deleteAlarm: () => this.ctx.storage.deleteAlarm(),
          // Provide access to original job data for re-fetching
          jobId: job.id,
          getJobData: () => this.getJobData(job.id)
        };
      }

      // Use the job's batch item processor function directly
      const onBatchItem = jobModule.onBatchItem;

      // Process the job with complete data
      await jobModule.process(processParams);

    } catch (error) {
      console.error(`❌ Error processing job ${job.id}:`, error);
      throw error;
    }
  }

  /**
   * Create Shopify client with proper authentication
   */
  createShopifyClient(shopDomain, shopConfig, jobConfig) {
    const accessToken = shopConfig?.shopify_token || this.env.SHOPIFY_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error('Shopify API access token not configured');
    }

    return createShopifyClient({
      shop: shopDomain,
      accessToken,
      apiVersion: jobConfig?.apiVersion // Let createShopifyClient handle the default
    });
  }

  /**
   * Load secrets from environment variables
   */
  loadSecretsFromEnv(env) {
    const secrets = {};
    for (const key in env) {
      if (key.startsWith('SECRET_')) {
        const secretKey = key.substring(7);
        try {
          secrets[secretKey] = JSON.parse(env[key]);
        } catch (e) {
          secrets[secretKey] = env[key];
        }
      }
    }
    return secrets;
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId) {
    const meta = await this.ctx.storage.get(`job:${jobId}:meta`);
    return meta || null;
  }

  /**
   * Get queue stats
   */
  async getStats() {
    const allJobs = await this.ctx.storage.list({ prefix: 'job:', suffix: ':meta' });
    const stats = { pending: 0, completed: 0, failed: 0, totalPayloadSizeKB: 0 };

    for (const [key, job] of allJobs) {
      stats[job.status] = (stats[job.status] || 0) + 1;
      stats.totalPayloadSizeKB += job.payloadSize || 0;
    }

    return stats;
  }

  /**
   * List recent jobs
   */
  async listJobs(limit = 10) {
    const allJobs = await this.ctx.storage.list({ prefix: 'job:', suffix: ':meta' });
    const jobs = Array.from(allJobs.values())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);

    return jobs;
  }

  /**
   * Handle alarms for batch processing
   */
  async alarm() {
    console.log('🔔 Alarm triggered for batch processing');

    // Check for new batch processor state
    const iterationState = await this.ctx.storage.get('batch:processor:state');
    if (!iterationState) {
      console.log('No batch processor state found, alarm may be stale');
      return;
    }

    // Log the iteration state for debugging
    console.log('📊 Iteration state:', JSON.stringify(iterationState, null, 2));

    try {
      // Get the original job data to determine which job module to use
      const originalJob = await this.getActiveJob();
      if (!originalJob) {
        throw new Error('No active job found for batch processing continuation');
      }

      // Dynamically import the job module
      const jobModule = await import(`./jobs/${originalJob.jobPath}/job.js`);

      // Check if job has a onBatchItem function
      if (!jobModule.onBatchItem) {
        throw new Error(`Job ${originalJob.jobPath} does not export a onBatchItem function`);
      }

      console.log('🔄 Using batch continuation with onBatchItem');

      // Create Shopify client
      const shopify = this.createShopifyClient(originalJob.shopDomain, originalJob.shopConfig, originalJob.jobConfig);

      // Create processor using job's factory
      const onBatchItem = jobModule.onBatchItem;

      // Create complete context object for continuation
      const ctx = {
        shopify: shopify,
        jobConfig: originalJob.jobConfig,
        env: this.env,
        shopConfig: originalJob.shopConfig
      };

      // Create callbacks if job provides factories
      const onProgress = (completed, total) => {
        if (completed % 10 === 0 || completed === total) {
          console.log(`📊 Progress: ${completed}/${total} items processed`);
        }
      };

      let onBatchComplete = async (batchResults, batchNum, totalBatches) => {
        console.log(`✅ Batch ${batchNum}/${totalBatches} completed (In alarm)`);
      };

      // Use job's batch complete callback if available
      if (jobModule.createOnBatchComplete) {
        const durableObjectState = {
          storage: this.ctx.storage,
          setAlarm: (date) => this.ctx.storage.setAlarm(date),
          getAlarm: () => this.ctx.storage.getAlarm(),
          deleteAlarm: () => this.ctx.storage.deleteAlarm()
        };

        onBatchComplete = jobModule.createOnBatchComplete(ctx);

        // Wrap to pass durableObjectState
        const originalOnBatchComplete = onBatchComplete;
        onBatchComplete = async (batchResults, batchNum, totalBatches) => {
          await originalOnBatchComplete(batchResults, batchNum, totalBatches, durableObjectState);
        };
      }

      // Use generic batch processor continuation
      const { continueBatchProcessing } = await import('./utils/batch-processor.js');

      await continueBatchProcessing({
        ctx,
        onBatchItem,
        durableObjectState: {
          storage: this.ctx.storage,
          setAlarm: (date) => this.ctx.storage.setAlarm(date),
          getAlarm: () => this.ctx.storage.getAlarm(),
          deleteAlarm: () => this.ctx.storage.deleteAlarm()
        },
        onProgress,
        onBatchComplete
      });

    } catch (error) {
      console.error('❌ Error in batch processing alarm:', error);
      // Mark batch as failed
      await this.ctx.storage.put('batch:processor:state', {
        ...iterationState,
        status: 'failed',
        error: error.message,
        updatedAt: new Date().toISOString()
      });
    }
  }

  /**
   * Get the currently active job for batch processing
   */
  async getActiveJob() {
    // Look for the most recent job that supports batch processing
    const allJobs = await this.ctx.storage.list({ prefix: 'job:', suffix: ':meta' });
    const jobs = Array.from(allJobs.values())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Find the most recent job that supports batch processing
    for (const job of jobs) {
      const jobData = await this.getJobData(job.id);
      const jobModule = await import(`./jobs/${jobData.jobPath}/job.js`);
      if (jobModule.onBatchItem) {
        return {
          jobId: job.id,
          jobPath: jobData.jobPath,
          shopDomain: jobData.shopDomain,
          shopConfig: jobData.shopConfig,
          jobConfig: jobData.jobConfig
        };
      }
    }

    return null;
  }
}
