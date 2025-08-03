/**
 * JobDispatcher Workflow for processing Shopify webhook jobs
 */

import { WorkflowEntrypoint } from "cloudflare:workers";
import { loadJobConfig as workerLoadJobConfig, loadJobModule } from "./worker/job-loader.js";
import { createShopifyClient } from "./shared/shopify.js";

export class JobDispatcher extends WorkflowEntrypoint {
  async run(event, step) {
    // Parameters are passed via event.payload according to Cloudflare docs
    const { shopDomain, jobPath, payload, r2Key, isLargePayload, shopConfig } = event.payload;

    // Step 1: Retrieve payload if it's stored in R2
    const jobData = await step.do("retrieve-payload", async () => {
      if (isLargePayload && r2Key) {
        const r2Object = await this.env.R2_BUCKET.get(r2Key);
        if (!r2Object) {
          throw new Error(`Large payload not found in R2: ${r2Key}`);
        }
        return await r2Object.json();
      } else {
        return payload;
      }
    });

    // Step 2: Load job configuration
    const finalJobConfig = await step.do("load-job-config", async () => {
      try {
        let config = await workerLoadJobConfig(jobPath);

        // Check for config overrides in the payload
        if (jobData._configOverrides) {
          config = {
            ...config,
            test: {
              ...config.test,
              ...jobData._configOverrides,
            },
          };
        }

        return config;
      } catch (error) {
        throw new Error(`Failed to load job config for ${jobPath}: ${error.message}`);
      }
    });

    // Step 3: Create Shopify client (not serializable, so create outside of workflow step)
    const accessToken = shopConfig?.shopify_token || this.env.SHOPIFY_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error("Shopify API access token not configured");
    }

    const shopify = createShopifyClient({
      shop: shopDomain,
      accessToken,
      apiVersion: finalJobConfig?.apiVersion,
    });

    // Step 4: Load job module (not a workflow step, just load the module)
    const jobModule = await loadJobModule(jobPath);

    // Execute the job directly - let it create its own workflow steps
    const result = await jobModule.process({
      shopify,
      payload: jobData,
      shopConfig,
      jobConfig: finalJobConfig,
      env: this.env,
      secrets: this.loadSecretsFromEnv(this.env),
      step, // Pass the step function so jobs can create their own workflow steps at the top level
    });

    // Step 5: Clean up large payload if needed
    await step.do("cleanup", async () => {
      if (isLargePayload && r2Key) {
        try {
          await this.env.R2_BUCKET.delete(r2Key);
        } catch (error) {
          console.warn(`Failed to clean up large payload ${r2Key}:`, error.message);
        }
      }
      return { cleanup: "completed" };
    });

    return result;
  }

  /**
   * Load secrets from environment variables
   */
  loadSecretsFromEnv(env) {
    const secrets = {};
    for (const key in env) {
      if (key.startsWith("SECRET_")) {
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
}