import type { CommandRule, InputRule, PolicyRule } from '../contracts/rules.js';
import type { ValidationPolicy } from '../contracts/IValidationService.js';
import type { ValidationCode } from '../contracts/errors.js';
import {
  KIND_CONSTRAINTS,
  MODE_VALUES,
  POSITION_VALUES,
  PREVIEW_SUPPORTED_KINDS,
  isKnownOperationKind,
  kindConstraint,
} from './kindMatrix.js';
import { computeLineRange } from './lineRange.js';

/**
 * Field, parameter, line-range and limit validator for the 21 kinds.
 *
 * The engine is pure: it never touches the filesystem, so it can run before a
 * handler is selected. Filesystem-dependent rules (`INPUT.SEARCH_NOT_FOUND`,
 * `INPUT.MULTIPLE_MATCHES`, `INPUT.LINE_RANGE`, `INPUT.BATCH_LIMIT`) are
 * expressed as helpers that take the already-read content or file count, which
 * lets both the legacy facade and the read engine call them.
 */

/** One schema failure. */
export interface SchemaFailure {
  readonly rule: InputRule | CommandRule | PolicyRule;
  readonly field?: string;
  readonly reason: string;
  /** Interpolation values for the metadata member-check templates. */
  readonly values?: {
    readonly wrapper?: string;
    readonly index?: string;
    readonly field?: string;
  };
}

/** Metadata member-check rules, one per legacy `E_*` parser code. */
export type MetadataRule = Extract<InputRule, 'INPUT.METADATA_WRONG_CASE'
  | 'INPUT.DUPLICATE_SESSION_METADATA'
  | 'INPUT.DUPLICATE_OPERATION_METADATA'
  | 'INPUT.METADATA_FIELD_CASE'
  | 'INPUT.METADATA_UNKNOWN_FIELD'
  | 'INPUT.SESSION_METADATA_POSITION'
  | 'INPUT.OPERATION_METADATA_POSITION'
  | 'INPUT.METADATA_UNCLOSED'>;

/**
 * Metadata rule → legacy parser code.
 *
 * The kernel keeps the structured rule; the boundary emits the legacy code the
 * parser has always thrown, so a caller can still branch on the exact failure
 * (audit §2.3, F-3).
 */
export const METADATA_RULE_CODES: Readonly<Record<MetadataRule, Extract<ValidationCode, `E_${string}`>>> =
  Object.freeze({
    'INPUT.METADATA_WRONG_CASE': 'E_METADATA_WRONG_CASE',
    'INPUT.DUPLICATE_SESSION_METADATA': 'E_DUPLICATE_SESSION_METADATA',
    'INPUT.DUPLICATE_OPERATION_METADATA': 'E_DUPLICATE_OPERATION_METADATA',
    'INPUT.METADATA_FIELD_CASE': 'E_METADATA_FIELD_CASE',
    'INPUT.METADATA_UNKNOWN_FIELD': 'E_METADATA_UNKNOWN_FIELD',
    'INPUT.SESSION_METADATA_POSITION': 'E_SESSION_METADATA_POSITION',
    'INPUT.OPERATION_METADATA_POSITION': 'E_OPERATION_METADATA_POSITION',
    'INPUT.METADATA_UNCLOSED': 'E_METADATA_UNCLOSED',
  });

/** Schema evaluation result. */
export type SchemaOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: SchemaFailure };

/** Context accepted by {@link InputSchemaEngine.validate}. */
export interface InputValidationContext {
  /** Operation kind. */
  readonly kind: string;

  /** Operation payload. */
  readonly input: unknown;

  /** Whether the host can execute terminal commands. */
  readonly terminalAvailable?: boolean;
}

const OK: SchemaOutcome = Object.freeze({ ok: true });

function failure(
  rule: InputRule | CommandRule | PolicyRule,
  reason: string,
  field?: string,
  values?: SchemaFailure['values'],
): SchemaOutcome {
  return {
    ok: false,
    failure: {
      rule,
      reason,
      ...(field === undefined ? {} : { field }),
      ...(values === undefined ? {} : { values }),
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Fields whose empty string is meaningful (`content`, `search`, `replace`). */
const EMPTY_STRING_FIELDS = new Set(['content', 'search', 'replace', 'command']);

function presentField(field: string, value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  return EMPTY_STRING_FIELDS.has(field) || value !== '';
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/**
 * Validator for kind-specific input shape and limits.
 */
export class InputSchemaEngine {
  private readonly policy: ValidationPolicy;

  /**
   * @param policy - Frozen policy supplying the tool allowlist and limits.
   */
  constructor(policy: ValidationPolicy) {
    this.policy = policy;
  }

  /**
   * Reports whether a kind is catalogued.
   *
   * @param kind - Operation kind.
   */
  isKnownOperation(kind: string): boolean {
    return isKnownOperationKind(kind);
  }

  /**
   * Membership test for `validate.knownOperation`.
   *
   * Legacy parity: the pre-Phase-3 boundary asked only whether the kind is
   * catalogued and never inspected its payload, so a known kind always
   * succeeds here even when its mandatory fields are absent (audit F-1).
   *
   * @param kind - Operation kind.
   */
  checkKnownOperation(kind: unknown): SchemaOutcome {
    return typeof kind === 'string' && isKnownOperationKind(kind)
      ? OK
      : failure('INPUT.UNKNOWN_OPERATION', `operation "${String(kind)}" is not supported`, 'operation');
  }

  /**
   * Membership test for `validate.knownTool`.
   *
   * Emits `INPUT.UNKNOWN_TOOL`, which the boundary maps to `TOOL_NOT_FOUND`
   * (audit F-2). Never checks payload fields.
   *
   * @param toolKind - Tool kind.
   */
  checkKnownTool(toolKind: unknown): SchemaOutcome {
    return typeof toolKind === 'string' && isKnownOperationKind(toolKind)
      ? OK
      : failure('INPUT.UNKNOWN_TOOL', `tool "${String(toolKind)}" does not exist`, 'toolKind');
  }

  /**
   * Reports whether the allowlist disables a kind.
   *
   * Missing keys default to enabled, matching the audited semantics.
   *
   * @param kind - Operation kind.
   */
  isToolEnabled(kind: string): boolean {
    return this.policy.toolAllowList[kind] !== false;
  }

  /**
   * Reports whether a payload has a non-blank index.
   *
   * @param input - Operation payload.
   */
  hasIndex(input: unknown): boolean {
    if (!isPlainObject(input)) {
      return false;
    }

    const index = input['index'];

    return typeof index === 'string' && index.trim().length > 0;
  }

  /**
   * Reports whether required fields are present and optional enums valid.
   *
   * @param kind - Operation kind.
   * @param input - Operation payload.
   */
  checkFields(kind: string, input: unknown): SchemaOutcome {
    const constraint = kindConstraint(kind);

    if (constraint === undefined) {
      return failure('INPUT.UNKNOWN_OPERATION', `operation "${kind}" is not supported`, 'operation');
    }

    if (!isPlainObject(input)) {
      return failure('INPUT.MISSING_FIELD', `the ${kind} payload must be an object`);
    }

    for (const field of constraint.requiredFields) {
      if (field === 'index') {
        if (!this.hasIndex(input)) {
          return failure('INPUT.MISSING_INDEX', 'no index was supplied with the instruction', 'index');
        }

        continue;
      }

      if (kind === 'terminal_command' && (field === 'command' || field === 'commands')) {
        continue;
      }

      if (!presentField(field, input[field])) {
        return failure('INPUT.MISSING_FIELD', `the field "${field}" is required in ${kind} operation`, field);
      }
    }

    const requiresPatterns = constraint.requiredFields.includes('patterns');

    if (requiresPatterns && !this.hasPatterns(input['patterns'])) {
      return failure('INPUT.EMPTY_PATTERNS', 'the field "patterns" must be a non-empty array', 'patterns');
    }

    if (kind === 'append_file_multi' || kind === 'append_file') {
      const position = input['position'];

      if (position !== undefined && !POSITION_VALUES.includes(String(position))) {
        return failure(
          'INPUT.INVALID_POSITION',
          `Position must be 'start' or 'end', got '${String(position)}'`,
          'position',
        );
      }
    }

    if (kind === 'terminal_command') {
      return this.checkTerminalCommandPayload(input);
    }

    if (kind === 'terminal_interactive') {
      if (!Array.isArray(input['answers'])) {
        return failure('INPUT.EMPTY_ANSWERS', 'the field "answers" must be an array', 'answers');
      }
    }

    return OK;
  }

  /**
   * Reports whether a patterns array is non-empty.
   *
   * @param patterns - Candidate patterns.
   */
  hasPatterns(patterns: unknown): boolean {
    return Array.isArray(patterns) && patterns.length > 0;
  }

  /**
   * Validates a terminal_command payload (`command` or `commands[]`).
   *
   * @param input - Operation payload.
   */
  checkTerminalCommandPayload(input: unknown): SchemaOutcome {
    if (!isPlainObject(input)) {
      return failure('INPUT.MISSING_FIELD', 'the terminal_command payload must be an object');
    }

    const command = input['command'];
    const commands = input['commands'];
    const hasCommands = Array.isArray(commands) && commands.length > 0;

    if (!present(command) && !hasCommands) {
      return failure(
        'CMD.NO_COMMAND',
        'the field "command or commands" is required in terminal_command operation',
        'command',
      );
    }

    if (commands !== undefined && !Array.isArray(commands)) {
      return failure('INPUT.MISSING_FIELD', 'the field "commands" must be an array', 'commands');
    }

    const mode = input['mode'];

    if (mode !== undefined && !MODE_VALUES.includes(String(mode))) {
      return failure('INPUT.INVALID_MODE', `Mode must be 'sequential' or 'parallel', got '${String(mode)}'`, 'mode');
    }

    return OK;
  }

  /**
   * Validates a terminal execution request before it reaches a handler.
   *
   * @param request - Command(s), mode, answers and availability.
   */
  validateTerminalRequest(request: {
    readonly command?: string;
    readonly commands?: readonly string[];
    readonly mode?: string;
    readonly answers?: readonly string[];
    readonly terminalAvailable: boolean;
  }): SchemaOutcome {
    if (!request.terminalAvailable) {
      return failure('CMD.TERMINAL_UNAVAILABLE', 'the terminal executor is not available');
    }

    if (!present(request.command) && (request.commands === undefined || request.commands.length === 0)) {
      return failure('CMD.NO_COMMAND', 'no command was supplied', 'command');
    }

    if (request.mode !== undefined && !MODE_VALUES.includes(request.mode)) {
      return failure('INPUT.INVALID_MODE', `Mode must be 'sequential' or 'parallel', got '${request.mode}'`, 'mode');
    }

    if (request.answers !== undefined && !Array.isArray(request.answers)) {
      return failure('INPUT.EMPTY_ANSWERS', 'the field "answers" must be an array', 'answers');
    }

    return OK;
  }

  /**
   * Validates a whole operation batch envelope.
   *
   * @param operations - Operation list.
   */
  validateOperations(operations: unknown): SchemaOutcome {
    if (!Array.isArray(operations) || operations.length === 0) {
      return failure('INPUT.EMPTY_OPERATIONS', 'no valid operations found');
    }

    for (const operation of operations) {
      const kind = isPlainObject(operation) ? operation['kind'] : undefined;

      if (typeof kind !== 'string' || !isKnownOperationKind(kind)) {
        return failure('INPUT.UNKNOWN_OPERATION', `operation "${String(kind)}" is not supported`, 'operation');
      }
    }

    return OK;
  }

  /**
   * Reports whether a batch carries an `extract_structure` operation.
   *
   * @param operations - Operation list.
   */
  validateExtractOperations(operations: unknown): SchemaOutcome {
    if (!Array.isArray(operations)) {
      return failure('INPUT.NO_EXTRACT_OPS', 'no extract_structure operations found');
    }

    const found = operations.some((operation) =>
      isPlainObject(operation) && operation['kind'] === 'extract_structure');

    return found
      ? OK
      : failure('INPUT.NO_EXTRACT_OPS', 'no extract_structure operations found');
  }

  /**
   * Validates the legacy block format markers.
   *
   * @param message - Raw message text.
   */
  validateFormat(message: string): SchemaOutcome {
    const hasMarkers = message.includes('<<<<<<<')
      && message.includes('=======')
      && message.includes('>>>>>>>');

    return hasMarkers ? OK : failure('INPUT.PARSE_FORMAT', 'the message does not use a recognised patch format');
  }

  /**
   * Validates that a preview can be produced for a kind.
   *
   * @param kind - Operation kind.
   * @param files - Candidate files.
   */
  validatePreview(kind: string, files: readonly unknown[]): SchemaOutcome {
    if (!PREVIEW_SUPPORTED_KINDS.includes(kind)) {
      return failure('INPUT.PREVIEW_UNSUPPORTED', 'preview is not available for this operation type');
    }

    if (files.length === 0) {
      return failure('INPUT.NO_PREVIEW', 'no preview could be generated for any file');
    }

    return OK;
  }

  /**
   * Validates that exactly one match exists in a file.
   *
   * @param path - File path, for the message only.
   * @param content - File content.
   * @param searchText - Text to locate.
   */
  validateSingleMatch(path: string, content: string, searchText: string): SchemaOutcome {
    const firstIndex = content.indexOf(searchText);

    if (firstIndex === -1) {
      return failure('INPUT.SEARCH_NOT_FOUND', `the text "${searchText}" was not found in "${path}"`);
    }

    if (firstIndex !== content.lastIndexOf(searchText)) {
      return failure('INPUT.MULTIPLE_MATCHES', `multiple matches found in "${path}". Expected a single match.`);
    }

    return OK;
  }

  /**
   * Validates a 1-indexed line range against the total line count.
   *
   * Runs only when a bound is supplied, matching the read engine.
   *
   * @param startLine - Requested start.
   * @param endLine - Requested end.
   * @param totalLines - Line count.
   */
  validateLineRange(
    startLine: number | undefined,
    endLine: number | undefined,
    totalLines: number,
  ): SchemaOutcome {
    if (startLine === undefined && endLine === undefined) {
      return OK;
    }

    return computeLineRange(startLine, endLine, totalLines).ok
      ? OK
      : failure(
        'INPUT.LINE_RANGE',
        `requested line range ${startLine ?? '?'}-${endLine ?? '?'} is invalid for a file with ${totalLines} lines (1-indexed)`,
      );
  }

  /**
   * Validates a read batch against the frozen file-count ceiling.
   *
   * @param requested - Number of files in the batch.
   * @param isImportRead - Import reads are exempt, matching the read engine.
   */
  validateBatchLimit(requested: number, isImportRead = false): SchemaOutcome {
    const limit = this.policy.readMaxBatchFiles;

    if (!isImportRead && requested > limit) {
      return failure(
        'INPUT.BATCH_LIMIT',
        `requested ${requested} files; the limit is ${limit} per batch`,
      );
    }

    return OK;
  }

  /**
   * Validates a read batch's aggregate byte footprint.
   *
   * @param totalBytes - Bytes the batch would admit.
   */
  validateAggregateBytes(totalBytes: number): SchemaOutcome {
    const limit = this.policy.readMaxAggregateBytes;

    if (totalBytes > limit) {
      return failure(
        'POLICY.AGGREGATE_BYTES',
        `the batch admits ${totalBytes} bytes; the limit is ${limit} bytes`,
      );
    }

    return OK;
  }

  /**
   * Validates a session lookup result.
   *
   * @param sessionId - Requested session.
   * @param session - Resolved session, or `undefined`.
   */
  validateSession(sessionId: string, session: unknown): SchemaOutcome {
    return session === undefined || session === null
      ? failure('INPUT.SESSION_MISSING', `the session "${sessionId}" does not exist in history`)
      : OK;
  }

  /**
   * Validates a revert request.
   *
   * @param sessionId - Target session.
   * @param targetState - Target state label.
   */
  validateRevertRequest(sessionId: string | undefined, targetState: string | undefined): SchemaOutcome {
    return present(sessionId) && present(targetState)
      ? OK
      : failure('INPUT.REVERT_REQUEST', 'cannot revert without sessionId and targetState');
  }

  /**
   * Validates a write/delete target against its actual entry kind.
   *
   * @param kind - Operation kind.
   * @param target - Entry kind at the target, when it exists.
   */
  validateTargetKind(kind: string, target: 'file' | 'directory' | 'absent'): SchemaOutcome {
    const writesFile = kind === 'create_file'
      || kind === 'search_replace'
      || kind === 'append_file';

    if (writesFile && target === 'directory') {
      return failure('INPUT.TARGET_KIND', 'cannot write to a directory');
    }

    if (kind === 'delete_file' && target === 'directory') {
      return failure('INPUT.TARGET_KIND', 'cannot delete a directory as a file');
    }

    return OK;
  }

  /**
   * Runs a single metadata member check.
   *
   * The legacy metadata parser performs these in sequence (wrapper case,
   * duplicates, position, field case, unknown field, then termination). The
   * validator exposes each step separately so the caller keeps the parser's
   * ordering, while the failure carries both the structured rule id and the
   * legacy `E_*` code (audit §2.3).
   *
   * @param rule - Metadata rule to report.
   * @param values - Wrapper name, operation index or offending field.
   * @param reason - Explanation surfaced verbatim by the boundary.
   */
  checkMetadata(rule: MetadataRule, values?: SchemaFailure['values'], reason?: string): SchemaOutcome {
    return failure(rule, reason ?? rule, undefined, values);
  }

  /**
   * Runs every payload-level check for a kind.
   *
   * @param context - Kind, payload and terminal availability.
   */
  validate(context: InputValidationContext): SchemaOutcome {
    if (!isKnownOperationKind(context.kind)) {
      return failure('INPUT.UNKNOWN_OPERATION', `operation "${context.kind}" is not supported`, 'operation');
    }

    if (!this.isToolEnabled(context.kind)) {
      return failure('INPUT.TOOL_DISABLED', `the tool "${context.kind}" has been disabled in settings`, 'kind');
    }

    if (kindConstraint(context.kind)?.scansCommands === true && context.terminalAvailable === false) {
      return failure('CMD.TERMINAL_UNAVAILABLE', 'the terminal executor is not available');
    }

    return this.checkFields(context.kind, context.input);
  }
}
