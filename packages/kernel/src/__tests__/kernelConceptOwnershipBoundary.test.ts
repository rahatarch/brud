import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as ts from 'typescript';

/**
 * Boundary checks for the ownership moves of cleanup Step 3.
 *
 * BC-1: the kernel's export surface and source carry no plugin-handoff,
 * partition, or storage-driver concept. The storage driver contract and its
 * implementation live with the storage service.
 *
 * BC-2: no kernel boot type names an option owned by a specific service.
 *
 * Both checks are static because the property they lock is a shape, not a
 * runtime result. They are proven against a deliberately reintroduced
 * violation in the execution ledger.
 */

const KERNEL_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BOOT_TYPES = join(KERNEL_ROOT, 'src', 'bootstrap', 'bootTypes.ts');
const KERNEL_CONTRACT = join(KERNEL_ROOT, 'src', 'contracts', 'kernel.ts');
const STANDARD_KERNEL = join(KERNEL_ROOT, 'src', 'bootstrap', 'createStandardKernel.ts');
const BOOT_LOADER = join(KERNEL_ROOT, 'src', 'bootstrap', 'bootKernelInternal.ts');

const BANNED_EXPORT_NAMES: readonly string[] = [
  'KernelPlugin',
  'PUBLIC_API_CAPABILITY',
  'isPublicApiCapability',
  'IStorageDriver',
  'NodeStorageDriver',
  'FileStats',
  'DirectoryEntry',
  'PathEntryStats',
];

const BANNED_SOURCE_IDENTIFIERS: readonly string[] = [
  'KernelPlugin',
  'PUBLIC_API_CAPABILITY',
  'isPublicApiCapability',
  'partitionPrefix',
  'IStorageDriver',
  'NodeStorageDriver',
  'FileStats',
  'DirectoryEntry',
  'PathEntryStats',
];

/** Bare options-bag keys the kernel must not define. */
const BANNED_BAG_KEYS: readonly string[] = [
  'plugins',
  'certifyPlugins',
  'officialPlugins',
];

const SKIPPED_DIRECTORIES = new Set(['__tests__', 'node_modules', 'dist']);

/** Collects non-test kernel `.ts` files. */
async function kernelSourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...await kernelSourceFiles(join(directory, entry.name)));
      }

      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(join(directory, entry.name));
    }
  }

  return files;
}

/** Returns every banned identifier or bare bag key present in a source string. */
export function conceptViolations(source: string): readonly string[] {
  const found: string[] = [];

  for (const name of BANNED_SOURCE_IDENTIFIERS) {
    if (new RegExp(`\\b${name}\\b`, 'u').test(source)) {
      found.push(name);
    }
  }

  for (const key of BANNED_BAG_KEYS) {
    const quoted = new RegExp(`['"]${key}['"]`, 'u');
    const property = new RegExp(`(?<![\\w.])${key}\\s*:`, 'u');

    if (quoted.test(source) || property.test(source)) {
      found.push(`bagKey:${key}`);
    }
  }

  return found;
}

/** Returns every exported declaration name in a source file. */
export function exportedDeclarationNames(source: string): readonly string[] {
  const file = ts.createSourceFile(
    'exports.ts',
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const names: string[] = [];

  const addName = (name: ts.DeclarationName | undefined): void => {
    if (name === undefined) {
      return;
    }

    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
      names.push(name.text);
    }
  };

  for (const statement of file.statements) {
    const exported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ) ?? false;

    if (!exported) {
      continue;
    }

    if (
      ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isClassDeclaration(statement)
      || ts.isFunctionDeclaration(statement)
      || ts.isEnumDeclaration(statement)
    ) {
      addName(statement.name);
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        addName(declaration.name);
      }
    }
  }

  return names;
}

/** Property names declared by one interface. */
export function interfaceMemberNames(source: string, interfaceName: string): readonly string[] {
  const file = ts.createSourceFile(
    'members.ts',
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const names: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      for (const member of node.members) {
        if (
          ts.isPropertySignature(member)
          && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))
        ) {
          names.push(member.name.text);
        }
      }

      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(file);

  return names;
}

/** Service option names no kernel boot type may declare. */
const SERVICE_OPTION_NAMES: readonly string[] = [
  'workspaceRoot',
  'projectRoot',
  'partitionPrefix',
  'storageDriver',
  'mutationJournal',
  'plugins',
  'initialPlugins',
  'certifyPlugins',
  'officialPlugins',
  'history',
  'settings',
  'filesystem',
  'terminal',
  'router',
  'pluginManager',
  'identity',
  'exposedApi',
  'validation',
  'brandRegistry',
  'universalHistory',
];

/** Returns service option names declared by the boot-type interfaces. */
export function serviceOptionMembers(
  sources: readonly { readonly label: string; readonly source: string; readonly interfaces: readonly string[] }[],
): readonly string[] {
  const violations: string[] = [];

  for (const { label, source, interfaces } of sources) {
    for (const interfaceName of interfaces) {
      for (const member of interfaceMemberNames(source, interfaceName)) {
        if (SERVICE_OPTION_NAMES.includes(member)) {
          violations.push(`${label}:${interfaceName}.${member}`);
        }
      }
    }
  }

  return violations;
}

describe('BC-1: no plugin, partition, or storage-driver concept in the kernel', () => {
  it('exports none of the moved concepts from the real package root', async () => {
    const kernelModule = await import('../../index.js') as Record<string, unknown>;

    for (const name of BANNED_EXPORT_NAMES) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(kernelModule, name),
        false,
        `the kernel package must not export ${name}`,
      );
    }
  });

  it('references none of the moved concepts in kernel source', async () => {
    const files = await kernelSourceFiles(join(KERNEL_ROOT, 'src'));
    const serviceFiles = await kernelSourceFiles(join(KERNEL_ROOT, 'services'));
    const all = [...files, ...serviceFiles];
    const violations: string[] = [];

    for (const file of all) {
      const source = await readFile(file, 'utf8');

      for (const violation of conceptViolations(source)) {
        violations.push(`${relative(KERNEL_ROOT, file)}: ${violation}`);
      }
    }

    assert.deepEqual(violations, []);
  });

  it('exports no declaration named after a moved concept', async () => {
    const files = [
      ...await kernelSourceFiles(join(KERNEL_ROOT, 'src')),
      ...await kernelSourceFiles(join(KERNEL_ROOT, 'services')),
    ];
    const violations: string[] = [];

    for (const file of files) {
      const names = exportedDeclarationNames(await readFile(file, 'utf8'));

      for (const name of names) {
        if (BANNED_EXPORT_NAMES.includes(name)) {
          violations.push(`${relative(KERNEL_ROOT, file)}: ${name}`);
        }
      }
    }

    assert.deepEqual(violations, []);
  });

  it('detects a reintroduced concept and a bare plugin bag key (guard canary)', () => {
    assert.deepEqual(
      conceptViolations(
        'export type KernelPlugin = object;\n'
        + "const scoped = (caller) => caller.partitionPrefix;\n"
        + "const bag = { plugins: [] };\n",
      ),
      ['KernelPlugin', 'partitionPrefix', 'bagKey:plugins'],
    );
    assert.deepEqual(
      conceptViolations("const options = { 'pluginManager.plugins': entries };"),
      [],
    );
  });
});

describe('BC-2: no service-specific option name in a kernel boot type', () => {
  it('declares only the generic fields on every boot boundary', async () => {
    const bootTypes = await readFile(BOOT_TYPES, 'utf8');
    const kernelContract = await readFile(KERNEL_CONTRACT, 'utf8');
    const standardKernel = await readFile(STANDARD_KERNEL, 'utf8');

    assert.deepEqual(
      [...interfaceMemberNames(bootTypes, 'BootKernelOptions')].sort(),
      ['logger', 'options'],
    );
    assert.deepEqual(
      [...interfaceMemberNames(bootTypes, 'ComposeKernelOptions')].sort(),
      ['logger', 'options'],
    );
    assert.deepEqual(
      [...interfaceMemberNames(bootTypes, 'KernelServiceModuleContext')].sort(),
      ['logger', 'options', 'shared'],
    );
    assert.deepEqual(
      [...interfaceMemberNames(kernelContract, 'KernelBootOptions')].sort(),
      ['logger', 'options'],
    );
    assert.deepEqual(
      [...interfaceMemberNames(standardKernel, 'CreateStandardKernelOptions')].sort(),
      [],
    );

    assert.deepEqual(serviceOptionMembers([
      {
        label: 'bootTypes.ts',
        source: bootTypes,
        interfaces: ['BootKernelOptions', 'ComposeKernelOptions', 'KernelServiceModuleContext'],
      },
      {
        label: 'kernel.ts',
        source: kernelContract,
        interfaces: ['KernelBootOptions'],
      },
      {
        label: 'createStandardKernel.ts',
        source: standardKernel,
        interfaces: ['CreateStandardKernelOptions'],
      },
    ]), []);
  });

  it('keeps the boot loader free of plugin handoff keys and the plugin type', async () => {
    const loader = await readFile(BOOT_LOADER, 'utf8');
    const bootTypes = await readFile(BOOT_TYPES, 'utf8');

    assert.deepEqual(conceptViolations(loader), []);
    assert.doesNotMatch(loader, /KernelPlugin/u);
    assert.doesNotMatch(bootTypes, /KernelPlugin/u);
  });

  it('detects a service option reintroduced into a boot type (guard canary)', () => {
    const source = `
      interface BootKernelOptions {
        options?: Record<string, unknown>;
        logger?: unknown;
        plugins?: readonly unknown[];
        storageDriver?: unknown;
      }
    `;

    assert.deepEqual(
      serviceOptionMembers([
        { label: 'canary.ts', source, interfaces: ['BootKernelOptions'] },
      ]),
      ['canary.ts:BootKernelOptions.plugins', 'canary.ts:BootKernelOptions.storageDriver'],
    );
  });
});