// Central export for all command registration functions

export { registerTestCommand } from './test.js';
export { registerEnableCommand } from './enable.js';
export { registerDisableCommand } from './disable.js';
export { registerStatusCommand } from './status.js';
export { registerJsonStatusCommand } from './json-status.js';
export { registerRuntestCommand } from './runtest.js';
export { registerDeployCommand } from './deploy.js';
export { registerPutSecretsCommand } from './put-secrets.js';
export { registerRemoteTestCommand } from './remote-test.js';
export { registerDeleteWebhookCommand } from './delete-webhook.js';