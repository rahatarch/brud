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

const PLUGIN_MANAGER_KEYS = new Set([
  'pluginManager.plugins',
  'pluginManager.certifyPlugins',
  'pluginManager.configPath',
]);

const PLUGIN_MANAGER_IDENTIFIERS = new Set([
  'initialPlugins',
  'certifyInitialPlugins',
]);

const PARTICIPANT_TERMS: readonly string[] = [
  'plugin',
  'plugins',
  'plugin manager',
  'pluginManager',
  'parser',
  'router',
  'brud.core.tools',
  'brud.core.actions',
  'filesystem service',
  'history service',
  'terminal service',
  'settings service',
  'workspace service',
  'validation service',
  'utility service',
  'tools service',
  'actions service',
  'action manager',
  'brand registry',
  'universal history',
  'universalHistory',
  'settings reader',
  'settingsReader',
];

const NAMED_SERVICE_VALUES = new Set([
  'filesystem',
  'universalHistory',
  'history',
  'tools',
  'actions',
  'utilities',
  'terminal',
  'settings',
  'settingsReader',
  'validation',
  'workspace',
  'pluginManager',
]);

const KERNEL_SHAPE_VERBS = [
  'carries', 'carry', 'contains', 'contain', 'owns', 'own', 'includes',
  'include', 'ships', 'hosts', 'manages', 'declares', 'declared', 'activates',
  'activated', 'shaped', 'loads', 'load', 'resolves', 'built', 'composed',
] as const;

const HISTORY_MARKER = /\b(?:used to|previously|formerly|historically)\b/iu;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

const PARTICIPANT_PATTERN = PARTICIPANT_TERMS
  .map((term) => escapeRegExp(term))
  .join('|');

const VERB_PATTERN = KERNEL_SHAPE_VERBS.join('|');

const PASSIVE_PARTICIPANT_SHAPE = new RegExp(
  `\\b(?:${KERNEL_SHAPE_VERBS.join('|')})\\s+by\\s+(?:a|an|the)?\\s*(?:${PARTICIPANT_PATTERN})\\b`,
  'iu',
);

const ACTIVE_PARTICIPANT_SHAPE = new RegExp(
  `\\b(?:${PARTICIPANT_PATTERN})\\b[^.]{0,100}\\b(?:${VERB_PATTERN})\\b`,
  'iu',
);

const KERNEL_PARTICIPANT_SHAPE = new RegExp(
  `\\b(?:kernel|core|boot)\\b[^.]{0,100}\\b(?:${VERB_PATTERN})\\b[^.]{0,100}\\b(?:${PARTICIPANT_PATTERN})\\b`,
  'iu',
);

/** Returns plugin-manager key literals and identifiers in non-comment code. */
export function pluginManagerKeyViolations(source: string): readonly string[] {
  const file = ts.createSourceFile(
    'source.ts',
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const found = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node)
      || ts.isNoSubstitutionTemplateLiteral(node)
    ) {
      if (PLUGIN_MANAGER_KEYS.has(node.text) || node.text.startsWith('pluginManager.')) {
        found.add(`key:${node.text}`);
      }
    }

    if (ts.isTemplateExpression(node) && node.head.text.startsWith('pluginManager.')) {
      found.add(`key:${node.head.text}`);
    }

    if (ts.isIdentifier(node) && PLUGIN_MANAGER_IDENTIFIERS.has(node.text)) {
      found.add(`identifier:${node.text}`);
    }

    ts.forEachChild(node, visit);
  };

  visit(file);

  return [...found].sort();
}

/** Returns every comment in a source file, in source order. */
export function commentsInSource(source: string): readonly string[] {
  const file = ts.createSourceFile(
    'comments.ts',
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const ranges = new Map<string, { readonly pos: number; readonly end: number }>();

  const add = (comments: readonly ts.CommentRange[] | undefined): void => {
    for (const comment of comments ?? []) {
      if (
        comment.kind === ts.SyntaxKind.SingleLineCommentTrivia
        || comment.kind === ts.SyntaxKind.MultiLineCommentTrivia
      ) {
        ranges.set(`${String(comment.pos)}:${String(comment.end)}`, {
          pos: comment.pos,
          end: comment.end,
        });
      }
    }
  };

  const visit = (node: ts.Node): void => {
    add(ts.getLeadingCommentRanges(source, node.getFullStart()));
    add(ts.getTrailingCommentRanges(source, node.getEnd()));
    ts.forEachChild(node, visit);
  };

  visit(file);
  add(ts.getLeadingCommentRanges(source, file.endOfFileToken.getFullStart()));
  add(ts.getTrailingCommentRanges(source, file.endOfFileToken.getEnd()));

  return [...ranges.values()]
    .sort((left, right) => left.pos - right.pos)
    .map((range) => source.slice(range.pos, range.end));
}

/** Reports a comment that describes the kernel's present shape in participant terms. */
export function participantShapingComment(comment: string): boolean {
  const text = comment.replace(/\s+/gu, ' ').trim();

  if (text.length === 0 || HISTORY_MARKER.test(text)) {
    return false;
  }

  const hasParticipant = PARTICIPANT_TERMS.some(
    (term) => text.toLowerCase().includes(term.toLowerCase()),
  );

  if (!hasParticipant) {
    return false;
  }

  return PASSIVE_PARTICIPANT_SHAPE.test(text)
    || ACTIVE_PARTICIPANT_SHAPE.test(text)
    || KERNEL_PARTICIPANT_SHAPE.test(text);
}

/** Returns participant-shaped comments in one non-test kernel source file. */
export function participantShapingCommentViolations(source: string): readonly string[] {
  return commentsInSource(source)
    .filter(participantShapingComment)
    .map((comment) => comment.replace(/\s+/gu, ' ').trim());
}

interface ExportedDeclaration {
  readonly file: string;
  readonly name: string;
  readonly comment: string;
  readonly members: readonly { readonly name: string; readonly comment: string }[];
  readonly stringValues: readonly string[];
}

/** Collects exported declarations together with their own and member comments. */
export function exportedDeclarationsWithComments(
  filePath: string,
  source: string,
): readonly ExportedDeclaration[] {
  const file = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const declarations: ExportedDeclaration[] = [];

  const leadingComment = (node: ts.Node): string => {
    const ranges = ts.getLeadingCommentRanges(source, node.getFullStart()) ?? [];

    return ranges
      .map((range) => source.slice(range.pos, range.end))
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim();
  };

  const stringValues = (node: ts.Node): readonly string[] => {
    const values: string[] = [];
    const visit = (child: ts.Node): void => {
      if (ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)) {
        values.push(child.text);
      }

      ts.forEachChild(child, visit);
    };
    visit(node);

    return values;
  };

  for (const statement of file.statements) {
    const exported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ) ?? false;

    if (!exported) {
      continue;
    }

    const comment = leadingComment(statement);

    if (
      ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isClassDeclaration(statement)
      || ts.isFunctionDeclaration(statement)
      || ts.isEnumDeclaration(statement)
    ) {
      const members: { readonly name: string; readonly comment: string }[] = [];

      if (ts.isInterfaceDeclaration(statement)) {
        for (const member of statement.members) {
          const memberComment = leadingComment(member);

          if (memberComment.length > 0) {
            members.push({
              name: member.name?.getText(file) ?? '?',
              comment: memberComment,
            });
          }
        }
      }

      declarations.push({
        file: filePath,
        name: statement.name?.text ?? '?',
        comment,
        members,
        stringValues: [],
      });
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        declarations.push({
          file: filePath,
          name: declaration.name.getText(file),
          comment,
          members: [],
          stringValues: stringValues(declaration.initializer),
        });
      }
    }
  }

  return declarations;
}

/** Returns participant-shaped findings for declarations the kernel root exports. */
export function participantShapedExportFindings(
  declarations: readonly ExportedDeclaration[],
  rootExportNames: ReadonlySet<string>,
): readonly string[] {
  const findings = new Set<string>();

  for (const declaration of declarations) {
    if (!rootExportNames.has(declaration.name)) {
      continue;
    }

    if (PARTICIPANT_TERMS.some(
      (term) => declaration.name.toLowerCase().includes(term.toLowerCase()),
    )) {
      findings.add(`${declaration.file}:${declaration.name}: name`);
    }

    if (participantShapingText(declaration.comment)) {
      findings.add(`${declaration.file}:${declaration.name}: comment`);
    }

    for (const member of declaration.members) {
      if (participantShapingText(member.comment)) {
        findings.add(`${declaration.file}:${declaration.name}.${member.name}: comment`);
      }
    }

    for (const value of declaration.stringValues) {
      if (NAMED_SERVICE_VALUES.has(value)) {
        findings.add(`${declaration.file}:${declaration.name}: value:${value}`);
      }
    }
  }

  return [...findings].sort();
}

/** Returns whether text names a specific participant, regardless of grammar. */
export function participantShapingText(text: string): boolean {
  const normalized = text.replace(/\s+/gu, ' ').trim().toLowerCase();

  if (normalized.length === 0 || HISTORY_MARKER.test(normalized)) {
    return false;
  }

  return PARTICIPANT_TERMS.some(
    (term) => normalized.includes(term.toLowerCase()),
  );
}

/** Resolves a relative `.js` module specifier to the real TypeScript file. */
async function resolveSourceModule(fromFile: string, specifier: string): Promise<string | undefined> {
  if (!specifier.startsWith('.')) {
    return undefined;
  }

  const base = resolve(dirname(fromFile), specifier);
  const candidates = base.endsWith('.js')
    ? [`${base.slice(0, -3)}.ts`]
    : [`${base}.ts`, join(base, 'index.ts')];

  for (const candidate of candidates) {
    try {
      await readFile(candidate, 'utf8');
      return candidate;
    } catch {
      // Try the next shape.
    }
  }

  return undefined;
}

/** Collects every name the kernel root re-exports, including type-only names. */
export async function kernelRootExportNames(): Promise<ReadonlySet<string>> {
  const names = new Set<string>();
  const visited = new Set<string>();

  const collect = async (filePath: string): Promise<void> => {
    const absolute = resolve(filePath);

    if (visited.has(absolute)) {
      return;
    }

    visited.add(absolute);
    const source = await readFile(absolute, 'utf8');
    const file = ts.createSourceFile(
      absolute,
      source,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TS,
    );

    for (const statement of file.statements) {
      if (ts.isExportDeclaration(statement)) {
        const specifier = statement.moduleSpecifier;

        if (specifier === undefined || !ts.isStringLiteral(specifier)) {
          continue;
        }

        const target = await resolveSourceModule(absolute, specifier.text);

        if (statement.exportClause === undefined) {
          if (target !== undefined) {
            await collect(target);
          }

          continue;
        }

        if (ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            names.add(element.name.text);
          }
        }

        continue;
      }

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
        if (statement.name !== undefined) {
          names.add(statement.name.text);
        }
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          names.add(declaration.name.getText(file));
        }
      }
    }
  };

  await collect(join(KERNEL_ROOT, 'index.ts'));

  return names;
}

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

  it('detects a reintroduced concept, a bare plugin key, and a plugin-manager key (guard canary)', () => {
    assert.deepEqual(
      conceptViolations(
        'export type KernelPlugin = object;\n'
        + "const scoped = (caller) => caller.partitionPrefix;\n"
        + "const bag = { plugins: [] };\n",
      ),
      ['KernelPlugin', 'partitionPrefix', 'bagKey:plugins'],
    );
    assert.deepEqual(
      pluginManagerKeyViolations("const options = { 'pluginManager.plugins': entries };"),
      ['key:pluginManager.plugins'],
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
const KNOWN_EXPORT_PARTICIPANT_FINDINGS = new Set<string>([
  // Filled from the first real run; each entry is a contract the decision
  // record has not yet ruled on. They are recorded for their own cleanup steps.
  'services/ExposedApiRegistry/contracts/coreApis.ts:CORE_API_NAME: value:actions',
  'services/ExposedApiRegistry/contracts/coreApis.ts:CORE_API_NAME: value:filesystem',
  'services/ExposedApiRegistry/contracts/coreApis.ts:CORE_API_NAME: value:history',
  'services/ExposedApiRegistry/contracts/coreApis.ts:CORE_API_NAME: value:pluginManager',
  'services/ExposedApiRegistry/contracts/coreApis.ts:CORE_API_NAME: value:settings',
  'services/ExposedApiRegistry/contracts/coreApis.ts:CORE_API_NAME: value:settingsReader',
  'services/ExposedApiRegistry/contracts/coreApis.ts:CORE_API_NAME: value:terminal',
  'services/ExposedApiRegistry/contracts/coreApis.ts:CORE_API_NAME: value:tools',
  'services/ExposedApiRegistry/contracts/coreApis.ts:CORE_API_NAME: value:universalHistory',
  'services/ExposedApiRegistry/contracts/coreApis.ts:CORE_API_NAME: value:utilities',
  'services/ExposedApiRegistry/contracts/coreApis.ts:CORE_API_NAME: value:validation',
  'services/ExposedApiRegistry/contracts/coreApis.ts:CORE_API_NAME: value:workspace',
  'services/ExposedApiRegistry/contracts/types.ts:ExposedApiAccessContext.official: comment',
  'services/ExposedApiRegistry/contracts/types.ts:ExposedApiCaller.subjectId: comment',
  'services/ExposedApiRegistry/orchestrator/ExposedApiRegistryService.ts:deriveExposedApiOrigin: comment',
  'src/bootstrap/config/types.ts:BrudConfigEntry.official: comment',
  'src/contracts/brudOperation.ts:BRUD_KIND_ACTION: comment',
  'src/contracts/brudOperation.ts:BRUD_KIND_TOOL: comment',
  'src/contracts/handler.ts:PluginMetadata: name',
  'src/contracts/serviceDescriptor.ts:ServiceDescriptor.official: comment',
]);

describe('BC-5: kernel source carries no plugin-manager key', () => {
  it('names no plugin-manager key in any non-test kernel source file', async () => {
    const files = [
      ...await kernelSourceFiles(join(KERNEL_ROOT, 'src')),
      ...await kernelSourceFiles(join(KERNEL_ROOT, 'services')),
    ];
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');

      for (const violation of pluginManagerKeyViolations(source)) {
        violations.push(`${relative(KERNEL_ROOT, file)}: ${violation}`);
      }
    }

    assert.deepEqual(violations, []);
  });

  it('permits the keys in comments and detects a written key (guard canary)', () => {
    assert.deepEqual(
      pluginManagerKeyViolations(
        "// History: pluginManager.plugins and initialPlugins once appeared here.\n"
        + "const value = 1;\n",
      ),
      [],
    );
    assert.deepEqual(
      pluginManagerKeyViolations(
        "const bag = { 'pluginManager.configPath': value };\n"
        + 'const other = initialPlugins;\n',
      ),
      ['identifier:initialPlugins', 'key:pluginManager.configPath'],
    );
  });
});

describe('BC-6: kernel comments describe the kernel, not a specific participant', () => {
  it('has no participant-shaped comment in non-test kernel source', async () => {
    const files = [
      ...await kernelSourceFiles(join(KERNEL_ROOT, 'src')),
      ...await kernelSourceFiles(join(KERNEL_ROOT, 'services')),
    ];
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');

      for (const violation of participantShapingCommentViolations(source)) {
        violations.push(`${relative(KERNEL_ROOT, file)}: ${violation}`);
      }
    }

    assert.deepEqual(violations, []);
  });

  it('detects present-tense participant shaping and permits history (guard canary)', () => {
    const source = [
      '// The kernel activates plugins during boot.',
      '// Previously the kernel carried plugins in its boot types.',
      'const value = 1;',
    ].join('\n');

    assert.deepEqual(
      participantShapingCommentViolations(source),
      ['// The kernel activates plugins during boot.'],
    );
  });
});

describe('BC-7: kernel root exports no participant-shaped declaration', () => {
  it('reports no unrecorded participant-shaped export', async () => {
    const rootNames = await kernelRootExportNames();
    const files = [
      ...await kernelSourceFiles(join(KERNEL_ROOT, 'src')),
      ...await kernelSourceFiles(join(KERNEL_ROOT, 'services')),
    ];
    const declarations: ExportedDeclaration[] = [];

    for (const file of files) {
      declarations.push(...exportedDeclarationsWithComments(
        relative(KERNEL_ROOT, file),
        await readFile(file, 'utf8'),
      ));
    }

    const findings = [...participantShapedExportFindings(declarations, rootNames)];
    const unrecorded = findings.filter(
      (finding) => !KNOWN_EXPORT_PARTICIPANT_FINDINGS.has(finding),
    );

    assert.deepEqual(unrecorded, []);
  });

  it('detects a new participant-shaped exported declaration (guard canary)', () => {
    const source = [
      'export interface Probe {',
      '  /** Plugin contexts use the plugin id. */',
      '  subjectId: string;',
      '}',
    ].join('\n');

    const declarations = exportedDeclarationsWithComments('canary.ts', source);

    assert.deepEqual(
      participantShapedExportFindings(declarations, new Set(['Probe'])),
      ['canary.ts:Probe.subjectId: comment'],
    );
  });
});
