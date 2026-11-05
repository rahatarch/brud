import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const UTILITY_ROOT = resolve(HERE, '..', 'utilities', 'import-resolver');

const FORBIDDEN_IMPORT_PREFIXES = ['node:fs', 'node:process'];
const FORBIDDEN_IMPORT_SPECIFIERS = ['@brud/core'];
const FORBIDDEN_CONTEXT_REFERENCES = [
  'context',
  'getFileSystem',
  'getSettings',
  'getTerminal',
  'getHistory',
  'executeTool',
  'registerTool',
];

interface ImportReference {
  readonly specifier: string;
  readonly line: number;
  readonly typeOnly: boolean;
}

function importDeclarationIsTypeOnly(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined) {
    return false;
  }

  if (clause.isTypeOnly) {
    return true;
  }

  return clause.namedBindings !== undefined
    && ts.isNamedImports(clause.namedBindings)
    && clause.namedBindings.elements.length > 0
    && clause.namedBindings.elements.every((element) => element.isTypeOnly);
}

function collectImportReferences(filePath: string, source: string): ImportReference[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const lineOf = (position: number): number =>
    sourceFile.getLineAndCharacterOfPosition(position).line + 1;
  const references: ImportReference[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      references.push({
        specifier: statement.moduleSpecifier.text,
        line: lineOf(statement.moduleSpecifier.getStart(sourceFile)),
        typeOnly: importDeclarationIsTypeOnly(statement),
      });
      continue;
    }

    if (
      ts.isExportDeclaration(statement)
      && statement.moduleSpecifier !== undefined
      && ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      references.push({
        specifier: statement.moduleSpecifier.text,
        line: lineOf(statement.moduleSpecifier.getStart(sourceFile)),
        typeOnly: statement.isTypeOnly,
      });
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';

      if ((isDynamicImport || isRequire) && node.arguments.length === 1) {
        const [argument] = node.arguments;
        if (argument !== undefined && ts.isStringLiteral(argument)) {
          references.push({
            specifier: argument.text,
            line: lineOf(argument.getStart(sourceFile)),
            typeOnly: false,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return references;
}

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(absolutePath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(absolutePath);
    }
  }

  return files.sort();
}

describe('brud.core.utils Zero Dependency invariant', () => {
  it('scans every import-resolver source file', async () => {
    const sourceFiles = await collectSourceFiles(UTILITY_ROOT);

    assert.deepEqual(
      sourceFiles.map((file) => relative(UTILITY_ROOT, file).replace(/\\/gu, '/')),
      ['errors.ts', 'index.ts', 'languagePatterns.ts'],
    );
  });

  it('imports no filesystem, process, core, kernel, or plugin dependency', async () => {
    const sourceFiles = await collectSourceFiles(UTILITY_ROOT);
    const violations: string[] = [];

    for (const file of sourceFiles) {
      const source = await readFile(file, 'utf8');

      for (const reference of collectImportReferences(file, source)) {
        const { specifier } = reference;
        const location = `${relative(UTILITY_ROOT, file).replace(/\\/gu, '/')}:${reference.line}`;

        if (FORBIDDEN_IMPORT_PREFIXES.some((prefix) => specifier.startsWith(prefix))) {
          violations.push(`${location} imports ${JSON.stringify(specifier)}`);
          continue;
        }

        if (FORBIDDEN_IMPORT_SPECIFIERS.includes(specifier)) {
          violations.push(`${location} imports ${JSON.stringify(specifier)}`);
          continue;
        }

        if (specifier === '@brud/kernel' && !reference.typeOnly) {
          violations.push(`${location} value-imports ${JSON.stringify(specifier)}`);
          continue;
        }

        if (specifier.startsWith('@brud/plugin-')) {
          violations.push(`${location} imports plugin ${JSON.stringify(specifier)}`);
        }
      }
    }

    assert.deepEqual(violations, [], 'utilities must stay pure and host-independent');
  });

  it('contains no reference to kernel context or Level-1 service capabilities', async () => {
    const sourceFiles = await collectSourceFiles(UTILITY_ROOT);
    const violations: string[] = [];

    for (const file of sourceFiles) {
      const source = await readFile(file, 'utf8');
      const displayFile = relative(UTILITY_ROOT, file).replace(/\\/gu, '/');

      for (const token of FORBIDDEN_CONTEXT_REFERENCES) {
        if (source.includes(token)) {
          violations.push(`${displayFile} references ${JSON.stringify(token)}`);
        }
      }
    }

    assert.deepEqual(violations, [], 'a utility must never receive a kernel context or service handle');
  });
});