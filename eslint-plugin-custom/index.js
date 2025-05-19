export default {
  rules: {
    'no-try-catch-in-job': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow try/catch blocks in job files'
        },
        messages: {
          noTryCatch: 'Try/catch blocks are not allowed in job files. Handle errors in the caller.'
        }
      },
      create(context) {
        return {
          TryStatement(node) {
            const filename = context.getFilename();
            if (/\bjobs\/.*job\.js$/.test(filename)) {
              context.report({ node, messageId: 'noTryCatch' });
            }
          }
        };
      }
    }
  }
};
