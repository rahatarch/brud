import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGINS_ROOT = resolve(HERE, '../../../../plugins');
const IMPORT_RESOLVER_ROOT = join(PLUGINS_ROOT, 'ImportResolver');
const IMPORT_RESOLVER_SRC = join(IMPORT_RESOLVER_ROOT, 'src');

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

describe('ImportResolver purity invariant', () => {
  it('imports no host, process, core, or kernel runtime dependency', async () => {
    const sourceFiles = await collectSourceFiles(IMPORT_RESOLVER_SRC);

    assert.deepEqual(
      sourceFiles.map((file) => relative(IMPORT_RESOLVER_ROOT, file).replace(/\\/gu, '/')),
      ['src/errors.ts', 'src/index.ts', 'src/languagePatterns.ts'],
      'the invariant must scan every ImportResolver source file',
    );

    const forbidden = new Set(['node:fs', 'node:process', '@brud/core', '@brud/kernel']);
    const violations: string[] = [];

    for (const file of sourceFiles) {
      const source = await readFile(file, 'utf8');

      for (const reference of collectImportReferences(file, source)) {
        if (!forbidden.has(reference.specifier)) {
          continue;
        }

        if (reference.specifier === '@brud/kernel' && reference.typeOnly) {
          continue;
        }

        violations.push(
          `${relative(IMPORT_RESOLVER_ROOT, file).replace(/\\/gu, '/')}:${reference.line} `
          + `imports ${JSON.stringify(reference.specifier)}`,
        );
      }
    }

    assert.deepEqual(violations, [], 'ImportResolver must stay a pure, host-independent SDK');
  });

  it('resolves real local imports without touching the filesystem itself', async () => {
    const entry = pathToFileURL(join(IMPORT_RESOLVER_SRC, 'index.ts')).href;
    const module = await import(entry) as {
      resolveImports(
        content: string,
        filePath: string,
        fileExists: (path: string) => Promise<boolean>,
      ): Promise<string[]>;
    };

    const virtualRoot = resolve('/virtual/import-resolver-fixture');
    const sourceDirectory = join(virtualRoot, 'src');
    const filePath = join(sourceDirectory, 'a.ts');

    const existingFiles = new Set([
      join(sourceDirectory, 'b.ts'),
      join(sourceDirectory, 'c', 'index.ts'),
      join(sourceDirectory, 'd.ts'),
    ]);

    const content = [
      "import { helper } from './b';",
      "import { index } from './c';",
      "import type { Shape } from './types';",
      "import React from 'react';",
      "const mod = await import('./d');",
    ].join('\n');

    const resolved = await module.resolveImports(
      content,
      filePath,
      async (candidate) => existingFiles.has(candidate),
    );

    assert.deepEqual(resolved, [
      join(sourceDirectory, 'b.ts'),
      join(sourceDirectory, 'c', 'index.ts'),
      join(sourceDirectory, 'd.ts'),
    ]);
  });
});