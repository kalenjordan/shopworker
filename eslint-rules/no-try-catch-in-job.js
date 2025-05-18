import path from 'path';

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow try/catch blocks in job files',
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();
    const isJobFile = filename.includes(`${path.sep}jobs${path.sep}`) && filename.endsWith('job.js');
    if (!isJobFile) {
      return {};
    }
    return {
      TryStatement(node) {
        context.report({
          node,
          message: 'Try/catch blocks are not allowed in job files. Remove error handling or move it to the caller.'
        });
      }
    };
  }
};
