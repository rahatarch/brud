/**
 * The closed 21-kind vocabulary and its constraint matrix.
 *
 * The table is the audited §4.2 matrix, restated as data so the validator and
 * its parity test cannot drift. `KNOWN_OPERATION_KINDS` stays a closed literal
 * for legacy parity; Phase 5 (`BrudTools`) replaces the lookup with a registry
 * while keeping these constraints attached to each kind.
 */

/** Field cardinality required by the parser for a kind. */
export type FieldRequirement = 'required' | 'optional' | 'absent';

/** Presence expectation a kind has for its targets. */
export type ExistenceExpectation = 'none' | 'must-exist' | 'must-not-exist' | 'absent-is-success';

/** Path role a kind plays. */
export type PathRole = 'file' | 'directory' | 'both' | 'scan-directory' | 'none';

/** Access class of a kind. */
export type OperationGroup = 'mutating' | 'read' | 'terminal' | 'catalog';

/** Constraint row for one kind. */
export interface KindConstraint {
  readonly kind: string;
  readonly group: OperationGroup;
  /** Access used by path validation (A10 protected-path gate). */
  readonly access: 'read' | 'mutate' | 'delete' | 'catalog';
  /** Fields the parser requires before execution. */
  readonly requiredFields: readonly string[];
  /** Fields accepted with a default when absent. */
  readonly optionalFields: readonly string[];
  /** Path-bearing fields and their role. */
  readonly paths: readonly { readonly field: string; readonly role: PathRole }[];
  /** Expectation for the primary target. */
  readonly existence: ExistenceExpectation;
  /** Whether `start_line`/`end_line` are honoured. */
  readonly supportsLineRange: boolean;
  /** Whether the kind is subject to the read batch governor. */
  readonly subjectToBatchLimit: boolean;
  /** Whether every command must pass the command scanner. */
  readonly scansCommands: boolean;
}

const FILE_PATH: readonly { readonly field: string; readonly role: PathRole }[] = [
  { field: 'path', role: 'file' },
];

const FROM_TO: readonly { readonly field: string; readonly role: PathRole }[] = [
  { field: 'from', role: 'file' },
  { field: 'to', role: 'file' },
];

const DIRECTORY_PATH: readonly { readonly field: string; readonly role: PathRole }[] = [
  { field: 'directoryPath', role: 'directory' },
];

const SCAN_DIRECTORY: readonly { readonly field: string; readonly role: PathRole }[] = [
  { field: 'directory', role: 'scan-directory' },
];

const PATTERN_OPTIONALS = ['excludePatterns', 'directory', 'maxResults', 'recursive'] as const;

/**
 * Constraint matrix for the 21 catalogued kinds, in the canonical order.
 *
 * The order is the legacy `KNOWN_OPERATIONS` / `KNOWN_TOOLS` sequence so any
 * order-sensitive consumer (catalog listing, tool guide) is byte-compatible.
 */
export const KIND_CONSTRAINTS: readonly KindConstraint[] = Object.freeze([
  {
    kind: 'search_replace',
    group: 'mutating',
    access: 'mutate',
    requiredFields: ['path', 'search', 'replace', 'index'],
    optionalFields: [],
    paths: FILE_PATH,
    existence: 'must-exist',
    supportsLineRange: false,
    subjectToBatchLimit: false,
    scansCommands: false,
  },
  {
    kind: 'create_file',
    group: 'mutating',
    access: 'mutate',
    requiredFields: ['path', 'content', 'index'],
    optionalFields: [],
    paths: FILE_PATH,
    existence: 'must-not-exist',
    supportsLineRange: false,
    subjectToBatchLimit: false,
    scansCommands: false,
  },
  {
    kind: 'delete_file',
    group: 'mutating',
    access: 'delete',
    requiredFields: ['path', 'index'],
    optionalFields: [],
    paths: FILE_PATH,
    existence: 'absent-is-success',
    supportsLineRange: false,
    subjectToBatchLimit: false,
    scansCommands: false,
  },
  {
    kind: 'rename_file',
    group: 'mutating',
    access: 'mutate',
    requiredFields: ['from', 'to', 'index'],
    optionalFields: [],
    paths: FROM_TO,
    existence: 'must-exist',
    supportsLineRange: false,
    subjectToBatchLimit: false,
    scansCommands: false,
  },
  {
    kind: 'move_file',
    group: 'mutating',
    access: 'mutate',
    requiredFields: ['from', 'to', 'index'],
    optionalFields: [],
    paths: FROM_TO,
    existence: 'must-exist',
    supportsLineRange: false,
    subjectToBatchLimit: false,
    scansCommands: false,
  },
  {
    kind: 'copy_file',
    group: 'mutating',
    access: 'mutate',
    requiredFields: ['from', 'to', 'index'],
    optionalFields: [],
    paths: FROM_TO,
    existence: 'must-exist',
    supportsLineRange: false,
    subjectToBatchLimit: false,
    scansCommands: false,
  },
  {
    kind: 'append_file',
    group: 'mutating',
    access: 'mutate',
    requiredFields: ['path', 'content', 'index'],
    optionalFields: ['position'],
    paths: FILE_PATH,
    existence: 'must-exist',
    supportsLineRange: false,
    subjectToBatchLimit: false,
    scansCommands: false,
  },
  {
    kind: 'append_file_multi',
    group: 'mutating',
    access: 'mutate',
    requiredFields: ['patterns', 'content', 'index'],
    optionalFields: [...PATTERN_OPTIONALS, 'position'],
    paths: SCAN_DIRECTORY,
    existence: 'must-exist',
    supportsLineRange: false,
    subjectToBatchLimit: false,
    scansCommands: false,
  },
  {
    kind: 'search_replace_multi',
    group: 'mutating',
    access: 'mutate',
    requiredFields: ['patterns', 'search', 'replace', 'index'],
    optionalFields: [...PATTERN_OPTIONALS],
    paths: SCAN_DIRECTORY,
    existence: 'must-exist',
    supportsLineRange: false,
    subjectToBatchLimit: false,
    scansCommands: false,
  },
  {
    kind: 'create_directory',
    group: 'mutating',
    access: 'mutate',
    requiredFields: ['directoryPath', 'index'],
    optionalFields: ['files'],
    paths: DIRECTORY_PATH,
    existence: 'must-not-exist',
    supportsLineRange: false,
    subjectToBatchLimit: false,
    scansCommands: false,
  },
  {
    kind: 'delete_directory',
    group: 'mutating',
    access: 'delete',
    requiredFields: ['directoryPath', 'index'],
    optionalFields: [],
    paths: DIRECTORY_PATH,
    existence: 'absent-is-success',
    supportsLineRange: false,
    subjectToBatchLimit: false,
    scansCommands: false,
  },
  {
    kind: 'move_directory',
    group: 'mutating',
    access: 'mutate',
    requiredFields: ['from', 'to', 'index'],
    optionalFields: [],
    paths: [
      { field: 'from', role: 'directory' },
      { field: 'to', role: 'directory' },
    ],
    existence: 'must-exist',
    supportsLineRange: false,
    subjectToBatchLimit: false,
    scansCommands: false,
  },
  {
    kind: 'extract_structure',
    group: 'read',
    access: 'read',
    requiredFields: ['directoryPath', 'index'],
    optionalFields: ['depth'],
    paths: DIRECTORY_PATH,
    existence: 'must-exist',
    supportsLineRange: false,
    subjectToBatchLimit: false,
    scansCommands: false,
  },
  {
    kind: 'codebase_metadata',
    group: 'read',
    access: 'read',
    requiredFields: ['index'],
    optionalFields: [],
    paths: [],
    existence: 'none',
    supportsLineRange: false,
    subjectToBatchLimit: false,
    scansCommands: false,
  },
  {
    kind: 'search_files',
    group: 'read',
    access: 'read',
    requiredFields: ['patterns', 'index'],
    optionalFields: ['extensions', ...PATTERN_OPTIONALS],
    paths: SCAN_DIRECTORY,
    existence: 'must-exist',
    supportsLineRange: false,
    subjectToBatchLimit: false,
    scansCommands: false,
  },
  {
    kind: 'read_file',
    group: 'read',
    access: 'read',
    requiredFields: ['path', 'index'],
    optionalFields: ['start_line', 'end_line'],
    paths: FILE_PATH,
    existence: 'must-exist',
    supportsLineRange: true,
    subjectToBatchLimit: true,
    scansCommands: false,
  },
  {
    kind: 'read_files',
    group: 'read',
    access: 'read',
    requiredFields: ['patterns', 'index'],
    optionalFields: [...PATTERN_OPTIONALS, 'start_line', 'end_line'],
    paths: SCAN_DIRECTORY,
    existence: 'must-exist',
    supportsLineRange: true,
    subjectToBatchLimit: true,
    scansCommands: false,
  },
  {
    kind: 'read_directory',
    group: 'read',
    access: 'read',
    requiredFields: ['directoryPath', 'index'],
    optionalFields: [...PATTERN_OPTIONALS, 'start_line', 'end_line'],
    paths: DIRECTORY_PATH,
    existence: 'must-exist',
    supportsLineRange: true,
    subjectToBatchLimit: true,
    scansCommands: false,
  },
  {
    kind: 'terminal_interactive',
    group: 'terminal',
    access: 'mutate',
    requiredFields: ['command', 'answers', 'index'],
    optionalFields: ['cwd', 'timeout', 'raw'],
    paths: [{ field: 'cwd', role: 'directory' }],
    existence: 'none',
    supportsLineRange: false,
    subjectToBatchLimit: false,
    scansCommands: true,
  },
  {
    kind: 'terminal_command',
    group: 'terminal',
    access: 'mutate',
    requiredFields: ['index'],
    optionalFields: ['command', 'commands', 'mode', 'stopOnFailure', 'onSuccess', 'onFailure', 'cwd', 'timeout', 'env', 'raw'],
    paths: [{ field: 'cwd', role: 'directory' }],
    existence: 'none',
    supportsLineRange: false,
    subjectToBatchLimit: false,
    scansCommands: true,
  },
  {
    kind: 'get_tool_info',
    group: 'catalog',
    access: 'catalog',
    requiredFields: ['index'],
    optionalFields: ['toolKind'],
    paths: [],
    existence: 'none',
    supportsLineRange: false,
    subjectToBatchLimit: false,
    scansCommands: false,
  },
] satisfies readonly KindConstraint[]);

/** Closed kind vocabulary, in canonical order. */
export const KNOWN_OPERATION_KINDS: readonly string[] = Object.freeze(
  KIND_CONSTRAINTS.map((constraint) => constraint.kind),
);

/** Kind vocabulary as exposed to tools (byte-identical to the legacy list). */
export const KNOWN_TOOL_KINDS: readonly string[] = KNOWN_OPERATION_KINDS;

const CONSTRAINT_BY_KIND = new Map(KIND_CONSTRAINTS.map((constraint) => [constraint.kind, constraint]));

/**
 * Looks up a kind constraint.
 *
 * @param kind - Operation kind.
 */
export function kindConstraint(kind: string): KindConstraint | undefined {
  return CONSTRAINT_BY_KIND.get(kind);
}

/**
 * Reports whether a kind is one of the 21 catalogued kinds.
 *
 * @param kind - Operation kind.
 */
export function isKnownOperationKind(kind: string): boolean {
  return CONSTRAINT_BY_KIND.has(kind);
}

/** Kinds the preview engine supports. */
export const PREVIEW_SUPPORTED_KINDS: readonly string[] = Object.freeze([
  'search_replace',
  'create_file',
  'append_file',
]);

/** Allowed `position` values. */
export const POSITION_VALUES: readonly string[] = Object.freeze(['start', 'end']);

/** Allowed terminal `mode` values. */
export const MODE_VALUES: readonly string[] = Object.freeze(['sequential', 'parallel']);
