/**
 * JobDispatcher Workflow for processing Shopify webhook jobs
 */

import { WorkflowEntrypoint } from "cloudflare:workers";
import { loadJobConfig as workerLoadJobConfig, loadJobModule } from "./worker/job-loader.js";
import { createShopifyClient } from "./shared/shopify.js";
import { sendEmail, validateCredentials } from "./connectors/resend.js";
import { isWorkerEnvironment } from "./shared/env.js";

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
    try {
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
    } catch (error) {
      // Send error notification email if email is configured
      await step.do("send-error-notification", async () => {
        const shouldSendErrorEmail = finalJobConfig.send_email !== false;

        if (shouldSendErrorEmail && shopConfig.resend_api_key) {
          try {
            validateCredentials({ resend_api_key: shopConfig.resend_api_key });

            const timestamp = new Date().toLocaleString('en-US', {
              timeZone: 'America/Chicago',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              timeZoneName: 'short'
            });

            const errorEmail = {
              to: finalJobConfig.email_to || ['kalenj@gmail.com'],
              from: finalJobConfig.email_from || 'ShopWorker <worker@shopworker.dev>',
              subject: `❌ Job Failed: ${finalJobConfig.title || jobPath} - ${shopDomain}`,
              html: `
            <h2>Job Execution Failed</h2>
            <p><strong>Job:</strong> ${finalJobConfig.title || jobPath}</p>
            <p><strong>Error:</strong> ${error.message}</p>
            <p><strong>Shop:</strong> ${shopDomain}</p>
            <p><strong>Environment:</strong> ${isWorkerEnvironment(this.env) ? 'Worker' : 'CLI'}</p>
            <p><strong>Time:</strong> ${timestamp}</p>
            <h3>Stack Trace:</h3>
            <pre style="background: #f5f5f5; padding: 10px; border-radius: 4px;">${error.stack}</pre>
          `,
              text: `Job Execution Failed\n\nJob: ${finalJobConfig.title || jobPath}\nError: ${error.message}\nShop: ${shopDomain}\nTime: ${timestamp}\n\nStack:\n${error.stack}`
            };

            await sendEmail(errorEmail, shopConfig.resend_api_key);
            console.log(`Error notification email sent to ${errorEmail.to} - Subject: "${errorEmail.subject}"`);
          } catch (emailError) {
            console.error(`Failed to send error notification email: ${emailError.message}`);
          }
        }
      });

      // Clean up payload even on error
      await step.do("cleanup-on-error", async () => {
        if (isLargePayload && r2Key) {
          try {
            await this.env.R2_BUCKET.delete(r2Key);
          } catch (cleanupError) {
            console.warn(`Failed to clean up large payload ${r2Key}:`, cleanupError.message);
          }
        }
        return { cleanup: "completed" };
      });

      // Re-throw to mark workflow as failed
      throw error;
    }
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