import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as ts from 'typescript';

/**
 * The kernel core must not import a concrete service or plugin.
 *
 * This guard scans every non-test TypeScript source file under
 * `packages/kernel/src/` and fails if any static or dynamic import resolves
 * under `packages/kernel/services/` or `packages/plugins/`.
 *
 * Test files are excluded on purpose: they are the harness that exercises the
 * whole kernel, not part of the shipped core. The core rule is about the
 * production graph the kernel boots.
 */

const SOURCE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const KERNEL_ROOT = resolve(SOURCE_ROOT, '..');
const SERVICE_ROOT = join(KERNEL_ROOT, 'services');
const PLUGINS_ROOT = resolve(KERNEL_ROOT, '..', 'plugins');

const SKIPPED_DIRECTORIES = new Set(['__tests__', 'node_modules', 'dist']);

const IMPORT_PATTERNS: readonly RegExp[] = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /^\s*import\s+['"]([^'"]+)['"]/gm,
];

/** Normalizes a resolved path for containment checks. */
function normalize(pathValue: string): string {
  return resolve(pathValue);
}

/** Reports whether `candidate` is equal to or inside `root`. */
function isInside(candidate: string, root: string): boolean {
  const normalized = normalize(candidate);
  const normalizedRoot = normalize(root);

  return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}${sep}`);
}

/** Extracts every module specifier referenced by a source file. */
export function importSpecifiers(contents: string): readonly string[] {
  const found = new Set<string>();

  for (const pattern of IMPORT_PATTERNS) {
    const matcher = new RegExp(pattern.source, pattern.flags);

    for (const match of contents.matchAll(matcher)) {
      const specifier = match[1];

      if (specifier !== undefined) {
        found.add(specifier);
      }
    }
  }

  return [...found];
}

/**
 * Returns the offending specifier when `file` imports from a concrete service
 * or plugin, otherwise `undefined`.
 */
export function forbiddenImport(file: string, specifier: string): string | undefined {
  if (specifier.startsWith('.')) {
    const resolved = resolve(dirname(file), specifier);

    if (isInside(resolved, SERVICE_ROOT) || isInside(resolved, PLUGINS_ROOT)) {
      return specifier;
    }
  }

  const normalized = specifier.replace(/\\/g, '/');

  if (
    normalized.startsWith('packages/kernel/services/')
    || normalized.startsWith('packages/plugins/')
    || normalized.includes('/packages/kernel/services/')
    || normalized.includes('/packages/plugins/')
  ) {
    return specifier;
  }

  return undefined;
}

/**
 * Returns the named property signatures declared by an interface.
 *
 * Index signatures are deliberately ignored: the generic options bag is an
 * open index signature, which is allowed. Named service-specific properties
 * are not.
 */
export function interfacePropertyNames(
  source: string,
  interfaceName: string,
): readonly string[] {
  const file = ts.createSourceFile(
    'purity.ts',
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const names: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      for (const member of node.members) {
        if (ts.isPropertySignature(member)) {
          if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) {
            names.push(member.name.text);
          }
        }
      }

      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(file);

  return names;
}

/** Returns the method signatures declared by an interface. */
export function interfaceMethodNames(
  source: string,
  interfaceName: string,
): readonly string[] {
  const file = ts.createSourceFile(
    'purity.ts',
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const names: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      for (const member of node.members) {
        if (ts.isMethodSignature(member)) {
          if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) {
            names.push(member.name.text);
          }
        }
      }

      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(file);

  return names;
}

/** Property names that leak a service concept into a core boot boundary. */
const FORBIDDEN_CORE_PROPERTIES = [
  'workspaceRoot',
  'projectRoot',
  'storageDriver',
  'mutationJournal',
  'plugins',
  'initialPlugins',
  'certifyPlugins',
] as const;

/** Recursively collects production `.ts` files under the core source root. */
async function collectSourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...await collectSourceFiles(join(directory, entry.name)));
      }

      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(join(directory, entry.name));
    }
  }

  return files;
}

/** Scans the core and returns human-readable violations. */
export async function findKernelCoreViolations(): Promise<readonly string[]> {
  const files = await collectSourceFiles(SOURCE_ROOT);
  const violations: string[] = [];

  for (const file of files) {
    const contents = await readFile(file, 'utf8');

    for (const specifier of importSpecifiers(contents)) {
      const offending = forbiddenImport(file, specifier);

      if (offending !== undefined) {
        violations.push(`${relative(KERNEL_ROOT, file)} imports "${offending}"`);
      }
    }
  }

  return violations;
}

describe('kernel core purity', () => {
  it('has no import from a concrete service or plugin', async () => {
    const violations = await findKernelCoreViolations();

    assert.deepEqual(
      violations,
      [],
      `Kernel core must not import from services/ or plugins/:\n${violations.join('\n')}`,
    );
  });

  it('detects a relative service import (guard canary)', () => {
    const file = join(SOURCE_ROOT, 'Canary.ts');

    assert.equal(
      forbiddenImport(file, '../services/Router/serviceModule.js'),
      '../services/Router/serviceModule.js',
    );
    assert.equal(
      forbiddenImport(file, '../../plugins/Catalog/src/plugin.js'),
      '../../plugins/Catalog/src/plugin.js',
    );
    assert.equal(forbiddenImport(file, './contracts/lifecycle.js'), undefined);
  });

  it('keeps core boot options and the service module context generic', async () => {
    const bootTypes = await readFile(join(SOURCE_ROOT, 'bootstrap', 'bootTypes.ts'), 'utf8');
    const standardKernel = await readFile(
      join(SOURCE_ROOT, 'bootstrap', 'createStandardKernel.ts'),
      'utf8',
    );
    const kernelContract = await readFile(
      join(SOURCE_ROOT, 'contracts', 'kernel.ts'),
      'utf8',
    );

    assert.deepEqual(
      [...interfacePropertyNames(bootTypes, 'BootKernelOptions')].sort(),
      ['logger', 'options'],
      'BootKernelOptions must contain only the generic options bag and a logger',
    );
    assert.deepEqual(
      [...interfacePropertyNames(bootTypes, 'ComposeKernelOptions')].sort(),
      ['logger', 'options'],
      'ComposeKernelOptions must contain only the generic options bag and a logger',
    );
    assert.deepEqual(
      [...interfacePropertyNames(kernelContract, 'KernelBootOptions')].sort(),
      ['logger', 'options'],
      'KernelBootOptions must contain only the generic options bag and a logger',
    );
    assert.deepEqual(
      [...interfacePropertyNames(standardKernel, 'CreateStandardKernelOptions')].sort(),
      [],
      'CreateStandardKernelOptions must not name service or plugin concepts',
    );
    assert.deepEqual(
      [...interfacePropertyNames(bootTypes, 'KernelServiceModuleContext')].sort(),
      ['logger', 'options', 'shared'],
      'KernelServiceModuleContext must contain only options, logger, and shared',
    );
    assert.deepEqual(
      [...interfaceMethodNames(bootTypes, 'ServiceModule')].sort(),
      ['createService', 'pinBootPolicies', 'registerBootRegistrants'],
      'ServiceModule must expose only generic composition hooks',
    );

    const leaked: string[] = [];

    for (const source of [bootTypes, standardKernel, kernelContract]) {
      for (const interfaceName of [
        'BootKernelOptions',
        'ComposeKernelOptions',
        'CreateStandardKernelOptions',
        'KernelBootOptions',
        'KernelServiceModuleContext',
      ]) {
        for (const property of interfacePropertyNames(source, interfaceName)) {
          if ((FORBIDDEN_CORE_PROPERTIES as readonly string[]).includes(property)) {
            leaked.push(`${interfaceName}.${property}`);
          }
        }
      }
    }

    assert.deepEqual(leaked, [], `Core boundaries name service concepts:\n${leaked.join('\n')}`);
  });

  it('keeps runtime contexts generic: no service vocabulary, only the options bag', async () => {
    const lifecycle = await readFile(join(SOURCE_ROOT, 'contracts', 'lifecycle.ts'), 'utf8');
    const context = await readFile(join(SOURCE_ROOT, 'contracts', 'context.ts'), 'utf8');

    assert.deepEqual(
      [...interfacePropertyNames(lifecycle, 'ServiceContext')].sort(),
      ['callerId', 'logger', 'options', 'partitionPrefix', 'tier'],
      'ServiceContext must carry only caller identity, a logger, a partition, and the generic options bag',
    );
    assert.deepEqual(
      [...interfacePropertyNames(context, 'ExecutionContext')].sort(),
      ['callDepth', 'metadata', 'options', 'sessionId', 'signal'],
      'ExecutionContext must carry only generic execution state and the generic options bag',
    );

    const leaked: string[] = [];

    for (const [source, interfaceName] of [
      [lifecycle, 'ServiceContext'],
      [context, 'ExecutionContext'],
    ] as const) {
      for (const property of interfacePropertyNames(source, interfaceName)) {
        if ((FORBIDDEN_CORE_PROPERTIES as readonly string[]).includes(property)) {
          leaked.push(`${interfaceName}.${property}`);
        }
      }
    }

    assert.deepEqual(leaked, [], `Runtime contexts name service concepts:\n${leaked.join('\n')}`);

    const allowedBags = new Set(['options']);
    const bags = [
      ...interfacePropertyNames(lifecycle, 'ServiceContext'),
      ...interfacePropertyNames(context, 'ExecutionContext'),
    ].filter((property) => property === 'options' || property.endsWith('Bag') || property.endsWith('Options'));

    assert.deepEqual(
      bags.filter((property) => !allowedBags.has(property)),
      [],
      'The only generic bag allowed on a runtime context is `options`',
    );
  });

  it('detects service-specific runtime context properties in a canary interface', () => {
    const source = `
      interface ExecutionContext {
        sessionId: string;
        workspaceRoot: string;
        projectRoot?: string;
        storageDriver?: unknown;
        mutationJournal?: unknown;
        options: Record<string, unknown>;
      }
    `;

    assert.deepEqual(
      [...interfacePropertyNames(source, 'ExecutionContext')].sort(),
      [
        'mutationJournal',
        'options',
        'projectRoot',
        'sessionId',
        'storageDriver',
        'workspaceRoot',
      ],
    );
  });

  it('detects service-specific properties in a canary interface', () => {
    const source = `
      interface BootKernelOptions {
        workspaceRoot: string;
        storageDriver?: unknown;
        options: Record<string, unknown>;
        logger?: unknown;
      }
    `;

    assert.deepEqual(
      [...interfacePropertyNames(source, 'BootKernelOptions')].sort(),
      ['logger', 'options', 'storageDriver', 'workspaceRoot'],
    );
  });

  it('detects service-specific composition hooks in a canary interface', () => {
    const source = `
      interface ServiceModule {
        createService(context: unknown): unknown;
        createStorageDriver(): unknown;
        createMutationJournal(): unknown;
        certifyPlugin(plugin: object): object;
      }
    `;

    assert.deepEqual(
      [...interfaceMethodNames(source, 'ServiceModule')].sort(),
      ['certifyPlugin', 'createMutationJournal', 'createService', 'createStorageDriver'],
    );
  });

  it('extracts static, dynamic and side-effect imports', () => {
    const contents = [
      "import type { A } from '../services/A/index.js';",
      "export { B } from '../../plugins/B/src/plugin.js';",
      "const mod = await import('../services/C/index.js');",
      "import '../services/D/side-effect.js';",
      "import { local } from './local.js';",
    ].join('\n');

    assert.deepEqual([...importSpecifiers(contents)].sort(), [
      '../services/A/index.js',
      '../../plugins/B/src/plugin.js',
      '../services/C/index.js',
      '../services/D/side-effect.js',
      './local.js',
    ].sort());
  });
});