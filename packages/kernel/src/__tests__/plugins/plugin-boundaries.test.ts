import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGINS_ROOT = resolve(HERE, '../../../../plugins');

const PLUGIN_PACKAGES = ['ImportResolver', 'UserPrompts', 'Structure', 'Search'] as const;

const FORBIDDEN_SPECIFIERS = new Set([
  'node:fs',
  '@brud/core',
  '@brud/mcp',
  '@brud/vscode-adapter',
  '@brud/daemon',
]);

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

function escapesPluginPackage(pluginRoot: string, filePath: string, specifier: string): boolean {
  const resolved = resolve(dirname(filePath), specifier);
  const relativePath = relative(pluginRoot, resolved);

  return relativePath === '..'
    || relativePath.startsWith(`..${sep}`)
    || isAbsolute(relativePath);
}

describe('plugin boundaries invariant', () => {
  it('keeps every leaf plugin source file inside its own package boundary', async () => {
    const violations: string[] = [];
    let scannedFiles = 0;

    for (const packageName of PLUGIN_PACKAGES) {
      const pluginRoot = join(PLUGINS_ROOT, packageName);
      const sourceRoot = join(pluginRoot, 'src');
      const sourceFiles = await collectSourceFiles(sourceRoot);

      assert.ok(sourceFiles.length > 0, `${packageName} must contain TypeScript sources to scan`);
      assert.ok(
        sourceFiles.some((file) => file.endsWith(`${sep}index.ts`)),
        `${packageName} must have a src/index.ts entry point`,
      );

      for (const file of sourceFiles) {
        scannedFiles++;
        const displayFile = relative(PLUGINS_ROOT, file).replace(/\\/gu, '/');
        const source = await readFile(file, 'utf8');

        for (const reference of collectImportReferences(file, source)) {
          const { specifier, line, typeOnly } = reference;
          const location = `${displayFile}:${line}`;

          if (specifier.startsWith('.')) {
            if (escapesPluginPackage(pluginRoot, file, specifier)) {
              violations.push(
                `${location} relative import ${JSON.stringify(specifier)} escapes ${packageName}`,
              );
            }
            continue;
          }

          if (FORBIDDEN_SPECIFIERS.has(specifier)) {
            violations.push(`${location} imports forbidden module ${JSON.stringify(specifier)}`);
            continue;
          }

          if (specifier === '@brud/kernel') {
            if (!typeOnly) {
              violations.push(`${location} value-imports @brud/kernel; only type imports are allowed`);
            }
            continue;
          }

          if (specifier.startsWith('node:')) {
            continue;
          }

          violations.push(`${location} imports external module ${JSON.stringify(specifier)}`);
        }
      }
    }

    assert.ok(scannedFiles >= PLUGIN_PACKAGES.length, 'every plugin package must be scanned');
    assert.deepEqual(violations, [], 'leaf plugins must not leak across architectural boundaries');
  });
});