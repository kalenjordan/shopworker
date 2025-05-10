
# Refactored **/utils** Plan

Generated 2025-05-10T22:39:53

---

## 📁 Final Folder Layout

```
utils/
├── crypto.js            ← shared  (hmacSha256)
├── job-loader.js        ← shared
├── shopify.js           ← shared  (Shopify client + helpers)
├── cli-helpers.js       ← CLI‑only  (deploy, job discovery/testing, logToCli…)
├── webhook-cli.js       ← CLI‑only  (webhook status/enable/disable…)
└── worker-helpers.js    ← Worker‑only (logToWorker, verifyShopifyWebhook)
```

---

## 🔍 Method Signatures by File

### `utils/crypto.js`

| Signature | Purpose |
|-----------|---------|
| `async hmacSha256(secret: string, payload: string \| ArrayBuffer): Promise<string>` | Cross‑runtime SHA‑256 HMAC → base‑64. |

---

### `utils/job-loader.js`

| Signature |
|-----------|
| `loadJobConfig(jobPath: string): object` |
| `loadTriggerConfig(triggerName: string): object` |
| `loadJobsConfig(): object` |

---

### `utils/shopify.js`

| Signature |
|-----------|
| `createShopifyClient(opts: { shop: string; accessToken: string; apiVersion?: string; retries?: number; timeout?: number }): object` |
| `initShopify(cliDir: string, jobPath: string, shopParam: string): object` |
| *(internal)* `findUserErrors(res: object): string[] \| null` |
| *(internal)* `truncateQuery(src: string): string` |

---

### `utils/cli-helpers.js`

| Signature |
|-----------|
| `detectJobDirectory(cliDir: string, specifiedDir?: string): string \| null` |
| `ensureAndResolveJobName(cliDir: string, jobArg?: string, dirOpt?: string, autoSingle?: boolean): Promise<string \| null>` |
| `listAvailableJobs(cliDir: string, prefix?: string): void` |
| `getWorkerUrl(opts: object, cliDir?: string): string \| null` |
| `loadAndValidateWebhookConfigs(cliDir: string, jobPath: string): object \| null` |
| `handleCloudflareDeployment(cliDir: string): Promise<boolean>` |
| `runJobTest(cliDir: string, jobPath: string, query?: string, shop?: string): Promise<void>` |
| `findSampleRecordForJob(cliDir: string, jobPath: string, query?: string, shop?: string): Promise<{ record; recordName; shopify; triggerConfig; jobConfig; }>` |
| `runJobRemoteTest(cliDir: string, jobPath: string, opts: object): Promise<void>` |
| `logToCli(env: any, ...args: any[]): void` |
| `getShopConfig(cliDir: string, shopName: string): object` |
| `getShopDomain(cliDir: string, shopName: string): string` |

---

### `utils/webhook-cli.js`

| Signature |
|-----------|
| `handleAllJobsStatus(cliDir: string, filterCurrent?: boolean): Promise<void>` |
| `handleSingleJobStatus(cliDir: string, jobPath: string): Promise<void>` |
| `enableJobWebhook(cliDir: string, jobPath: string, workerUrl: string): Promise<void>` |
| `disableJobWebhook(cliDir: string, jobPath: string, workerUrl: string): Promise<void>` |
| `deleteWebhookById(cliDir: string, jobPath: string, webhookId: string): Promise<void>` |
| `getJobDisplayInfo(cliDir: string, jobPath: string): Promise<object>` |

---

### `utils/worker-helpers.js`

| Signature |
|-----------|
| `logToWorker(env: any, ...args: any[]): void` |
| `verifyShopifyWebhook(req: Request, body: string, env: any, shopCfg: any): Promise<boolean>` |

---

## 🔄 Current → New File & Method Mapping

| **Old file** | **Method / export** | **New home** | Notes |
|--------------|--------------------|--------------|-------|
| `common-helpers.js` | `detectJobDirectory`, `listAvailableJobs`, `ensureAndResolveJobName`, `getWorkerUrl`, `loadAndValidateWebhookConfigs`, `getAvailableJobDirs` | **cli-helpers.js** | Pure CLI helpers grouped. |
| `deployment-manager.js` | `handleCloudflareDeployment` | **cli-helpers.js** | Deployed alongside other CLI logic. |
| `job-executor.js` | `runJobTest`, `findSampleRecordForJob`, `runJobRemoteTest`, `getShopConfig`, `getShopDomain` | **cli-helpers.js** | Testing & shop helpers merged in. |
|  | `generateHmacSignature` | **crypto.js** (`hmacSha256`) | Single unified HMAC helper. |
| `job-loader.js` | *all exports* | **job-loader.js** *(unchanged)* | Already shared. |
| `shopify-api-helpers.js` & `shopify-client.js` | `createShopifyClient`, `initShopify`, `findUserErrors`, `truncateQuery` | **shopify.js** | One combined Shopify module. |
| `webhook-handlers.js` | *all exports* | **webhook-cli.js** | Renamed; still CLI‑only. |
| `worker-helpers.js` | `logToWorker` | **worker-helpers.js** | Retains Worker logger. |
|  | `logToCli` | **cli-helpers.js** | Moves to Node side. |
|  | `isCloudflareWorker` | **removed** | No longer used. |
| `worker-utils.js` | `verifyShopifyWebhook` | **worker-helpers.js** | Consolidated with Worker logger. |
|  | `generateHmacSignature` (Web Crypto impl) | **crypto.js** (`hmacSha256`) | Duplicate removed. |

---

### ✅ Benefits

* **Six** clearly‑scoped files instead of eleven.
* No duplicate HMAC code; one `hmacSha256` works everywhere.
* CLI vs Worker boundaries are obvious from filenames.
* Existing entrypoints `cli.js` and `worker.js` remain untouched.
