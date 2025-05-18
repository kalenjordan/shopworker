import customPlugin from './eslint-plugin-custom.js';

export default {
  env: {
    es2022: true,
    node: true,
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: {
    custom: customPlugin
  },
  rules: {
    'custom/no-try-catch-in-job': 'error'
  }
};
