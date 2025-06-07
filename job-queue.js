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

      // Process the job with complete data
      await jobModule.process({
        payload: bodyData,
        shopify,
        env: this.env,
        shopConfig,
        jobConfig,
        secrets
      });

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
}
