import customPlugin from './eslint-plugin-custom/index.js';

export default [
  {
    ignores: ['node_modules/**'],
    plugins: { custom: customPlugin },
    rules: {
      'custom/no-try-catch-in-job': 'warn'
    }
  }
];
