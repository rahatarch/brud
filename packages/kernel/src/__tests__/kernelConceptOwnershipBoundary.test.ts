import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as ts from 'typescript';
import {
  EXPOSED_API_REGISTRY_CONTEXT_SCOPE,
  EXPOSED_API_REGISTRY_CONTRACT_METHODS,
  EXPOSED_API_SCOPE_RECORD_FORMAT,
  EXPOSED_API_SCOPE_RECORD_PATH_FIELD,
  ExposedApiRegistryToken,
  HARDCORE_SERVICES,
  IDENTITY_REGISTRY_CONTEXT_SCOPE,
  bootKernel,
  createExposedApiRegistryDescriptor,
  provisionIdentityRegistryStorage,
  type BrudKernel,
  type IExposedApiRegistry,
} from '../../index.js';
import { ROUTER_CONTEXT_SCOPE } from '../../services/Router/bootOptions.js';

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
const BOOT_LOADER = join(KERNEL_ROOT, 'src', 'bootstrap', 'bootKernelInternal.ts');
const SERVICE_DESCRIPTOR = join(KERNEL_ROOT, 'src', 'contracts', 'serviceDescriptor.ts');
const CORE_APIS = join(
  KERNEL_ROOT,
  'services',
  'ExposedApiRegistry',
  'contracts',
  'coreApis.ts',
);
const IDENTITY_REGISTRY_SERVICE = join(
  KERNEL_ROOT,
  'services',
  'IdentityRegistry',
  'orchestrator',
  'IdentityRegistryService.ts',
);
const IDENTITY_REGISTRY_MODULE = join(
  KERNEL_ROOT,
  'services',
  'IdentityRegistry',
  'serviceModule.ts',
);
const BRUD_OPERATION = join(KERNEL_ROOT, 'src', 'contracts', 'brudOperation.ts');
const CONTAINER_CONTRACT = join(KERNEL_ROOT, 'src', 'contracts', 'container.ts');

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

/**
 * The only named fields a kernel boot options type may declare.
 *
 * The kernel owns the host-supplied options bag and the logger. Every other
 * named member is a service's option, whatever the service is called, and
 * belongs inside the bag where that service interprets it.
 */
/** Reports any officialness field declared on the service descriptor shape. */
export function descriptorOfficialMembers(source: string): readonly string[] {
  return interfaceMemberNames(source, 'ServiceDescriptor')
    .filter((name) => name === 'official');
}

/**
 * Non-universal dormant declarations removed in cleanup Step 5.
 *
 * Paths are relative to the kernel package root. Each name belonged to a
 * specific participant or duplicated that participant's concept, so it does
 * not return to the kernel.
 */
const REMOVED_DORMANT_EXPORTS: ReadonlyMap<string, readonly string[]> = new Map([
  [
    'services/ExposedApiRegistry/contracts/coreApis.ts',
    ['CoreApiName', 'identityProjection'],
  ],
  [
    'services/IdentityRegistry/orchestrator/IdentityRegistryService.ts',
    ['createIdentityRegistry'],
  ],
  [
    'services/IdentityRegistry/serviceModule.ts',
    ['requireIdentityRegistry'],
  ],
  ['src/contracts/brudOperation.ts', ['BrudBuiltInKind']],
]);

/** Non-exported dormant state that belonged to no universal primitive. */
const REMOVED_DORMANT_IDENTIFIERS: ReadonlyMap<string, readonly string[]> = new Map([
  ['src/contracts/container.ts', ['counter']],
]);

/**
 * Returns every removed non-universal dormant declaration that reappeared.
 *
 * The check is keyed by the file that owned the declaration, so a name that is
 * legitimate elsewhere does not trigger a finding.
 */
export function dormantReintroductionViolations(
  sources: readonly { readonly file: string; readonly source: string }[],
): readonly string[] {
  const violations: string[] = [];

  for (const { file, source } of sources) {
    const exportedNames = new Set(exportedDeclarationNames(source));

    for (const name of REMOVED_DORMANT_EXPORTS.get(file) ?? []) {
      if (exportedNames.has(name)) {
        violations.push(`${file}:${name}`);
      }
    }

    for (const name of REMOVED_DORMANT_IDENTIFIERS.get(file) ?? []) {
      if (new RegExp(`\\b${escapeRegExp(name)}\\b`, 'u').test(source)) {
        violations.push(`${file}:${name}`);
      }
    }
  }

  return violations.sort();
}

/**
 * The universal operation-kind mechanism (R-05).
 *
 * These are the only declarations the kernel's kind vocabulary exports: the
 * open kind identity, the token shape, and its validator.
 */
const KIND_MECHANISM_EXPORTS: readonly string[] = [
  'BRUD_KIND_PATTERN',
  'BrudOperationKind',
  'isValidBrudKind',
].sort();

/**
 * Officials' kind values and the built-in kind type that named them.
 *
 * They belong to the services that claim them (R-05), not to the kernel.
 */
const OFFICIAL_KIND_DECLARATIONS: readonly string[] = [
  'BRUD_DEFAULT_KIND',
  'BRUD_KIND_ACTION',
  'BRUD_KIND_TOOL',
  'BrudBuiltInKind',
];

/** A dotted service token or caller identifier, such as `owner.area.name`. */
const DOTTED_PARTICIPANT_IDENTIFIER = /\b[a-z][\w-]+(?:\.[a-z][\w-]+)+\b/iu;

/**
 * Returns every way the kernel's kind vocabulary carries more than the
 * mechanism.
 *
 * The check is structural: any export outside the mechanism, any exported
 * fixed kind value, any literal kind type, and any comment naming a
 * participant or a dotted service token is a finding, including a value or
 * service that has never existed.
 */
export function kindVocabularyViolations(source: string): readonly string[] {
  const file = ts.createSourceFile(
    'brudOperation.ts',
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const violations = new Set<string>();

  for (const name of exportedDeclarationNames(source)) {
    if (!KIND_MECHANISM_EXPORTS.includes(name)) {
      violations.add(`export:${name}`);
    }
  }

  const containsLiteralType = (node: ts.Node): boolean => {
    if (ts.isLiteralTypeNode(node)) {
      return true;
    }

    return ts.forEachChild(node, containsLiteralType) ?? false;
  };

  for (const statement of file.statements) {
    const exported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ) ?? false;

    if (!exported) {
      continue;
    }

    if (ts.isTypeAliasDeclaration(statement) && containsLiteralType(statement.type)) {
      violations.add(`literalType:${statement.name.text}`);
    }
  }

  for (const declaration of exportedDeclarationsWithComments('brudOperation.ts', source)) {
    for (const value of declaration.stringValues) {
      violations.add(`value:${declaration.name}=${value}`);
    }
  }

  for (const comment of commentsInSource(source)) {
    const text = comment.replace(/\s+/gu, ' ').trim();

    if (participantShapingText(text) || DOTTED_PARTICIPANT_IDENTIFIER.test(text)) {
      violations.add(`comment:${text}`);
    }
  }

  return [...violations].sort();
}

/**
 * The only named fields a kernel boot options type may declare.
 *
 * The kernel owns the host-supplied options bag and the logger. Every other
 * named member is a service's option, whatever the service is called, and
 * belongs inside the bag where that service interprets it.
 */
const KERNEL_OWNED_BOOT_FIELDS: ReadonlyMap<string, readonly string[]> = new Map([
  ['BootKernelOptions', ['logger', 'options']],
  ['ComposeKernelOptions', ['logger', 'options']],
  ['KernelBootOptions', ['logger', 'options']],
]);

/**
 * Returns every named member of a kernel boot options type that the kernel
 * does not itself own.
 *
 * The test is structural, not a list of today's service names: any named
 * member outside the kernel-owned set is a service's option, including an
 * option belonging to a service that does not exist yet.
 */
export function serviceOptionMembers(
  sources: readonly { readonly label: string; readonly source: string; readonly interfaces: readonly string[] }[],
): readonly string[] {
  const violations: string[] = [];

  for (const { label, source, interfaces } of sources) {
    for (const interfaceName of interfaces) {
      const owned = KERNEL_OWNED_BOOT_FIELDS.get(interfaceName);

      if (owned === undefined) {
        continue;
      }

      for (const member of interfaceMemberNames(source, interfaceName)) {
        if (!owned.includes(member)) {
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

    assert.deepEqual(serviceOptionMembers([
      {
        label: 'bootTypes.ts',
        source: bootTypes,
        interfaces: ['BootKernelOptions', 'ComposeKernelOptions'],
      },
      {
        label: 'kernel.ts',
        source: kernelContract,
        interfaces: ['KernelBootOptions'],
      },
    ]), []);

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

  it('fails on a service option the kernel has never seen (guard canary)', () => {
    const source = `
      interface BootKernelOptions {
        options?: Record<string, unknown>;
        logger?: unknown;
        catalogRoot?: string;
        mcpBridge?: unknown;
      }
    `;

    assert.deepEqual(
      serviceOptionMembers([
        { label: 'canary.ts', source, interfaces: ['BootKernelOptions'] },
      ]),
      [
        'canary.ts:BootKernelOptions.catalogRoot',
        'canary.ts:BootKernelOptions.mcpBridge',
      ],
    );

    assert.deepEqual(
      serviceOptionMembers([
        {
          label: 'canary.ts',
          source: `
            interface ComposeKernelOptions {
              [option: string]: unknown;
              searchIndexPath?: string;
            }
          `,
          interfaces: ['ComposeKernelOptions'],
        },
      ]),
      ['canary.ts:ComposeKernelOptions.searchIndexPath'],
    );

    assert.deepEqual(
      serviceOptionMembers([
        {
          label: 'canary.ts',
          source: `
            interface ComposeKernelOptions {
              options?: Record<string, unknown>;
              logger?: KernelLogger;
            }
          `,
          interfaces: ['ComposeKernelOptions'],
        },
      ]),
      [],
    );
  });
});
const KNOWN_EXPORT_PARTICIPANT_FINDINGS = new Set<string>([
  // Filled from the first real run; each entry is a contract the decision
  // record has not yet ruled on. They are recorded for their own cleanup steps.
  'src/contracts/handler.ts:PluginMetadata: name',
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

describe('BC-8: no officialness on a descriptor and no removed dormant declaration', () => {
  it('declares no officialness field on the real service descriptor', async () => {
    const source = await readFile(SERVICE_DESCRIPTOR, 'utf8');

    assert.deepEqual(descriptorOfficialMembers(source), []);
    assert.deepEqual(
      [...interfaceMemberNames(source, 'ServiceDescriptor')].sort(),
      [
        'accessPolicy',
        'contract',
        'dependencies',
        'factory',
        'manifest',
        'project',
        'tier',
        'token',
      ],
    );
  });

  it('keeps every removed non-universal dormant declaration absent', async () => {
    const sources = [
      {
        file: 'services/ExposedApiRegistry/contracts/coreApis.ts',
        source: await readOptional(CORE_APIS),
      },
      {
        file: 'services/IdentityRegistry/orchestrator/IdentityRegistryService.ts',
        source: await readFile(IDENTITY_REGISTRY_SERVICE, 'utf8'),
      },
      {
        file: 'services/IdentityRegistry/serviceModule.ts',
        source: await readFile(IDENTITY_REGISTRY_MODULE, 'utf8'),
      },
      {
        file: 'src/contracts/brudOperation.ts',
        source: await readFile(BRUD_OPERATION, 'utf8'),
      },
      {
        file: 'src/contracts/container.ts',
        source: await readFile(CONTAINER_CONTRACT, 'utf8'),
      },
    ];

    assert.deepEqual(dormantReintroductionViolations(sources), []);
  });

  it('detects a reintroduced officialness field and dormant declaration (guard canary)', () => {
    assert.deepEqual(
      descriptorOfficialMembers(
        'interface ServiceDescriptor<T> { token: T; official?: boolean; }',
      ),
      ['official'],
    );
    assert.deepEqual(
      dormantReintroductionViolations([
        {
          file: 'services/ExposedApiRegistry/contracts/coreApis.ts',
          source: 'export type CoreApiName = string;\n'
            + 'export function identityProjection(value: unknown) { return value; }',
        },
        {
          file: 'services/IdentityRegistry/orchestrator/IdentityRegistryService.ts',
          source: 'export function createIdentityRegistry() {}',
        },
        {
          file: 'services/IdentityRegistry/serviceModule.ts',
          source: 'export function requireIdentityRegistry() {}',
        },
        {
          file: 'src/contracts/brudOperation.ts',
          source: 'export type BrudBuiltInKind = string;',
        },
        {
          file: 'src/contracts/container.ts',
          source: 'let counter = 0;',
        },
      ]),
      [
        'services/ExposedApiRegistry/contracts/coreApis.ts:CoreApiName',
        'services/ExposedApiRegistry/contracts/coreApis.ts:identityProjection',
        'services/IdentityRegistry/orchestrator/IdentityRegistryService.ts:createIdentityRegistry',
        'services/IdentityRegistry/serviceModule.ts:requireIdentityRegistry',
        'src/contracts/brudOperation.ts:BrudBuiltInKind',
        'src/contracts/container.ts:counter',
      ],
    );
  });
});

describe('BC-9: the kernel kind vocabulary is the mechanism, not the officials\' values', () => {
  it('exports no official kind value from the real package root', async () => {
    const kernelModule = await import('../../index.js') as Record<string, unknown>;

    for (const name of OFFICIAL_KIND_DECLARATIONS) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(kernelModule, name),
        false,
        `the kernel package must not export ${name}`,
      );
    }

    assert.equal(typeof kernelModule.isValidBrudKind, 'function');
    assert.ok(kernelModule.BRUD_KIND_PATTERN instanceof RegExp);
  });

  it('keeps the open kind mechanism and no official kind name in the root exports', async () => {
    const rootNames = await kernelRootExportNames();

    assert.deepEqual(
      OFFICIAL_KIND_DECLARATIONS.filter((name) => rootNames.has(name)),
      [],
    );
    assert.deepEqual(
      KIND_MECHANISM_EXPORTS.filter((name) => !rootNames.has(name)),
      [],
    );
  });

  it('carries only the mechanism and names no service in the real kind contract', async () => {
    const source = await readFile(BRUD_OPERATION, 'utf8');

    assert.deepEqual(kindVocabularyViolations(source), []);
    assert.deepEqual([...exportedDeclarationNames(source)].sort(), KIND_MECHANISM_EXPORTS);
  });

  it('detects a reintroduced value, built-in type, and service-naming comment (guard canary)', () => {
    assert.deepEqual(
      kindVocabularyViolations([
        '/** Shared kind vocabulary for the Parser and Router. */',
        'export type BrudOperationKind = string;',
        '/** Built-in kind served by `brud.core.tools`. */',
        "export const BRUD_KIND_TOOL = 'tool' as const;",
        "export type BrudBuiltInKind = 'tool' | 'action';",
      ].join('\n')),
      [
        'comment:/** Built-in kind served by `brud.core.tools`. */',
        'comment:/** Shared kind vocabulary for the Parser and Router. */',
        'export:BRUD_KIND_TOOL',
        'export:BrudBuiltInKind',
        'literalType:BrudBuiltInKind',
        'value:BRUD_KIND_TOOL=tool',
      ],
    );
  });

  it('fails on a kind value and service token the kernel has never seen (guard canary)', () => {
    assert.deepEqual(
      kindVocabularyViolations([
        '/** Kind claimed by `acme.widgets`. */',
        "export const ACME_WIDGET_KIND = 'widget';",
      ].join('\n')),
      [
        'comment:/** Kind claimed by `acme.widgets`. */',
        'export:ACME_WIDGET_KIND',
        'value:ACME_WIDGET_KIND=widget',
      ],
    );
  });
});

/** Reads a file, or returns an empty source when the file does not exist. */
async function readOptional(path: string): Promise<string> {
  return existsSync(path) ? readFile(path, 'utf8') : '';
}

/** Every non-test kernel source file, with its path relative to the kernel root. */
async function kernelSources(): Promise<readonly { readonly file: string; readonly absolute: string; readonly source: string }[]> {
  const files = [
    ...await kernelSourceFiles(join(KERNEL_ROOT, 'src')),
    ...await kernelSourceFiles(join(KERNEL_ROOT, 'services')),
    ...await kernelSourceFiles(join(KERNEL_ROOT, 'serviceModules')),
    join(KERNEL_ROOT, 'index.ts'),
  ];
  const sources = [];

  for (const absolute of files) {
    sources.push({
      file: relative(KERNEL_ROOT, absolute),
      absolute,
      source: await readFile(absolute, 'utf8'),
    });
  }

  return sources;
}

function parseSource(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
}

function isExported(statement: ts.Statement): boolean {
  return (ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined)
    ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

/** Strips `as const`, `satisfies`, parentheses, and `Object.freeze(...)`. */
function unwrapInitializer(node: ts.Expression): ts.Expression {
  let current = node;

  for (;;) {
    if (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }

    if (
      ts.isCallExpression(current)
      && current.expression.getText() === 'Object.freeze'
      && current.arguments.length === 1
    ) {
      current = current.arguments[0] as ts.Expression;
      continue;
    }

    return current;
  }
}

/**
 * Ruling 1: returns every exported table of names, and every type derived
 * from one.
 *
 * Structural: an exported object literal whose every member maps a key to a
 * fixed string is a table of names, whatever the names are. A type alias that
 * queries such a table (`typeof TABLE`) is derived from it.
 */
export function nameTableViolations(file: string, source: string): readonly string[] {
  const sourceFile = parseSource(file, source);
  const tables = new Set<string>();
  const violations: string[] = [];

  for (const statement of sourceFile.statements) {
    if (!isExported(statement) || !ts.isVariableStatement(statement)) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (declaration.initializer === undefined || !ts.isIdentifier(declaration.name)) {
        continue;
      }

      const initializer = unwrapInitializer(declaration.initializer);

      if (
        ts.isObjectLiteralExpression(initializer)
        && initializer.properties.length > 0
        && initializer.properties.every((property) =>
          ts.isPropertyAssignment(property)
          && ts.isStringLiteralLike(unwrapInitializer(property.initializer)))
      ) {
        tables.add(declaration.name.text);
        violations.push(`${file}:${declaration.name.text}: name table`);
      }
    }
  }

  const queriesTable = (node: ts.Node): string | undefined => {
    if (ts.isTypeQueryNode(node) && tables.has(node.exprName.getText())) {
      return node.exprName.getText();
    }

    return ts.forEachChild(node, queriesTable);
  };

  for (const statement of sourceFile.statements) {
    if (isExported(statement) && ts.isTypeAliasDeclaration(statement)) {
      const table = queriesTable(statement.type);

      if (table !== undefined) {
        violations.push(`${file}:${statement.name.text}: derived from ${table}`);
      }
    }
  }

  return violations.sort();
}

/** Identifiers the resolution primitive must never carry (Rulings 2, 4, 5). */
const REGISTRY_CALLER_IDENTIFIERS: readonly string[] = [
  'callerId',
  'subjectId',
  'allowedCallers',
  'deniedCallers',
  'accessPolicy',
  'workspaceRoot',
  'deriveExposedApiOrigin',
];

/** A dotted service token, caller identifier, or context field. */
const DOTTED_LITERAL = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+$/u;

/**
 * Ruling 2: returns every participant name, participant token, caller
 * identifier, or caller list in one resolution-primitive source file.
 *
 * Structural: a caller-identity identifier is a finding; a dotted literal that
 * is not one of the primitive's own self-names is a finding; a string that
 * names a participant is a finding. The self-names are read from the real
 * exports, not listed by hand.
 */
export function registryParticipantViolations(
  file: string,
  source: string,
  selfNames: ReadonlySet<string>,
): readonly string[] {
  const sourceFile = parseSource(file, source);
  const violations = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && REGISTRY_CALLER_IDENTIFIERS.includes(node.text)) {
      violations.add(`${file}: identifier ${node.text}`);
    }

    if (ts.isStringLiteralLike(node)) {
      if (DOTTED_LITERAL.test(node.text) && !selfNames.has(node.text)) {
        violations.add(`${file}: literal ${node.text}`);
      }

      if (participantShapingText(node.text)) {
        violations.add(`${file}: participant name ${node.text}`);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return [...violations].sort();
}

/**
 * Ruling 3: returns every context field a kernel file names outside the
 * namespaces the kernel folder's own participants declare.
 *
 * A field is named when a dotted literal indexes an options bag, keys an
 * object literal placed in an `options` member, or initializes a `*_FIELD`
 * constant.
 */
export function contextFieldViolations(
  file: string,
  source: string,
  ownScopes: ReadonlySet<string>,
): readonly string[] {
  const sourceFile = parseSource(file, source);
  const violations = new Set<string>();

  const check = (field: string): void => {
    if (DOTTED_LITERAL.test(field) && !ownScopes.has(field.split('.')[0] as string)) {
      violations.add(`${file}: context field ${field}`);
    }
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isElementAccessExpression(node)
      && /options$/u.test(node.expression.getText())
      && ts.isStringLiteralLike(node.argumentExpression)
    ) {
      check(node.argumentExpression.text);
    }

    if (
      ts.isPropertyAssignment(node)
      && node.name.getText() === 'options'
      && ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const property of node.initializer.properties) {
        if (property.name !== undefined && ts.isStringLiteralLike(property.name)) {
          check(property.name.text);
        }
      }
    }

    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && /_FIELD$/u.test(node.name.text)
      && node.initializer !== undefined
      && ts.isStringLiteralLike(node.initializer)
    ) {
      check(node.initializer.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return [...violations].sort();
}

/** Whether a path is equal to or inside the kernel folder. */
function insideKernel(candidate: string): boolean {
  const root = resolve(KERNEL_ROOT);
  const normalized = resolve(candidate);

  return normalized === root || normalized.startsWith(`${root}${sep}`);
}

/**
 * Ruling 7: returns every config-discovery reach in one kernel source file.
 *
 * Reading any environment variable is a finding, because the kernel receives
 * its config only from the host. A literal naming a config document is a
 * finding. A module-relative URL that leaves the kernel folder is a finding.
 */
export function configDiscoveryViolations(
  file: string,
  absolute: string,
  source: string,
): readonly string[] {
  const sourceFile = parseSource(file, source);
  const violations = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.getText() === 'process.env') {
      violations.add(`${file}: environment read`);
    }

    if (ts.isStringLiteralLike(node) && /config\.json$/u.test(node.text)) {
      violations.add(`${file}: config document ${node.text}`);
    }

    if (
      ts.isNewExpression(node)
      && node.expression.getText() === 'URL'
      && node.arguments !== undefined
      && node.arguments.length === 2
      && ts.isStringLiteralLike(node.arguments[0] as ts.Expression)
      && (node.arguments[1] as ts.Expression).getText() === 'import.meta.url'
    ) {
      const target = resolve(dirname(absolute), (node.arguments[0] as ts.StringLiteral).text);

      if (!insideKernel(target)) {
        violations.add(`${file}: path outside the kernel folder ${(node.arguments[0] as ts.StringLiteral).text}`);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return [...violations].sort();
}

describe('BC-10: the kernel exports no table of API names (Ruling 1)', () => {
  it('exports no name table and no type derived from one anywhere in kernel source', async () => {
    const violations: string[] = [];

    for (const { file, source } of await kernelSources()) {
      violations.push(...nameTableViolations(file, source));
    }

    assert.deepEqual(violations, []);
  });

  it('exports neither the removed table nor its type from the real package root', async () => {
    const kernelModule = await import('../../index.js') as Record<string, unknown>;
    const rootNames = await kernelRootExportNames();

    for (const name of ['CORE_API_NAME', 'CoreApiName']) {
      assert.equal(Object.prototype.hasOwnProperty.call(kernelModule, name), false, name);
      assert.equal(rootNames.has(name), false, name);
    }
  });

  it('detects a name table, its derived type, and a never-seen table (guard canary)', () => {
    assert.deepEqual(
      nameTableViolations('canary.ts', [
        "export const CORE_API_NAME = Object.freeze({ fileSystem: 'filesystem', tools: 'tools' } as const);",
        'export type CoreApiName = (typeof CORE_API_NAME)[keyof typeof CORE_API_NAME];',
        "export const ACME_NAMES = { widget: 'acme.widget' };",
        'export const LIMITS = Object.freeze({ max: 1 });',
      ].join('\n')),
      [
        'canary.ts:ACME_NAMES: name table',
        'canary.ts:CORE_API_NAME: name table',
        'canary.ts:CoreApiName: derived from CORE_API_NAME',
      ],
    );
  });
});

/** The resolution primitive's own self-names, read from the real exports. */
const REGISTRY_SELF_NAMES: ReadonlySet<string> = new Set([
  ExposedApiRegistryToken.id,
  EXPOSED_API_SCOPE_RECORD_FORMAT,
  EXPOSED_API_SCOPE_RECORD_PATH_FIELD,
]);

describe('BC-11: the resolution primitive carries no participant, caller id, or caller list (Rulings 2, 4, 5)', () => {
  it('names no participant, token, caller identifier, or caller list in any registry source file', async () => {
    const violations: string[] = [];

    for (const { file, source } of await kernelSources()) {
      if (file.startsWith(join('services', 'ExposedApiRegistry'))) {
        violations.push(...registryParticipantViolations(file, source, REGISTRY_SELF_NAMES));
      }
    }

    assert.deepEqual(violations, []);
  });

  it('declares exactly register and resolve, has no access policy, and projects only resolve', () => {
    const descriptor = createExposedApiRegistryDescriptor();
    const entry = HARDCORE_SERVICES.find((service) => service.token === ExposedApiRegistryToken.id);
    const context = { callerId: 'canary', tier: 'core' as const, options: {} };
    const instance = descriptor.factory(context, undefined as never);
    const view = descriptor.project?.(instance, context);

    assert.deepEqual([...EXPOSED_API_REGISTRY_CONTRACT_METHODS].sort(), ['register', 'resolve']);
    assert.deepEqual([...(entry?.contractInterface ?? [])].sort(), ['register', 'resolve']);
    assert.equal(descriptor.accessPolicy, undefined);
    assert.ok(view !== undefined);
    assert.deepEqual(Object.keys(view), ['resolve']);
    assert.equal('register' in view, false);
  });

  it('detects a caller list, a caller-id comparison, and a participant name (guard canary)', () => {
    assert.deepEqual(
      registryParticipantViolations('canary.ts', [
        "const policy = { allowedCallers: ['kernel', 'PluginManager', 'brud.host.daemon'] };",
        "const host = (access) => access.callerId === 'brud.daemon';",
        "const own = 'brud.core.exposedApiRegistry';",
      ].join('\n'), REGISTRY_SELF_NAMES),
      [
        'canary.ts: identifier allowedCallers',
        'canary.ts: identifier callerId',
        'canary.ts: literal brud.daemon',
        'canary.ts: literal brud.host.daemon',
        'canary.ts: participant name PluginManager',
      ],
    );
  });
});

/** One fixture participant for the production-mirror resolution tests. */
interface FixtureParticipant {
  readonly token: string;
  readonly official?: boolean;
  readonly capabilities?: readonly string[];
  readonly exposures?: readonly Readonly<Record<string, unknown>>[];
  /** JavaScript object literal mapping `name@major` to a binding. */
  readonly bindings?: string;
  /** JavaScript run in `onRunning` with `registry` and `report` in scope. */
  readonly onRunning?: string;
}

/** Writes one real participant module: plain data plus real lifecycle code. */
function fixtureModule(participant: FixtureParticipant): string {
  const manifest = {
    requests: { capabilities: [...(participant.capabilities ?? [])] },
    exposures: [...(participant.exposures ?? [])],
  };

  return `const token = { id: ${JSON.stringify(participant.token)}, description: 'resolution fixture', _brand: undefined };
const REGISTRY = { id: ${JSON.stringify(ExposedApiRegistryToken.id)}, description: 'resolution primitive', _brand: undefined };
const report = (globalThis.__resolutionFixture ??= {})[token.id] ??= {};
const bindings = ${participant.bindings ?? '{}'};

export function createService() {
  return {
    token,
    tier: 'userland',
    dependencies: [],
    manifest: ${JSON.stringify(manifest)},
    factory: () => {
      const instance = {
        async onRunning(broker) {
          const registry = broker.requestAccess({ callerId: token.id, tier: 'userland', options: {} }, REGISTRY);
          ${participant.onRunning ?? ''}
        },
      };
      Object.defineProperty(instance, 'provideExposure', {
        value: (name, major) => bindings[name + '@' + String(major)],
        enumerable: false,
      });
      return instance;
    },
  };
}
`;
}

interface FixtureComposition {
  readonly configPath: string;
  readonly options: Readonly<Record<string, unknown>>;
  /** Kernels booted from this composition; shut down before its files go. */
  readonly kernels: BrudKernel[];
}

/** Writes a real composition: the two hardcore services plus the fixtures. */
async function writeComposition(
  t: TestContext,
  participants: readonly FixtureParticipant[],
): Promise<FixtureComposition> {
  const root = await mkdtemp(join(tmpdir(), 'brud-resolution-boundary-'));
  const kernels: BrudKernel[] = [];

  // One cleanup per composition: every kernel shuts down, releasing its
  // protected files, before the composition's directory is removed.
  t.after(async () => {
    for (const kernel of kernels.splice(0)) {
      if (kernel.lifecycleState === 'RUNNING') {
        await kernel.shutdown();
      }
    }

    await rm(root, { recursive: true, force: true });
  });

  const identityPath = join(root, 'identity-registry.json');
  provisionIdentityRegistryStorage(identityPath);

  const services: { path: string; official?: boolean }[] = [
    { path: 'kernel:serviceModules/identityRegistry.js', official: true },
    { path: 'kernel:serviceModules/exposedApiRegistry.js', official: true },
  ];

  for (const [index, participant] of participants.entries()) {
    const modulePath = join(root, `participant-${String(index)}.mjs`);

    await writeFile(modulePath, fixtureModule(participant), 'utf8');
    services.push(participant.official === undefined
      ? { path: modulePath }
      : { path: modulePath, official: participant.official });
  }

  const configPath = join(root, 'brud.config.json');
  await writeFile(configPath, JSON.stringify({ services }, null, 2), 'utf8');

  return { configPath, options: { 'identity.registry.path': identityPath }, kernels };
}

/** Boots a real kernel from a real composition; its cleanup shuts it down. */
async function bootComposition(composition: FixtureComposition): Promise<BrudKernel> {
  const kernel = await bootKernel(composition.configPath, { options: composition.options });

  composition.kernels.push(kernel);

  return kernel;
}

function fixtureReports(): Record<string, Record<string, unknown>> {
  return (globalThis as { __resolutionFixture?: Record<string, Record<string, unknown>> })
    .__resolutionFixture ?? {};
}

function resetFixtureReports(): void {
  delete (globalThis as { __resolutionFixture?: unknown }).__resolutionFixture;
}

const PING_BINDINGS = `new Proxy({}, { get: (_, key) => ({ projection: () => ({ ping: () => String(key) }) }) })`;

describe('BC-12: resolution is identity-keyed, origin-bound, and non-leaking (Ruling 2)', () => {
  it('impostor: a participant calling itself PluginManager or brud.host.daemon gets nothing special', async (t) => {
    resetFixtureReports();

    const probe = `
      for (const name of ['impostor.kernelOnly', 'impostor.officialOnly', 'impostor.hostOnly', 'impostor.open', 'impostor.absent']) {
        report[name] = registry.resolve(name) === null ? 'refused' : 'granted';
      }`;
    const kernel = await bootComposition(await writeComposition(t, [
      {
        token: 'impostor.giver',
        exposures: [
          { name: 'impostor.kernelOnly', scope: 'kernel' },
          { name: 'impostor.officialOnly', scope: 'any', policy: { policyVersion: 1, official: true } },
          { name: 'impostor.hostOnly', scope: 'host' },
          { name: 'impostor.open', scope: 'runtime' },
        ],
        bindings: PING_BINDINGS,
      },
      { token: 'PluginManager', onRunning: probe },
      { token: 'brud.host.daemon', onRunning: probe },
      { token: 'impostor.official', official: true, onRunning: probe },
    ]));
    const reports = fixtureReports();
    const nothingSpecial = {
      'impostor.kernelOnly': 'refused',
      'impostor.officialOnly': 'refused',
      'impostor.hostOnly': 'refused',
      'impostor.open': 'granted',
      'impostor.absent': 'refused',
    };

    assert.equal(kernel.lifecycleState, 'RUNNING');
    assert.deepEqual(reports['PluginManager'], nothingSpecial);
    assert.deepEqual(reports['brud.host.daemon'], nothingSpecial);
    // The composition's own official declaration, not a name, is what grants.
    assert.equal(reports['impostor.official']?.['impostor.officialOnly'], 'granted');
  });

  it('name hijack: a second identity registering an owned name is refused, at any major version', async (t) => {
    for (const version of [1, 2]) {
      const composition = await writeComposition(t, [
        { token: 'hijack.owner', exposures: [{ name: 'hijack.contested', version: 1, scope: 'runtime' }] },
        { token: 'hijack.thief', exposures: [{ name: 'hijack.contested', version, scope: 'runtime' }] },
      ]);

      await assert.rejects(
        bootKernel(composition.configPath, { options: composition.options }),
        (error: unknown) => (error as { readonly code?: unknown }).code === 'EXPOSED_API_NAME_COLLISION',
        `version ${String(version)}`,
      );
    }
  });

  it('origin: a runtime-originated chain never reaches a host-only exposure, even with a host-obtained handle', async (t) => {
    resetFixtureReports();

    const kernel = await bootComposition(await writeComposition(t, [
      {
        token: 'origin.giver',
        exposures: [{ name: 'origin.hostOnly', scope: 'host' }],
        bindings: PING_BINDINGS,
      },
      {
        token: 'origin.runtime',
        onRunning: `
          report.direct = registry.resolve('origin.hostOnly') === null ? 'refused' : 'granted';
          const work = new Promise((give) => { report.give = give; });
          report.done = work.then((job) => job(registry));`,
      },
    ]));
    const reports = fixtureReports()['origin.runtime'] as {
      readonly direct: string;
      readonly give: (job: (registry: IExposedApiRegistry) => unknown) => void;
      readonly done: Promise<unknown>;
    };
    const registry = kernel.requestAccess<IExposedApiRegistry>(
      { callerId: 'host', tier: 'core', options: {} },
      ExposedApiRegistryToken,
    );
    const handle = kernel.runHostCall({}, () =>
      registry.resolve<{ readonly ping: () => string }>('origin.hostOnly'));

    assert.equal(reports.direct, 'refused');
    assert.ok(handle !== null, 'the host-origin chain resolves the host-only exposure');
    assert.equal(kernel.runHostCall({}, () => handle.ping()), 'origin.hostOnly@1');

    // The same handle, used from a runtime-originated chain, is refused.
    reports.give((runtimeRegistry) => {
      const second = runtimeRegistry.resolve('origin.hostOnly');

      try {
        handle.ping();

        return { second, used: 'granted' };
      } catch (error: unknown) {
        return { second, used: (error as { readonly code?: unknown }).code };
      }
    });

    assert.deepEqual(await reports.done, { second: null, used: 'EXPOSED_API_UNAVAILABLE' });

    // Outside any kernel call chain the handle is refused too.
    assert.throws(() => handle.ping(), { name: 'ExposedApiUnavailableError' });
  });

  it('leak: a caller Layer 1 does not permit receives exactly the refusal of a non-existent exposure', async (t) => {
    resetFixtureReports();

    const kernel = await bootComposition(await writeComposition(t, [
      {
        token: 'leak.giver',
        exposures: [{
          name: 'leak.guarded',
          scope: 'any',
          policy: { policyVersion: 1, capabilities: ['leak:secret'] },
        }],
        bindings: PING_BINDINGS,
      },
      {
        token: 'leak.nosy',
        onRunning: `
          report.guarded = registry.resolve('leak.guarded');
          report.absent = registry.resolve('leak.absent');`,
      },
      {
        token: 'leak.entitled',
        capabilities: ['leak:secret'],
        onRunning: `report.guarded = registry.resolve('leak.guarded') === null ? 'refused' : 'granted';`,
      },
    ]));
    const reports = fixtureReports();
    const nosy = reports['leak.nosy'] as { readonly guarded: unknown; readonly absent: unknown };

    assert.ok(Object.prototype.hasOwnProperty.call(nosy, 'guarded'));
    assert.ok(Object.prototype.hasOwnProperty.call(nosy, 'absent'));
    assert.equal(nosy.guarded, null);
    assert.equal(nosy.absent, null);
    assert.ok(Object.is(nosy.guarded, nosy.absent), 'the two refusals are the same value');
    assert.equal(reports['leak.entitled']?.['guarded'], 'granted');

    // The detailed reasons exist only on the kernel's observation stream.
    const refusals = kernel.readObservations()
      .filter((record) => record.event === 'resolve-refused')
      .map((record) => ({ name: record.detail['name'], reason: record.detail['reason'] }));

    assert.ok(refusals.some((refusal) =>
      refusal.name === 'leak.guarded' && String(refusal.reason).includes('lacks capabilities')));
    assert.ok(refusals.some((refusal) =>
      refusal.name === 'leak.absent' && refusal.reason === 'no such exposure'));
  });
});

describe('BC-13: no kernel file names a specific participant\'s context field (Ruling 3)', () => {
  const ownScopes: ReadonlySet<string> = new Set([
    IDENTITY_REGISTRY_CONTEXT_SCOPE,
    EXPOSED_API_REGISTRY_CONTEXT_SCOPE,
    ROUTER_CONTEXT_SCOPE,
  ]);

  it('names only fields inside the kernel folder\'s own declared namespaces', async () => {
    const violations: string[] = [];

    for (const { file, source } of await kernelSources()) {
      violations.push(...contextFieldViolations(file, source, ownScopes));
    }

    assert.deepEqual(violations, []);
  });

  it('detects an indexed, synthesized, or constant participant field (guard canary)', () => {
    assert.deepEqual(
      contextFieldViolations('canary.ts', [
        "const root = context.options['workspace.root'];",
        "const synthesized = { callerId: 'x', options: { 'workspace.root': root } };",
        "export const WORKSPACE_ROOT_FIELD = 'workspace.root';",
        "const own = context.options['identity.registry.path'];",
      ].join('\n'), ownScopes),
      ['canary.ts: context field workspace.root'],
    );
    assert.deepEqual(
      contextFieldViolations('canary.ts', "const root = options['acme.widget.root'];", ownScopes),
      ['canary.ts: context field acme.widget.root'],
    );
  });
});

describe('BC-14: the kernel reads no config-selecting environment variable and discovers no config (Ruling 7)', () => {
  it('reads no environment variable and resolves no default config path in kernel source', async () => {
    const violations: string[] = [];

    for (const { file, absolute, source } of await kernelSources()) {
      violations.push(...configDiscoveryViolations(file, absolute, source));
    }

    assert.deepEqual(violations, []);
  });

  it('ships no config-discovering wrapper from the real package root', async () => {
    const kernelModule = await import('../../index.js') as Record<string, unknown>;
    const rootNames = await kernelRootExportNames();

    for (const name of ['createStandardKernel', 'CreateStandardKernelOptions']) {
      assert.equal(Object.prototype.hasOwnProperty.call(kernelModule, name), false, name);
      assert.equal(rootNames.has(name), false, name);
    }
  });

  it('detects an environment read, a default config path, and an escaping URL (guard canary)', () => {
    const absolute = join(KERNEL_ROOT, 'src', 'bootstrap', 'canary.ts');

    assert.deepEqual(
      configDiscoveryViolations('canary.ts', absolute, [
        'const override = process.env.BRUD_STANDARD_CONFIG;',
        "const candidate = fileURLToPath(new URL('../../../brud.config.json', import.meta.url));",
        "const inside = new URL('../../', import.meta.url);",
      ].join('\n')),
      [
        'canary.ts: config document ../../../brud.config.json',
        'canary.ts: environment read',
        'canary.ts: path outside the kernel folder ../../../brud.config.json',
      ],
    );
  });
});
