#!/usr/bin/env node

/**
 * Script to generate a text file with the directory, file, and method signature structure of the codebase
 *
 * Usage: node tools/generate-codebase-structure.js [directory] [options]
 *
 * Arguments:
 *   directory    Directory to scan (default: current project root)
 *
 * Options:
 *   --output, -o  Output file path (default: codebase-structure.md in the scanned directory)
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
let outputFile = 'codebase-structure.md'; // Default relative path
let maxDepth = Infinity;
let showHelp = false;
let includeJsDoc = true; // Default to including JSDoc
let customRootDir = rootDir; // Default to the project's root directory
let isCustomDir = false; // Flag to track if a custom directory was specified
let positionalArgs = [];

// Process flags and collect positional arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg.startsWith('--') || arg.startsWith('-')) {
    // Handle flags
    if (arg === '--help' || arg === '-h') {
      showHelp = true;
      break;
    } else if (arg === '--output' || arg === '-o') {
      if (i + 1 < args.length) {
        outputFile = args[++i];
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
  } else {
    // Collect positional arguments
    positionalArgs.push(arg);
  }
}

// Set directory from the first positional argument if provided
if (positionalArgs.length > 0) {
  customRootDir = positionalArgs[0];
  isCustomDir = true;
  // If path is not absolute, make it relative to current directory
  if (!path.isAbsolute(customRootDir)) {
    customRootDir = path.resolve(process.cwd(), customRootDir);
  }
  if (!fs.existsSync(customRootDir)) {
    console.error(`Error: Directory ${customRootDir} does not exist`);
    process.exit(1);
  }
}

// Create docs directory if it doesn't exist (only in the default root dir)
if (!isCustomDir && !fs.existsSync(path.join(rootDir, 'docs'))) {
  fs.mkdirSync(path.join(rootDir, 'docs'), { recursive: true });
}

// Resolve output file path relative to the directory being scanned
if (!path.isAbsolute(outputFile)) {
  outputFile = path.join(customRootDir, outputFile);
}
// Ensure parent directory exists
const outputDir = path.dirname(outputFile);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Show help if requested
if (showHelp) {
  console.log(`
Usage: node tools/generate-codebase-structure.js [directory] [options]

Arguments:
  directory      Directory to scan (default: current project root)

Options:
  --output, -o    Output file path (default: codebase-structure.md in the scanned directory)
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
  'graphql',
  'docs',
  'tools',
  '.gadget',
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
let content = `# Files Sorted by Line Count\nGenerated: ${new Date().toISOString()}\n\n`;

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

// Function to count lines in a method body
function countMethodLines(fileContent, node) {
  if (!node || !node.loc) return 0;

  // For function declarations and expressions
  if (node.body && node.body.loc) {
    const startLine = node.body.loc.start.line;
    const endLine = node.body.loc.end.line;
    return endLine - startLine + 1;
  }

  return 0;
}

// Function to extract method calls within a method body
function extractMethodCalls(fileContent, node, definedMethods, imports) {
  const methodCalls = new Set();

  if (!node || !node.body) return methodCalls;

  // Skip common utility method names that are likely not local methods
  const commonGenericMethods = new Set([
    'get', 'set', 'push', 'pop', 'map', 'filter', 'forEach', 'find',
    'indexOf', 'includes', 'join', 'split', 'slice', 'substring',
    'replace', 'trim', 'toString', 'valueOf', 'parse', 'stringify',
    'keys', 'values', 'entries', 'fill', 'concat', 'shift', 'unshift',
    'every', 'some', 'reduce', 'reduceRight', 'reverse', 'sort',
    'splice', 'copyWithin', 'isArray', 'fromCharCode', 'match', 'test',
    'exec', 'hasOwnProperty', 'freeze', 'assign', 'create', 'defineProperty',
    'getOwnPropertyDescriptor', 'getOwnPropertyNames', 'seal', 'is', 'isExtensible',
    'isSealed', 'isFrozen', 'isInteger', 'isFinite', 'parseInt', 'parseFloat',
    'toString', 'toFixed', 'toPrecision'
  ]);

  // Built-in objects with methods we should ignore
  const builtInObjects = new Set([
    'Array', 'Object', 'String', 'Number', 'Boolean', 'Date', 'Math',
    'RegExp', 'JSON', 'Promise', 'Set', 'Map', 'WeakMap', 'WeakSet',
    'Symbol', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array',
    'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array',
    'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Error', 'File',
    'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'Blob'
  ]);

  // Map of imported functions to their source modules
  const importedFunctions = new Map();

  // Process imports to track imported functions
  if (imports) {
    imports.forEach(importStmt => {
      // Extract import name
      const fromMatch = importStmt.match(/import\s+(?:{([^}]+)}|([^\s{]+))\s+from\s+['"]([^'"]+)['"]/);
      if (fromMatch) {
        const namedImports = fromMatch[1];
        const defaultImport = fromMatch[2];
        const source = fromMatch[3];

        if (namedImports) {
          // Handle named imports like { func1, func2 }
          const funcNames = namedImports.split(',').map(name => {
            const parts = name.trim().split(/\s+as\s+/);
            return parts[parts.length - 1].trim(); // Get the local name after 'as' if present
          });

          funcNames.forEach(funcName => {
            importedFunctions.set(funcName, source);
          });
        }

        if (defaultImport) {
          // Handle default import
          importedFunctions.set(defaultImport.trim(), source);
        }
      }

      // Check for require syntax
      const requireMatch = importStmt.match(/(?:const|let|var)\s+(?:{([^}]+)}|([^\s{=]+))\s*=\s*require\(['"]([^'"]+)['"]\)/);
      if (requireMatch) {
        const namedImports = requireMatch[1];
        const defaultImport = requireMatch[2];
        const source = requireMatch[3];

        if (namedImports) {
          const funcNames = namedImports.split(',').map(name => name.trim());
          funcNames.forEach(funcName => {
            importedFunctions.set(funcName, source);
          });
        }

        if (defaultImport) {
          importedFunctions.set(defaultImport.trim(), source);
        }
      }
    });
  }

  try {
    // Walk the function body to find method calls
    walk(node.body, {
      CallExpression(callNode) {
        // Direct function calls like func()
        if (callNode.callee.type === 'Identifier') {
          const methodName = callNode.callee.name;

          // Skip console.* methods
          if (methodName === 'console') {
            return;
          }

          // Check if it's a defined method in this file
          if (definedMethods.has(methodName)) {
            methodCalls.add(methodName);
          }
          // Check if it's an imported function
          else if (importedFunctions.has(methodName)) {
            const source = importedFunctions.get(methodName);
            const moduleName = source.split('/').pop().replace(/\.js$/, '');
            methodCalls.add(`${moduleName}.${methodName}`);
          }
          // We're skipping all other direct method calls since they might be native or globals
        }
        // Object method calls like obj.method()
        else if (callNode.callee.type === 'MemberExpression' &&
                callNode.callee.property &&
                callNode.callee.property.type === 'Identifier') {

          const methodName = callNode.callee.property.name;

          // Skip console logging methods
          if (callNode.callee.object.type === 'Identifier' &&
              callNode.callee.object.name === 'console') {
            return;
          }

          // Skip common utility methods
          if (commonGenericMethods.has(methodName)) {
            return;
          }

          // Try to get the object name for context
          if (callNode.callee.object) {
            if (callNode.callee.object.type === 'Identifier') {
              const objectName = callNode.callee.object.name;

              // Skip built-in objects
              if (builtInObjects.has(objectName)) {
                return;
              }

              // Check if it's an imported module
              if (importedFunctions.has(objectName)) {
                const source = importedFunctions.get(objectName);
                const moduleName = source.split('/').pop().replace(/\.js$/, '');
                methodCalls.add(`${moduleName}.${methodName}`);
              } else if (definedMethods.has(objectName)) {
                // Only include object method calls if the object is defined in this file
                methodCalls.add(`${objectName}.${methodName}`);
              }
              // Skip other object method calls since they might be on native objects or parameters
            }
            // Skip complex object expressions
          }
        }
      }
    });
  } catch (error) {
    // Ignore errors in dependency extraction
  }

  return Array.from(methodCalls);
}

// Function to extract method signatures from JS file
function extractMethodSignatures(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const signatures = [];
    const commentMap = {};
    const imports = []; // Track imports
    const definedMethods = new Set(); // Track method names defined in this file

    // First pass: collect all defined method names
    try {
      const firstPassAst = parse(fileContent, {
        ecmaVersion: 2022,
        sourceType: 'module',
      });

      walk(firstPassAst, {
        FunctionDeclaration(node) {
          if (node.id && node.id.name) {
            definedMethods.add(node.id.name);
          }
        },
        MethodDefinition(node) {
          if (node.key && (node.key.name || node.key.value)) {
            definedMethods.add(node.key.name || node.key.value);
          }
        },
        VariableDeclarator(node) {
          if (node.id && node.id.name && node.init &&
             (node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression')) {
            definedMethods.add(node.id.name);
          }
        },
        // Add support for class properties that are functions
        ClassProperty(node) {
          if (node.key && (node.key.name || node.key.value) &&
              node.value && (node.value.type === 'ArrowFunctionExpression' || node.value.type === 'FunctionExpression')) {
            definedMethods.add(node.key.name || node.key.value);
          }
        }
      });
    } catch (error) {
      // Ignore errors in first pass
    }

    // Extract JSDoc comments if they are requested
    if (includeJsDoc) {
      // Find all JSDoc comment blocks
      const jsdocComments = fileContent.match(/\/\*\*[\s\S]*?\*\//g) || [];

      for (const comment of jsdocComments) {
        // Get the position of this comment in the file
        const commentStartIndex = fileContent.indexOf(comment);
        const commentEndIndex = commentStartIndex + comment.length;

        // Extract everything after the comment until we hit another comment or EOF
        const afterComment = fileContent.substring(commentEndIndex).trim();

        // Try to match different function declaration styles that might follow the comment
        const functionMatch = afterComment.match(/(?:function|class|const|let|var|export\s+(?:default\s+)?function|export\s+(?:default\s+)?const)\s+([a-zA-Z0-9_$]+)/);
        const methodMatch = afterComment.match(/(\w+)\s*\([^)]*\)\s*{/);
        const asyncMethodMatch = afterComment.match(/async\s+(\w+)\s*\([^)]*\)\s*{/);
        const objectMethodMatch = afterComment.match(/(\w+)\s*\([^)]*\)\s*{[^}]*},?/);

        if (functionMatch) {
          const functionName = functionMatch[1];
          const description = extractJSDocDescription(comment);
          if (description) {
            commentMap[functionName] = description;
          }
        } else if (objectMethodMatch) {
          const methodName = objectMethodMatch[1];
          const description = extractJSDocDescription(comment);
          if (description) {
            commentMap[methodName] = description;
          }
        } else if (methodMatch) {
          const methodName = methodMatch[1];
          const description = extractJSDocDescription(comment);
          if (description) {
            commentMap[methodName] = description;
          }
        } else if (asyncMethodMatch) {
          const methodName = asyncMethodMatch[1];
          const description = extractJSDocDescription(comment);
          if (description) {
            commentMap[methodName] = description;
          }
        }
      }
    }

    try {
      // Parse the JavaScript file
      const ast = parse(fileContent, {
        ecmaVersion: 2022,
        sourceType: 'module',
        locations: true,
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
          let params = extractParams(node.params, fileContent, node);

          // Check if we have object destructuring from JSDoc
          const jsDocParams = extractJSDocParams(fileContent, node);
          if (jsDocParams) {
            // If it's a single parameter that's an object destructuring, replace it
            if (params.startsWith('{') || params === '') {
              params = jsDocParams;
            }
          }

          const returnType = extractReturnType(fileContent, node);
          const lineCount = countMethodLines(fileContent, node);
          const methodCalls = extractMethodCalls(fileContent, node, definedMethods, imports);

          const signature = formatSignature("function", name, params, returnType, false, lineCount);
          const description = includeJsDoc && commentMap[name] ? commentMap[name] : '';

          signatures.push({ signature, description, methodCalls, jsDocParams });
        },
        MethodDefinition(node) {
          const methodName = node.key.name || node.key.value;
          const isAsync = node.value && node.value.async;
          let params = extractParams(node.value.params, fileContent, node.value);

          // Check if we have object destructuring from JSDoc
          const jsDocParams = extractJSDocParams(fileContent, node.value);
          if (jsDocParams) {
            // If it's a single parameter that's an object destructuring, replace it
            if (params.startsWith('{') || params === '') {
              params = jsDocParams;
            }
          }

          const returnType = extractReturnType(fileContent, node.value);
          const lineCount = countMethodLines(fileContent, node.value);
          const methodCalls = extractMethodCalls(fileContent, node.value, definedMethods, imports);

          const kind = isAsync ? 'async ' : (node.kind === 'method' ? '' : `${node.kind} `);
          const signature = formatSignature(kind, methodName, params, returnType, false, lineCount);
          const description = includeJsDoc && commentMap[methodName] ? commentMap[methodName] : '';

          signatures.push({ signature, description, methodCalls, jsDocParams });
        },
        // Add support for class properties that are arrow functions
        ClassProperty(node) {
          if (node.key && (node.key.name || node.key.value) &&
              node.value && (node.value.type === 'ArrowFunctionExpression' || node.value.type === 'FunctionExpression')) {

            const name = node.key.name || node.key.value;
            const isAsync = node.value.async;
            let params = extractParams(node.value.params, fileContent, node.value);

            // Check if we have object destructuring from JSDoc
            const jsDocParams = extractJSDocParams(fileContent, node.value);
            if (jsDocParams) {
              // If it's a single parameter that's an object destructuring, replace it
              if (params.startsWith('{') || params === '') {
                params = jsDocParams;
              }
            }

            const returnType = extractReturnType(fileContent, node.value);
            const lineCount = countMethodLines(fileContent, node.value);
            const methodCalls = extractMethodCalls(fileContent, node.value, definedMethods, imports);

            const kind = isAsync ? 'async ' : '';
            const signature = formatSignature(kind, name, params, returnType, true, lineCount);
            const description = includeJsDoc && commentMap[name] ? commentMap[name] : '';

            signatures.push({ signature, description, methodCalls, jsDocParams });
          }
        },
        VariableDeclarator(node) {
          if (node.id && node.id.name && node.init &&
             (node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression')) {
            const name = node.id.name;
            const isAsync = node.init.async;
            let params = extractParams(node.init.params, fileContent, node.init);

            // Check if we have object destructuring from JSDoc
            const jsDocParams = extractJSDocParams(fileContent, node.init);
            if (jsDocParams) {
              // If it's a single parameter that's an object destructuring, replace it
              if (params.startsWith('{') || params === '') {
                params = jsDocParams;
              }
            }

            const returnType = extractReturnType(fileContent, node.init);
            const lineCount = countMethodLines(fileContent, node.init);
            const methodCalls = extractMethodCalls(fileContent, node.init, definedMethods, imports);

            const kind = isAsync ? 'async const' : 'const';
            const signature = formatSignature(kind, name, params, returnType, true, lineCount);
            const description = includeJsDoc && commentMap[name] ? commentMap[name] : '';

            signatures.push({ signature, description, methodCalls, jsDocParams });
          }
        },
        ExportNamedDeclaration(node) {
          if (node.declaration) {
            if (node.declaration.type === 'FunctionDeclaration') {
              const name = node.declaration.id.name;
              const isAsync = node.declaration.async;
              let params = extractParams(node.declaration.params, fileContent, node.declaration);

              // Check if we have object destructuring from JSDoc
              const jsDocParams = extractJSDocParams(fileContent, node.declaration);
              if (jsDocParams) {
                // If it's a single parameter that's an object destructuring, replace it
                if (params.startsWith('{') || params === '') {
                  params = jsDocParams;
                }
              }

              const returnType = extractReturnType(fileContent, node.declaration);
              const lineCount = countMethodLines(fileContent, node.declaration);
              const methodCalls = extractMethodCalls(fileContent, node.declaration, definedMethods, imports);

              const prefix = isAsync ? 'export async function' : 'export function';
              const signature = formatSignature(prefix, name, params, returnType, false, lineCount);
              const description = includeJsDoc && commentMap[name] ? commentMap[name] : '';

              signatures.push({ signature, description, methodCalls, jsDocParams });
            }
          }
        },
        ExportDefaultDeclaration(node) {
          if (node.declaration.type === 'FunctionDeclaration') {
            const name = node.declaration.id ? node.declaration.id.name : 'default';
            const isAsync = node.declaration.async;
            let params = extractParams(node.declaration.params, fileContent, node.declaration);

            // Check if we have object destructuring from JSDoc
            const jsDocParams = extractJSDocParams(fileContent, node.declaration);
            if (jsDocParams) {
              // If it's a single parameter that's an object destructuring, replace it
              if (params.startsWith('{') || params === '') {
                params = jsDocParams;
              }
            }

            const returnType = extractReturnType(fileContent, node.declaration);
            const lineCount = countMethodLines(fileContent, node.declaration);
            const methodCalls = extractMethodCalls(fileContent, node.declaration, definedMethods, imports);

            const prefix = isAsync ? 'export default async function' : 'export default function';
            const signature = formatSignature(prefix, name, params, returnType, false, lineCount);
            const description = includeJsDoc && commentMap[name] ? commentMap[name] : '';

            signatures.push({ signature, description, methodCalls, jsDocParams });
          } else if (node.declaration.type === 'ArrowFunctionExpression') {
            const isAsync = node.declaration.async;
            let params = extractParams(node.declaration.params, fileContent, node.declaration);

            // Check if we have object destructuring from JSDoc
            const jsDocParams = extractJSDocParams(fileContent, node.declaration);
            if (jsDocParams) {
              // If it's a single parameter that's an object destructuring, replace it
              if (params.startsWith('{') || params === '') {
                params = jsDocParams;
              }
            }

            const returnType = extractReturnType(fileContent, node.declaration);
            const lineCount = countMethodLines(fileContent, node.declaration);
            const methodCalls = extractMethodCalls(fileContent, node.declaration, definedMethods, imports);

            const prefix = isAsync ? 'export default async' : 'export default';
            const signature = formatSignature(prefix, "", params, returnType, true, lineCount);
            signatures.push({ signature, description: '', methodCalls, jsDocParams });
          } else if (node.declaration.type === 'Identifier') {
            signatures.push({ signature: `export default ${node.declaration.name}`, description: '', methodCalls: [], jsDocParams: null });
          } else {
            signatures.push({ signature: `export default ${node.declaration.type}`, description: '', methodCalls: [], jsDocParams: null });
          }
        }
      });

      return { signatures, imports };
    } catch (parseError) {
      return {
        signatures: [{ signature: `[Unable to parse JavaScript: ${parseError.message}]`, description: '', methodCalls: [], jsDocParams: null }],
        imports: []
      };
    }
  } catch (error) {
    return {
      signatures: [{ signature: `[Error reading file: ${error.message}]`, description: '', methodCalls: [], jsDocParams: null }],
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
      if (p.type === 'ObjectPattern') {
        // Enhance to extract all properties from the object pattern
        if (p.properties && p.properties.length > 0) {
          const props = p.properties.map(prop => {
            if (prop.key && prop.key.name) {
              return prop.key.name;
            }
            return '?';
          });
          return `{${props.join(', ')}}`;
        }
        return '{...}';
      }
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
function formatSignature(prefix, name, params, returnType, isArrow = false, lineCount = 0, methodCalls = []) {
  // Base signature
  let signature;
  if (isArrow) {
    signature = `${prefix} ${name} = (${params}) => {...}${returnType ? ` : ${returnType}` : ''}`;
  } else {
    signature = `${prefix} ${name}(${params})${returnType ? `: ${returnType}` : ''}`;
  }

  // Add line count
  if (lineCount > 0) {
    signature += ` [${lineCount} lines]`;
  }

  return signature;
}

// Function to scan directories
function scanDirectory(dirPath, level = 0, relativePath = '', allFiles = []) {
  // Check if we've reached the maximum depth
  if (level > maxDepth) {
    return allFiles;
  }

  // Check if this directory path should be excluded
  if (level > 0 && shouldExcludePath(relativePath)) {
    return allFiles;
  }

  const items = fs.readdirSync(dirPath);

  // Get all files first
  const files = items
    .filter(item => {
      const itemPath = path.join(dirPath, item);
      return !fs.statSync(itemPath).isDirectory() && !shouldExcludeFile(itemPath);
    });

  // Add files to collection
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const fileRelativePath = path.join(relativePath, file);
    let lineCount = 0;
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      lineCount = fileContent.split('\n').length;
    } catch (error) {
      console.error(`Error counting lines in ${filePath}: ${error.message}`);
    }
    allFiles.push({ filePath, relativePath: fileRelativePath, lineCount });
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
    scanDirectory(nextDirPath, level + 1, nextRelativePath, allFiles);
  }

  return allFiles;
}

// Main execution
try {
  console.log(`Generating codebase structure...`);
  console.log(`Directory to scan: ${customRootDir}`);
  console.log(`Output file: ${outputFile}`);
  console.log(`Maximum depth: ${maxDepth === Infinity ? 'unlimited' : maxDepth}`);
  console.log(`Include JSDoc: ${includeJsDoc ? 'yes' : 'no'}`);
  if (EXCLUDE_PATHS.length > 0) {
    console.log(`Excluded paths: ${EXCLUDE_PATHS.join(', ')}`);
  }
  if (EXCLUDE_FILES.length > 0) {
    console.log(`Excluded files: ${EXCLUDE_FILES.join(', ')}`);
  }

  // Add header to content
  content = `# Files Sorted by Line Count\nGenerated: ${new Date().toISOString()}\n\n`;

  // Collect all files
  const allFiles = scanDirectory(customRootDir);

  // Sort all files by line count (descending)
  allFiles.sort((a, b) => b.lineCount - a.lineCount);

  // Process sorted files
  for (const { filePath, relativePath, lineCount } of allFiles) {
    const ext = path.extname(filePath);

    // Skip unsupported file types
    if (!INCLUDE_EXTENSIONS.includes(ext)) {
      continue;
    }

    content += `## ${relativePath} (${lineCount} lines)\n`;

    // Add detailed analysis for JS files
    if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
      // Extract method signatures and imports for JavaScript files
      let { signatures, imports } = extractMethodSignatures(filePath);

      // If no signatures were found, try the fallback method
      if (!signatures || signatures.length === 0 ||
          signatures.length === 1 && signatures[0].signature.startsWith('[Unable to parse')) {
        const fallbackSignatures = extractMethodsFromRawContent(fs.readFileSync(filePath, 'utf8'));
        if (fallbackSignatures) {
          signatures = fallbackSignatures;
        }
      }

      // Add imports if there are any
      if (imports.length > 0) {
        content += 'Imports:\n';
        imports.forEach(importStatement => {
          content += `- ${importStatement}\n`;
        });
        content += '\n';
      }

      // Add method signatures
      if (signatures.length > 0) {
        // De-duplicate functions that are both declared and exported
        const uniqueSignatures = [];
        const seenFunctions = new Set();

        // First pass: collect function names and identify duplicates
        for (const sig of signatures) {
          const funcNameMatch = sig.signature.match(/(?:function|export function) (\w+)/);
          if (funcNameMatch) {
            const funcName = funcNameMatch[1];

            // If we've seen this function before, skip it
            if (seenFunctions.has(funcName)) {
              continue;
            }

            seenFunctions.add(funcName);
            uniqueSignatures.push(sig);
          } else {
            // For non-function or other special cases, keep them
            uniqueSignatures.push(sig);
          }
        }

        content += 'Methods:\n';
        uniqueSignatures.forEach(({ signature, description, methodCalls, jsDocParams }) => {
          // Extract function name
          let functionName = '';
          const nameMatch = signature.match(/(?:function|async function|const|async const|export function|export default function|export default async function|method|async method|export default|export default async)\s+(\w+)/);

          if (nameMatch && nameMatch[1]) {
            functionName = nameMatch[1];
          } else if (signature.includes(' = (')) {
            // Handle arrow functions: "const name = (...) => {...}"
            const arrowNameMatch = signature.match(/(?:const|async const|export const|async export const)\s+(\w+)\s+=\s+\(/);
            if (arrowNameMatch && arrowNameMatch[1]) {
              functionName = arrowNameMatch[1];
            }
          }

          // Extract parameters, preferring JSDoc params if available
          let params = '';
          if (jsDocParams) {
            params = jsDocParams;
          } else {
            const paramsRegex = /\(([^)]*)\)/;
            const paramsMatch = signature.match(paramsRegex);

            if (paramsMatch && paramsMatch[1]) {
              // Regular parameters processing
              params = paramsMatch[1].split(',')
                .map(param => {
                  param = param.trim();

                  // Handle object destructuring patterns like {a, b, c}
                  if (param.startsWith('{') && param.includes('}')) {
                    // Extract the content inside the braces
                    const match = param.match(/{([^}]*)}/);
                    if (match && match[1]) {
                      // Process the destructured parameters inside the object
                      const innerParams = match[1].split(',')
                        .map(p => p.trim().split(/[\s=:]/)[0].trim())
                        .filter(p => p)
                        .join(', ');
                      return `{${innerParams}}`;
                    }
                    return '{...}'; // Fallback if parsing fails
                  }

                  // Handle array destructuring or empty params
                  if (param === '[...]' || param === '?' || param === '') {
                    return param;
                  }

                  // Handle rest parameters (...args)
                  if (param.startsWith('...')) {
                    return param.split(/[\s=:]/)[0];
                  }

                  // Standard parameter
                  return param.split(/[\s=:]/)[0];
                })
                .join(', ');
            }
          }

          // Extract line count
          const lineCountMatch = signature.match(/\[(\d+) lines\]/);
          const lineCount = lineCountMatch ? lineCountMatch[1] : '';

          // Format for display
          let displaySignature = '';

          // Always use single line format for parameters
          displaySignature = `\`${functionName}(${params})\``;

          // Add description and line count
          if (description) {
            displaySignature += ` ${description}`;
          } else if (lineCount) {
            displaySignature += ` No description`;
          }

          if (lineCount) {
            displaySignature += ` [${lineCount} lines]`;
          }

          // Output the line
          content += `- ${displaySignature}\n`;
        });
      } else {
        content += '(No methods found)\n';
      }
    } else if (ext === '.json') {
      try {
        // For JSON files, show file size in addition to line count
        const stats = fs.statSync(filePath);
        content += `(JSON file, ${(stats.size / 1024).toFixed(1)} KB)\n`;
      } catch (error) {
        content += `(Error reading JSON: ${error.message})\n`;
      }
    }

    content += '\n';
  }

  // Write output to file
  fs.writeFileSync(outputFile, content, 'utf8');
  console.log(`Structure written to ${outputFile}`);

  // Also output to console
  console.log('\n=== FILES SORTED BY LINE COUNT ===\n');
  console.log(content);
  console.log('=== END OF LIST ===');
} catch (error) {
  console.error('Error generating structure:', error);
  process.exit(1);
}

// Add a new function for more robust method extraction that can be used as a fallback
function extractMethodsFromRawContent(fileContent) {
  const methodSignatures = [];

  // Match normal methods
  const methodRegex = /(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*{/g;
  let match;

  while ((match = methodRegex.exec(fileContent)) !== null) {
    const [_, name, params] = match;
    methodSignatures.push({
      signature: `function ${name}(${params}) {}`,
      description: '',
      methodCalls: []
    });
  }

  // Match class method declarations
  const classMethodRegex = /class\s+(\w+)\s*{[^}]*(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*{/g;
  while ((match = classMethodRegex.exec(fileContent)) !== null) {
    const [_, className, methodName, params] = match;
    methodSignatures.push({
      signature: `method ${methodName}(${params}) {}`,
      description: '',
      methodCalls: []
    });
  }

  return methodSignatures.length > 0 ? methodSignatures : null;
}

// Function to extract JSDoc comments and parameters for a function
function extractJSDocParams(fileContent, node) {
  if (!node || !includeJsDoc) return null;

  try {
    // Find JSDoc comment that precedes the function
    const startPos = node.start;
    const precedingCode = fileContent.substring(0, startPos);
    const commentBlocks = precedingCode.match(/\/\*\*[\s\S]*?\*\//g) || [];

    if (commentBlocks.length === 0) return null;

    // Get the last comment block before the function
    const commentBlock = commentBlocks[commentBlocks.length - 1];

    // Check if this has object destructuring pattern with @param options.X format
    const optionsParams = [];
    // Updated regex to better match the JSDoc pattern in the example
    const optionsParamRegex = /@param\s+\{[^}]*\}\s+options\.(\w+)/g;
    let match;

    while ((match = optionsParamRegex.exec(commentBlock)) !== null) {
      optionsParams.push(match[1]);
    }

    if (optionsParams.length > 0) {
      return `{${optionsParams.join(', ')}}`;
    }

    return null;
  } catch (error) {
    return null;
  }
}
