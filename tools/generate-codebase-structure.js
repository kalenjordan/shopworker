#!/usr/bin/env node

/**
 * Script to generate a text file with the directory, file, and method signature structure of the codebase
 *
 * Usage: node tools/generate-codebase-structure.js [options]
 *
 * Options:
 *   --output, -o  Output file path (default: docs/codebase-structure.md)
 *   --depth, -d   Maximum directory depth to scan (default: unlimited)
 *   --help, -h    Show help
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'acorn';
import { simple as walk } from 'acorn-walk';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Parse command-line arguments
const args = process.argv.slice(2);
let outputFile = path.join(rootDir, 'docs', 'codebase-structure.md');
let maxDepth = Infinity;
let showHelp = false;
let includeJsDoc = true; // Default to including JSDoc

// Create docs directory if it doesn't exist
if (!fs.existsSync(path.join(rootDir, 'docs'))) {
  fs.mkdirSync(path.join(rootDir, 'docs'), { recursive: true });
}

// Parse args
for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg === '--help' || arg === '-h') {
    showHelp = true;
    break;
  } else if (arg === '--output' || arg === '-o') {
    if (i + 1 < args.length) {
      outputFile = args[++i];
      // If path is not absolute, make it relative to root dir
      if (!path.isAbsolute(outputFile)) {
        outputFile = path.join(rootDir, outputFile);
      }
      // Ensure parent directory exists
      const outputDir = path.dirname(outputFile);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
    }
  } else if (arg === '--depth' || arg === '-d') {
    if (i + 1 < args.length) {
      maxDepth = parseInt(args[++i], 10);
      if (isNaN(maxDepth)) {
        console.error('Error: Depth must be a number');
        process.exit(1);
      }
    }
  } else if (arg === '--no-jsdoc') {
    includeJsDoc = false;
  }
}

// Show help if requested
if (showHelp) {
  console.log(`
Usage: node tools/generate-codebase-structure.js [options]

Options:
  --output, -o    Output file path (default: docs/codebase-structure.md)
  --depth, -d     Maximum directory depth to scan (default: unlimited)
  --no-jsdoc      Exclude JSDoc descriptions from output
  --help, -h      Show help
`);
  process.exit(0);
}

// Directories to exclude from the scan (top-level directories)
const EXCLUDE_DIRS = [
  '.git',
  'node_modules',
  '.wrangler',
  '.cursor'
];

// Specific directory paths to exclude (can include nested paths)
const EXCLUDE_PATHS = [
  'jobs/cutting',
  'jobs/product',
  'jobs/order',
  'connectors',
  'graphql',
  'docs',
  'tools',
  // Add more paths to exclude as needed:
  // 'jobs/deprecated',
];

// Specific files to exclude
const EXCLUDE_FILES = [
  'package-lock.json',
  '.shopworker.json',
  '.shopworker.example.json',
  // Add more files to exclude as needed:
  // 'yarn.lock',
  // '.gitignore',
];

// File extensions to include
const INCLUDE_EXTENSIONS = [
  '.js',
  '.mjs',
  '.cjs',
  '.json'
];

// Structure content
let content = `# Shopworker Codebase Structure\nGenerated: ${new Date().toISOString()}\n\n`;

// Function to check if a path should be excluded
function shouldExcludePath(relativePath) {
  // Check if the path is in the exclude list
  return EXCLUDE_PATHS.some(excludePath => {
    // Make sure the path to check ends with '/' so we match directories properly
    const pathToCheck = relativePath.endsWith('/') ? relativePath : `${relativePath}/`;
    // Check if the exclude path is a substring at the start of the path to check
    return pathToCheck.startsWith(`${excludePath}/`);
  });
}

// Function to check if a file should be excluded
function shouldExcludeFile(filePath) {
  const fileName = path.basename(filePath);
  return EXCLUDE_FILES.includes(fileName);
}

// Function to extract method signatures from JS file
function extractMethodSignatures(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const signatures = [];
    const commentMap = {};
    const imports = []; // Track imports

    // Extract JSDoc comments if they are requested
    if (includeJsDoc) {
      const jsdocComments = fileContent.match(/\/\*\*[\s\S]*?\*\//g) || [];
      for (const comment of jsdocComments) {
        // Find the function or method declaration after the comment
        const commentEndIndex = fileContent.indexOf(comment) + comment.length;
        const afterComment = fileContent.substring(commentEndIndex).trim();

        // Look for function name after the comment
        const functionMatch = afterComment.match(/(?:function|class|const|let|var|export\s+(?:default\s+)?function|export\s+(?:default\s+)?const)\s+([a-zA-Z0-9_$]+)/);
        if (functionMatch) {
          const functionName = functionMatch[1];
          const description = extractJSDocDescription(comment);
          if (description) {
            commentMap[functionName] = description;
          }
        }
      }
    }

    try {
      // Parse the JavaScript file
      const ast = parse(fileContent, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        locations: true, // Enable locations for finding comments
      });

      // Extract imports
      walk(ast, {
        ImportDeclaration(node) {
          const source = node.source.value;
          let importStatement = '';

          // Handle different types of imports
          if (node.specifiers.length === 0) {
            // Side effect import (import 'module')
            importStatement = `import '${source}'`;
          } else {
            const defaultImports = [];
            const namedImports = [];
            const namespaceImports = [];

            // Separate different import types
            node.specifiers.forEach(specifier => {
              if (specifier.type === 'ImportDefaultSpecifier') {
                defaultImports.push(specifier.local.name);
              } else if (specifier.type === 'ImportNamespaceSpecifier') {
                namespaceImports.push(`* as ${specifier.local.name}`);
              } else if (specifier.type === 'ImportSpecifier') {
                if (specifier.imported && specifier.local.name !== specifier.imported.name) {
                  namedImports.push(`${specifier.imported.name} as ${specifier.local.name}`);
                } else {
                  namedImports.push(specifier.local.name);
                }
              }
            });

            // Build the import statement
            const parts = [];
            if (defaultImports.length > 0) {
              parts.push(defaultImports.join(', '));
            }
            if (namedImports.length > 0) {
              parts.push(`{ ${namedImports.join(', ')} }`);
            }
            if (namespaceImports.length > 0) {
              parts.push(namespaceImports.join(', '));
            }

            importStatement = `import ${parts.join(', ')} from '${source}'`;
          }

          imports.push(importStatement);
        },
        // Look for require statements (might be in CommonJS files)
        CallExpression(node) {
          if (node.callee.type === 'Identifier' && node.callee.name === 'require' &&
              node.arguments.length > 0 && node.arguments[0].type === 'Literal') {

            const source = node.arguments[0].value;

            // Get the parent node to see if it's a variable declaration
            let isHandled = false;

            if (node.parent && node.parent.type === 'VariableDeclarator') {
              if (node.parent.id.type === 'Identifier') {
                imports.push(`const ${node.parent.id.name} = require('${source}')`);
                isHandled = true;
              } else if (node.parent.id.type === 'ObjectPattern') {
                try {
                  const properties = node.parent.id.properties.map(p =>
                    p.key && p.key.name ? p.key.name : 'unknown'
                  ).join(', ');
                  imports.push(`const { ${properties} } = require('${source}')`);
                  isHandled = true;
                } catch (e) {
                  // If there's an error parsing the object pattern, fall back to a simpler representation
                }
              }
            }

            if (!isHandled) {
              imports.push(`require('${source}')`);
            }
          }
        }
      });

      // Walk the AST to find function declarations and exports
      walk(ast, {
        FunctionDeclaration(node) {
          const name = node.id.name;
          const params = extractParams(node.params, fileContent, node);
          const returnType = extractReturnType(fileContent, node);

          const signature = formatSignature("function", name, params, returnType);
          const description = includeJsDoc && commentMap[name] ? `\n   ${commentMap[name]}` : '';

          signatures.push(`${signature}${description}`);
        },
        MethodDefinition(node) {
          const methodName = node.key.name || node.key.value;
          const params = extractParams(node.value.params, fileContent, node.value);
          const returnType = extractReturnType(fileContent, node.value);

          const kind = node.kind === 'method' ? '' : `${node.kind} `;
          const signature = formatSignature(kind, methodName, params, returnType);
          const description = includeJsDoc && commentMap[methodName] ? `\n   ${commentMap[methodName]}` : '';

          signatures.push(`${signature}${description}`);
        },
        VariableDeclarator(node) {
          if (node.init && (node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression')) {
            const name = node.id.name;
            const params = extractParams(node.init.params, fileContent, node.init);
            const returnType = extractReturnType(fileContent, node.init);

            const signature = formatSignature("const", name, params, returnType, true);
            const description = includeJsDoc && commentMap[name] ? `\n   ${commentMap[name]}` : '';

            signatures.push(`${signature}${description}`);
          }
        },
        ExportNamedDeclaration(node) {
          if (node.declaration) {
            if (node.declaration.type === 'FunctionDeclaration') {
              const name = node.declaration.id.name;
              const params = extractParams(node.declaration.params, fileContent, node.declaration);
              const returnType = extractReturnType(fileContent, node.declaration);

              const signature = formatSignature("export function", name, params, returnType);
              const description = includeJsDoc && commentMap[name] ? `\n   ${commentMap[name]}` : '';

              signatures.push(`${signature}${description}`);
            }
          }
        },
        ExportDefaultDeclaration(node) {
          if (node.declaration.type === 'FunctionDeclaration') {
            const name = node.declaration.id ? node.declaration.id.name : 'default';
            const params = extractParams(node.declaration.params, fileContent, node.declaration);
            const returnType = extractReturnType(fileContent, node.declaration);

            const signature = formatSignature("export default function", name, params, returnType);
            const description = includeJsDoc && commentMap[name] ? `\n   ${commentMap[name]}` : '';

            signatures.push(`${signature}${description}`);
          } else if (node.declaration.type === 'ArrowFunctionExpression') {
            const params = extractParams(node.declaration.params, fileContent, node.declaration);
            const returnType = extractReturnType(fileContent, node.declaration);

            const signature = formatSignature("export default", "", params, returnType, true);
            signatures.push(signature);
          } else if (node.declaration.type === 'Identifier') {
            signatures.push(`export default ${node.declaration.name}`);
          } else {
            signatures.push(`export default ${node.declaration.type}`);
          }
        }
      });

      return { signatures, imports };
    } catch (parseError) {
      return {
        signatures: [`[Unable to parse JavaScript: ${parseError.message}]`],
        imports: []
      };
    }
  } catch (error) {
    return {
      signatures: [`[Error reading file: ${error.message}]`],
      imports: []
    };
  }
}

// Helper function to extract JSDoc description and tags from a comment
function extractJSDocDescription(comment) {
  // Remove /** and */ and trim whitespace
  let description = comment.replace(/\/\*\*|\*\//g, '').trim();

  // Remove leading asterisks and whitespace from each line
  description = description.replace(/^\s*\* ?/gm, '');

  // Extract the first paragraph (up to the first @tag or empty line)
  const paragraphMatch = description.match(/^(.*?)(?=\s*@|\s*$|^\s*$)/s);
  if (paragraphMatch && paragraphMatch[1]) {
    return paragraphMatch[1].trim().replace(/\n\s*/g, ' ');
  }

  return '';
}

// Helper function to extract return type from JSDoc
function extractReturnType(fileContent, node) {
  try {
    if (!includeJsDoc) return '';

    // Find JSDoc comment that precedes the function
    const startPos = node.start;
    const precedingCode = fileContent.substring(0, startPos);
    const commentBlocks = precedingCode.match(/\/\*\*[\s\S]*?\*\//g) || [];

    if (commentBlocks.length === 0) return '';

    // Get the last comment block before the function
    const commentBlock = commentBlocks[commentBlocks.length - 1];

    // Look for @returns or @return tag
    const returnMatch = commentBlock.match(/@returns?(?:\s+\{([^}]+)\})?(?:\s+-?\s*(.*))?/);
    if (returnMatch) {
      const returnType = returnMatch[1];
      return returnType || '';
    }

    return '';
  } catch (error) {
    return '';
  }
}

// Helper function to extract parameter information and types if available
function extractParams(params, fileContent, node) {
  if (!includeJsDoc || !node) {
    // Simplified params without JSDoc
    return params.map(p => {
      if (p.type === 'Identifier') return p.name;
      if (p.type === 'AssignmentPattern') return `${p.left.name} = ...`;
      if (p.type === 'RestElement') return `...${p.argument.name}`;
      if (p.type === 'ObjectPattern') return '{...}';
      if (p.type === 'ArrayPattern') return '[...]';
      return '?';
    }).join(', ');
  }

  // Try to find parameter types in JSDoc if available
  const paramTypes = {};
  try {
    // Find JSDoc comment that precedes the function
    const startPos = node.start;
    const precedingCode = fileContent.substring(0, startPos);
    const commentBlocks = precedingCode.match(/\/\*\*[\s\S]*?\*\//g) || [];

    if (commentBlocks.length > 0) {
      // Get the last comment block before the function
      const commentBlock = commentBlocks[commentBlocks.length - 1];

      // Extract all @param tags
      const paramMatches = commentBlock.matchAll(/@param(?:\s+\{([^}]+)\})?\s+(\w+)(?:\s+-?\s*(.*))?/g);
      for (const match of paramMatches) {
        const paramType = match[1] || '';
        const paramName = match[2];
        const paramDesc = match[3] || '';

        paramTypes[paramName] = paramType;
      }
    }
  } catch (error) {
    // Ignore errors and continue with basic param information
  }

  // Format parameters, potentially with types
  return params.map(p => {
    let paramStr = '';

    if (p.type === 'Identifier') {
      const paramType = paramTypes[p.name] || '';
      paramStr = paramType ? `${p.name}: ${paramType}` : p.name;
    } else if (p.type === 'AssignmentPattern') {
      const paramName = p.left.name;
      const paramType = paramTypes[paramName] || '';
      paramStr = paramType ? `${paramName}: ${paramType} = ...` : `${paramName} = ...`;
    } else if (p.type === 'RestElement') {
      const paramName = p.argument.name;
      const paramType = paramTypes[paramName] || '';
      paramStr = paramType ? `...${paramName}: ${paramType}[]` : `...${paramName}`;
    } else if (p.type === 'ObjectPattern') {
      paramStr = '{...}';
    } else if (p.type === 'ArrayPattern') {
      paramStr = '[...]';
    } else {
      paramStr = '?';
    }

    return paramStr;
  }).join(', ');
}

// Function to format a method signature
function formatSignature(prefix, name, params, returnType, isArrow = false) {
  if (isArrow) {
    return `${prefix} ${name} = (${params}) => {...}${returnType ? ` : ${returnType}` : ''}`;
  } else {
    return `${prefix} ${name}(${params})${returnType ? `: ${returnType}` : ''}`;
  }
}

// Function to analyze file and extract information
function analyzeFile(filePath, relativePath) {
  const ext = path.extname(filePath);

  if (!INCLUDE_EXTENSIONS.includes(ext)) {
    return ''; // Skip unsupported file types
  }

  // Read file content and count lines
  let fileContent = '';
  let lineCount = 0;
  try {
    fileContent = fs.readFileSync(filePath, 'utf8');
    lineCount = fileContent.split('\n').length;
  } catch (error) {
    return `## ${relativePath} (${lineCount} lines)\n[Error reading file: ${error.message}]\n\n`;
  }

  let fileInfo = `## ${relativePath} (${lineCount} lines)\n`;

  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    // Special handling for GraphQL files in the graphql/ directory
    if (relativePath.startsWith('graphql/')) {
      try {
        // Look for GraphQL operation type and name
        const operationMatch = fileContent.match(/(query|mutation|subscription)\s+(\w+)/i);
        if (operationMatch) {
          const [, operationType, operationName] = operationMatch;
          fileInfo += `GraphQL ${operationType}: ${operationName}\n\n`;
          return fileInfo;
        }
      } catch (error) {
        // Fall back to regular method extraction if this fails
      }
    }

    // Extract method signatures and imports for JavaScript files
    const { signatures, imports } = extractMethodSignatures(filePath);

    // Add imports if there are any
    if (imports.length > 0) {
      fileInfo += 'Imports:\n';
      imports.forEach(importStatement => {
        fileInfo += `- ${importStatement}\n`;
      });
      fileInfo += '\n';
    }

    // Add method signatures
    if (signatures.length > 0) {
      fileInfo += 'Methods:\n';
      signatures.forEach(sig => {
        fileInfo += `- ${sig}\n`;
      });
    } else {
      fileInfo += '(No methods found)\n';
    }
  } else if (ext === '.json') {
    try {
      // For JSON files, show file size in addition to line count
      const stats = fs.statSync(filePath);
      fileInfo += `(JSON file, ${(stats.size / 1024).toFixed(1)} KB)\n`;
    } catch (error) {
      fileInfo += `(Error reading JSON: ${error.message})\n`;
    }
  }

  return fileInfo + '\n';
}

// Function to scan directories
function scanDirectory(dirPath, level = 0, relativePath = '') {
  // Check if we've reached the maximum depth
  if (level > maxDepth) {
    content += `${'#'.repeat(level + 1)} ${path.basename(dirPath)}/ (max depth reached)\n\n`;
    return;
  }

  // Check if this directory path should be excluded
  if (level > 0 && shouldExcludePath(relativePath)) {
    // Skip this directory completely - don't add anything to the content
    return;
  }

  const items = fs.readdirSync(dirPath);

  // Add directory to content
  if (level > 0) {
    content += `${'#'.repeat(level + 1)} ${path.basename(dirPath)}/\n\n`;
  }

  // Process all files first
  const files = items
    .filter(item => {
      const itemPath = path.join(dirPath, item);
      return !fs.statSync(itemPath).isDirectory() && !shouldExcludeFile(itemPath);
    })
    .sort();

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const fileRelativePath = path.join(relativePath, file);
    content += analyzeFile(filePath, fileRelativePath);
  }

  // Then process directories
  const dirs = items
    .filter(item => {
      const itemPath = path.join(dirPath, item);
      return fs.statSync(itemPath).isDirectory() && !EXCLUDE_DIRS.includes(item);
    })
    .sort();

  for (const dir of dirs) {
    const nextDirPath = path.join(dirPath, dir);
    const nextRelativePath = path.join(relativePath, dir);
    scanDirectory(nextDirPath, level + 1, nextRelativePath);
  }
}

// Main execution
try {
  console.log(`Generating codebase structure...`);
  console.log(`Output file: ${outputFile}`);
  console.log(`Maximum depth: ${maxDepth === Infinity ? 'unlimited' : maxDepth}`);
  console.log(`Include JSDoc: ${includeJsDoc ? 'yes' : 'no'}`);
  if (EXCLUDE_PATHS.length > 0) {
    console.log(`Excluded paths: ${EXCLUDE_PATHS.join(', ')}`);
  }
  if (EXCLUDE_FILES.length > 0) {
    console.log(`Excluded files: ${EXCLUDE_FILES.join(', ')}`);
  }

  scanDirectory(rootDir);

  // Write output
  fs.writeFileSync(outputFile, content, 'utf8');
  console.log(`Structure written to ${outputFile}`);
} catch (error) {
  console.error('Error generating structure:', error);
  process.exit(1);
}
