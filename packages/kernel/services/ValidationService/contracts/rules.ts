/**
 * Canonical rule vocabulary for `brud.core.validation`.
 *
 * Every rule id is `<CATEGORY>.<NAME>` and is stable: telemetry, the legacy
 * facade and the parity matrix key off these strings. The inventory is the
 * audited catalogue reconciled by W-3: the dead `CMD.CD_ESCAPE`/`CMD.CD_DYNAMIC`
 * aliases are folded into their `PATH.*` owners, the eight metadata member
 * checks replace the monolithic `INPUT.METADATA_INVALID`, and
 * `POLICY.READ_CONCURRENCY` is promoted from a governor note to a rule.
 * `VALIDATION_RULE_COUNT` is the single authority for the total.
 */

/** Path and workspace containment rules. */
export type PathRule =
  | 'PATH.NULL_BYTE'
  | 'PATH.UNC_OR_DEVICE'
  | 'PATH.DRIVE_QUALIFIED'
  | 'PATH.DRIVE_RELATIVE'
  | 'PATH.ABSOLUTE'
  | 'PATH.PARENT_SEGMENT'
  | 'PATH.WIN_TRAILING_DOT_OR_SPACE'
  | 'PATH.WIN_TRAILING_ALIAS_TRAVERSAL'
  | 'PATH.WIN_RESERVED_DEVICE'
  | 'PATH.WIN_ALT_DATA_STREAM'
  | 'PATH.OUTSIDE_ROOT'
  | 'PATH.SIBLING_PREFIX'
  | 'PATH.SYMLINK_ESCAPE'
  | 'PATH.UNVERIFIABLE_LINEAGE'
  | 'PATH.AMBIGUOUS_ROOT'
  | 'PATH.UNKNOWN_ROOT'
  | 'PATH.INVALID_ROOT'
  | 'PATH.NO_WORKSPACE'
  | 'PATH.PROTECTED_DENY'
  | 'PATH.ROOT_NOT_MUTABLE'
  | 'PATH.CWD_ESCAPE'
  | 'PATH.CWD_DYNAMIC'
  | 'PATH.CWD_INVALID'
  | 'PATH.LISTING_OUTSIDE'
  | 'PATH.NON_STRING';

/** Dangerous-command and terminal rules. */
export type CommandRule =
  | 'CMD.RM_ROOT'
  | 'CMD.RM_GLOB'
  | 'CMD.PRIVILEGE'
  | 'CMD.DISK'
  | 'CMD.PIPE_SHELL'
  | 'CMD.PERMISSION_WIDEN'
  | 'CMD.DEVICE_REDIRECT'
  | 'CMD.FORK_BOMB'
  | 'CMD.FORCED_PKG'
  | 'CMD.TERMINAL_UNAVAILABLE'
  | 'CMD.NO_COMMAND';

/** Input shape, kind, field and resource-limit rules. */
export type InputRule =
  | 'INPUT.UNKNOWN_OPERATION'
  | 'INPUT.UNKNOWN_TOOL'
  | 'INPUT.TOOL_DISABLED'
  | 'INPUT.MISSING_FIELD'
  | 'INPUT.MISSING_INDEX'
  | 'INPUT.INVALID_POSITION'
  | 'INPUT.INVALID_MODE'
  | 'INPUT.EMPTY_PATTERNS'
  | 'INPUT.EMPTY_ANSWERS'
  | 'INPUT.EMPTY_OPERATIONS'
  | 'INPUT.NO_EXTRACT_OPS'
  | 'INPUT.PARSE_FORMAT'
  | 'INPUT.LINE_RANGE'
  | 'INPUT.BATCH_LIMIT'
  | 'INPUT.PREVIEW_UNSUPPORTED'
  | 'INPUT.NO_PREVIEW'
  | 'INPUT.SEARCH_NOT_FOUND'
  | 'INPUT.MULTIPLE_MATCHES'
  | 'INPUT.TARGET_KIND'
  | 'INPUT.READ_ONLY_PROJECTION'
  | 'INPUT.SESSION_MISSING'
  | 'INPUT.REVERT_REQUEST'
  | 'INPUT.METADATA_WRONG_CASE'
  | 'INPUT.DUPLICATE_SESSION_METADATA'
  | 'INPUT.DUPLICATE_OPERATION_METADATA'
  | 'INPUT.METADATA_FIELD_CASE'
  | 'INPUT.METADATA_UNKNOWN_FIELD'
  | 'INPUT.SESSION_METADATA_POSITION'
  | 'INPUT.OPERATION_METADATA_POSITION'
  | 'INPUT.METADATA_UNCLOSED';

/** Frozen-policy state and resource-governor rules. */
export type PolicyRule =
  | 'POLICY.BOUNDARY_DISABLED'
  | 'POLICY.COMMAND_VALIDATION_DISABLED'
  | 'POLICY.PER_CALL_OVERRIDE'
  | 'POLICY.SAFETY_LOOSENING'
  | 'POLICY.MID_SESSION_LOOSENING'
  | 'POLICY.VALUE_CLAMPED'
  | 'POLICY.READ_CONCURRENCY'
  | 'POLICY.AGGREGATE_BYTES';

/** Every rule id the validation service may emit. */
export type ValidationRule = PathRule | CommandRule | InputRule | PolicyRule;

/** Rule category prefix. */
export type RuleCategory = 'PATH' | 'CMD' | 'INPUT' | 'POLICY';

const PATH_RULES: readonly PathRule[] = Object.freeze([
  'PATH.NULL_BYTE',
  'PATH.UNC_OR_DEVICE',
  'PATH.DRIVE_QUALIFIED',
  'PATH.DRIVE_RELATIVE',
  'PATH.ABSOLUTE',
  'PATH.PARENT_SEGMENT',
  'PATH.WIN_TRAILING_DOT_OR_SPACE',
  'PATH.WIN_TRAILING_ALIAS_TRAVERSAL',
  'PATH.WIN_RESERVED_DEVICE',
  'PATH.WIN_ALT_DATA_STREAM',
  'PATH.OUTSIDE_ROOT',
  'PATH.SIBLING_PREFIX',
  'PATH.SYMLINK_ESCAPE',
  'PATH.UNVERIFIABLE_LINEAGE',
  'PATH.AMBIGUOUS_ROOT',
  'PATH.UNKNOWN_ROOT',
  'PATH.INVALID_ROOT',
  'PATH.NO_WORKSPACE',
  'PATH.PROTECTED_DENY',
  'PATH.ROOT_NOT_MUTABLE',
  'PATH.CWD_ESCAPE',
  'PATH.CWD_DYNAMIC',
  'PATH.CWD_INVALID',
  'PATH.LISTING_OUTSIDE',
  'PATH.NON_STRING',
] satisfies readonly PathRule[]);

const COMMAND_RULES: readonly CommandRule[] = Object.freeze([
  'CMD.RM_ROOT',
  'CMD.RM_GLOB',
  'CMD.PRIVILEGE',
  'CMD.DISK',
  'CMD.PIPE_SHELL',
  'CMD.PERMISSION_WIDEN',
  'CMD.DEVICE_REDIRECT',
  'CMD.FORK_BOMB',
  'CMD.FORCED_PKG',
  'CMD.TERMINAL_UNAVAILABLE',
  'CMD.NO_COMMAND',
] satisfies readonly CommandRule[]);

const INPUT_RULES: readonly InputRule[] = Object.freeze([
  'INPUT.UNKNOWN_OPERATION',
  'INPUT.UNKNOWN_TOOL',
  'INPUT.TOOL_DISABLED',
  'INPUT.MISSING_FIELD',
  'INPUT.MISSING_INDEX',
  'INPUT.INVALID_POSITION',
  'INPUT.INVALID_MODE',
  'INPUT.EMPTY_PATTERNS',
  'INPUT.EMPTY_ANSWERS',
  'INPUT.EMPTY_OPERATIONS',
  'INPUT.NO_EXTRACT_OPS',
  'INPUT.PARSE_FORMAT',
  'INPUT.LINE_RANGE',
  'INPUT.BATCH_LIMIT',
  'INPUT.PREVIEW_UNSUPPORTED',
  'INPUT.NO_PREVIEW',
  'INPUT.SEARCH_NOT_FOUND',
  'INPUT.MULTIPLE_MATCHES',
  'INPUT.TARGET_KIND',
  'INPUT.READ_ONLY_PROJECTION',
  'INPUT.SESSION_MISSING',
  'INPUT.REVERT_REQUEST',
  'INPUT.METADATA_WRONG_CASE',
  'INPUT.DUPLICATE_SESSION_METADATA',
  'INPUT.DUPLICATE_OPERATION_METADATA',
  'INPUT.METADATA_FIELD_CASE',
  'INPUT.METADATA_UNKNOWN_FIELD',
  'INPUT.SESSION_METADATA_POSITION',
  'INPUT.OPERATION_METADATA_POSITION',
  'INPUT.METADATA_UNCLOSED',
] satisfies readonly InputRule[]);

const POLICY_RULES: readonly PolicyRule[] = Object.freeze([
  'POLICY.BOUNDARY_DISABLED',
  'POLICY.COMMAND_VALIDATION_DISABLED',
  'POLICY.PER_CALL_OVERRIDE',
  'POLICY.SAFETY_LOOSENING',
  'POLICY.MID_SESSION_LOOSENING',
  'POLICY.VALUE_CLAMPED',
  'POLICY.READ_CONCURRENCY',
  'POLICY.AGGREGATE_BYTES',
] satisfies readonly PolicyRule[]);

/** Every rule id, grouped by category. */
export const VALIDATION_RULES: Readonly<Record<RuleCategory, readonly ValidationRule[]>> =
  Object.freeze({
    PATH: PATH_RULES,
    CMD: COMMAND_RULES,
    INPUT: INPUT_RULES,
    POLICY: POLICY_RULES,
  });

/** Flat list of every rule id. */
export const ALL_VALIDATION_RULES: readonly ValidationRule[] = Object.freeze([
  ...PATH_RULES,
  ...COMMAND_RULES,
  ...INPUT_RULES,
  ...POLICY_RULES,
]);

/**
 * Total catalogued rule count.
 *
 * 74 = 25 `PATH.*` + 11 `CMD.*` + 30 `INPUT.*` + 8 `POLICY.*`.
 */
export const VALIDATION_RULE_COUNT = ALL_VALIDATION_RULES.length;

/**
 * Extracts the category prefix of a rule id.
 *
 * @param rule - Rule id to classify.
 */
export function ruleCategory(rule: ValidationRule): RuleCategory {
  return rule.slice(0, rule.indexOf('.')) as RuleCategory;
}
