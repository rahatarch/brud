import type { IServiceLifecycle } from '../../../src/contracts/lifecycle.js';
import type {
  IValidationService,
  RuleTraits,
  ValidationEnvironment,
  ValidationPolicy,
  ValidationWorkspacePort,
} from '../contracts/IValidationService.js';
import type { PathRule, ValidationRule } from '../contracts/rules.js';
import type { ValidationCode, ValidationDecision } from '../contracts/errors.js';
import { VALIDATION_OK, validationFailure } from '../contracts/errors.js';
import { CommandScannerEngine } from '../engine/CommandScannerEngine.js';
import type { CommandChainOutcome } from '../engine/CommandScannerEngine.js';
import { InputSchemaEngine, METADATA_RULE_CODES } from '../engine/InputSchemaEngine.js';
import type { MetadataRule, SchemaOutcome, SchemaFailure } from '../engine/InputSchemaEngine.js';
import { PathEvaluationEngine } from '../engine/PathEvaluationEngine.js';
import { PolicyGateEngine } from '../engine/PolicyGateEngine.js';
import { legacyMessages, ruleTraits } from '../engine/errorCatalog.js';
import { kindConstraint } from '../engine/kindMatrix.js';

/** Construction options for {@link ValidationService}. */
export interface ValidationServiceOptions {
  /** Boot policy, frozen at construction. */
  readonly policy: ValidationPolicy;
  /** Canonical workspace authority. */
  readonly workspace: ValidationWorkspacePort;
  /** Home directory and path flavor for command scanning. */
  readonly environment: ValidationEnvironment;
}

/** Service made available to the kernel while the boot snapshot is pinned. */
export interface PinnableValidationService {
  /**
   * Resolves the boot dependencies and freezes the policy.
   *
   * Called by the kernel composition while it still holds the license to read
   * other services; afterwards the instance is fully authoritative.
   *
   * @param dependencies - Settings snapshot and workspace authority.
   */
  pinBootPolicy(dependencies: ValidationBootDependencies): Promise<void>;
}

/** Boot-time dependency inputs used by {@link PinnableValidationService}. */
export interface ValidationBootDependencies {
  readonly policy: ValidationPolicy;
  readonly workspace: ValidationWorkspacePort;
}

/**
 * Kernel path-rule → kernel code and legacy boundary code.
 *
 * This is the Appendix C mapping with the audit's six corrections applied
 * (`PROTECTED_PATH_DENIED`, `INVALID_INPUT`, `CANNOT_WRITE_DIRECTORY`,
 * `CANNOT_DELETE_DIRECTORY`, `COMMITTED_WITH_DURABILITY_WARNING`) plus the
 * `EXECUTION_ERROR` → `UNEXPECTED_ERROR` correction, so there is exactly one
 * table deciding what a legacy caller sees.
 */

/** A `cd`-family token anywhere in a command. */
const CD_TOKEN_PATTERN = /(?:^|[\s;&|(])(?:cd|pushd|chdir)(?:\s|$)/u;

const PATH_BOUNDARY_CODE: Readonly<Record<PathRule, { readonly code: ValidationCode; readonly legacy: string }>> =
  Object.freeze({
    'PATH.NULL_BYTE': { code: 'PATH_TRAVERSAL_DETECTED', legacy: 'VALIDATION_ERROR' },
    'PATH.UNC_OR_DEVICE': { code: 'PATH_TRAVERSAL_DETECTED', legacy: 'PATH_OUTSIDE_WORKSPACE' },
    'PATH.DRIVE_QUALIFIED': { code: 'PATH_TRAVERSAL_DETECTED', legacy: 'PATH_OUTSIDE_WORKSPACE' },
    'PATH.DRIVE_RELATIVE': { code: 'PATH_TRAVERSAL_DETECTED', legacy: 'PATH_OUTSIDE_WORKSPACE' },
    'PATH.ABSOLUTE': { code: 'PATH_TRAVERSAL_DETECTED', legacy: 'PATH_OUTSIDE_WORKSPACE' },
    'PATH.PARENT_SEGMENT': { code: 'PATH_TRAVERSAL_DETECTED', legacy: 'PATH_OUTSIDE_WORKSPACE' },
    'PATH.WIN_TRAILING_DOT_OR_SPACE': { code: 'PATH_TRAVERSAL_DETECTED', legacy: 'PATH_OUTSIDE_WORKSPACE' },
    'PATH.WIN_TRAILING_ALIAS_TRAVERSAL': { code: 'PATH_TRAVERSAL_DETECTED', legacy: 'PATH_OUTSIDE_WORKSPACE' },
    'PATH.WIN_RESERVED_DEVICE': { code: 'PATH_TRAVERSAL_DETECTED', legacy: 'VALIDATION_ERROR' },
    'PATH.WIN_ALT_DATA_STREAM': { code: 'PATH_TRAVERSAL_DETECTED', legacy: 'VALIDATION_ERROR' },
    'PATH.OUTSIDE_ROOT': { code: 'PATH_TRAVERSAL_DETECTED', legacy: 'PATH_OUTSIDE_WORKSPACE' },
    // Appendix C row 3: non-containment `WorkspaceViolationRule` members are
    // not path escapes, so the legacy lexical boundary renders them as
    // `VALIDATION_ERROR` (audit §6.1 / §6.2 W-10).
    'PATH.SIBLING_PREFIX': { code: 'PATH_TRAVERSAL_DETECTED', legacy: 'VALIDATION_ERROR' },
    'PATH.SYMLINK_ESCAPE': { code: 'PATH_TRAVERSAL_DETECTED', legacy: 'PATH_OUTSIDE_WORKSPACE' },
    'PATH.UNVERIFIABLE_LINEAGE': { code: 'WORKSPACE_PATH_VIOLATION', legacy: 'VALIDATION_ERROR' },
    'PATH.AMBIGUOUS_ROOT': { code: 'WORKSPACE_PATH_VIOLATION', legacy: 'VALIDATION_ERROR' },
    'PATH.UNKNOWN_ROOT': { code: 'WORKSPACE_PATH_VIOLATION', legacy: 'VALIDATION_ERROR' },
    'PATH.INVALID_ROOT': { code: 'WORKSPACE_CONFIGURATION_INVALID', legacy: 'NO_WORKSPACE' },
    'PATH.NO_WORKSPACE': { code: 'NO_WORKSPACE', legacy: 'NO_WORKSPACE' },
    'PATH.PROTECTED_DENY': { code: 'WORKSPACE_PATH_VIOLATION', legacy: 'VALIDATION_ERROR' },
    'PATH.ROOT_NOT_MUTABLE': { code: 'WORKSPACE_PATH_VIOLATION', legacy: 'VALIDATION_ERROR' },
    'PATH.CWD_ESCAPE': { code: 'CWD_ESCAPE', legacy: 'CWD_ESCAPE' },
    'PATH.CWD_DYNAMIC': { code: 'DYNAMIC_PATH', legacy: 'DYNAMIC_PATH' },
    'PATH.CWD_INVALID': { code: 'INVALID_CWD', legacy: 'INVALID_CWD' },
    'PATH.LISTING_OUTSIDE': { code: 'PATH_TRAVERSAL_DETECTED', legacy: 'PATH_OUTSIDE_WORKSPACE' },
    'PATH.NON_STRING': { code: 'WORKSPACE_PATH_VIOLATION', legacy: 'VALIDATION_ERROR' },
  });

/** Rules whose legacy rendering is the bare `VALIDATION_ERROR` pair. */
const VALIDATION_ERROR_RULES: ReadonlySet<PathRule> = new Set<PathRule>([
  'PATH.PROTECTED_DENY',
  'PATH.ROOT_NOT_MUTABLE',
  'PATH.SIBLING_PREFIX',
  'PATH.UNVERIFIABLE_LINEAGE',
  'PATH.AMBIGUOUS_ROOT',
  'PATH.UNKNOWN_ROOT',
  'PATH.NON_STRING',
]);

/**
 * Single frozen pre-execution gate for paths, commands and tool inputs.
 *
 * Policy is read from the boot snapshot exactly once (see
 * {@link PolicyGateEngine}); this class never accepts a per-call override and
 * never subscribes to settings changes, so an in-flight operation cannot
 * observe a loosened rule between validation and commit.
 *
 * Public methods never throw for invalid input: driver faults propagate, rule
 * violations become {@link ValidationDecision} failures.
 */
export class ValidationService implements IValidationService, IServiceLifecycle, PinnableValidationService {
  private gate!: PolicyGateEngine;

  private schema!: InputSchemaEngine;

  private paths!: PathEvaluationEngine;

  private commands!: CommandScannerEngine;

  private readonly pinnedOptions: ValidationServiceOptions;

  /**
   * @param options - Boot policy, workspace authority and environment.
   */
  constructor(options: ValidationServiceOptions) {
    this.pinnedOptions = options;
    this.freeze(options.policy, options.workspace, options.environment);
  }

  /**
   * Rebinds the service to the real boot dependencies.
   *
   * Boot-time composition constructs the service before the workspace and
   * settings services can be read (the access broker only serves while the
   * kernel is RUNNING). The composition globally pauses access checks, reads
   * the boot snapshot exactly once through this method, and resumes; the
   * frozen policy therefore exists before any caller can resolve the token.
   *
   * @param dependencies - Boot snapshot and workspace authority.
   */
  async pinBootPolicy(dependencies: ValidationBootDependencies): Promise<void> {
    this.freeze(dependencies.policy, dependencies.workspace, this.pinnedOptions.environment);
  }

  /** Policy the instance currently enforces. */
  getPolicy(): ValidationPolicy {
    return this.gate.policy;
  }

  /** Lifecycle no-op: policy is frozen in the constructor. */
  async initialize(): Promise<void> {
    return undefined;
  }

  /** Lifecycle no-op. */
  async dispose(): Promise<void> {
    return undefined;
  }

  /** Retryability and actionability metadata for a rule. */
  describeRule(rule: ValidationRule): RuleTraits {
    return ruleTraits(rule);
  }

  async validatePath(input: string, operationKind?: string): Promise<ValidationDecision> {
    return this.pathDecision(await this.paths.evaluate(input, operationKind), input, operationKind);
  }

  private pathDecision(
    evaluation: Awaited<ReturnType<PathEvaluationEngine['evaluate']>>,
    input: string,
    operationKind?: string,
  ): ValidationDecision {
    if (evaluation.ok) {
      return VALIDATION_OK;
    }

    const boundary = PATH_BOUNDARY_CODE[evaluation.rule];
    const traits = ruleTraits(evaluation.rule);

    if (evaluation.rule === 'PATH.NO_WORKSPACE') {
      const messages = legacyMessages('NO_WORKSPACE');

      return this.failure({
        code: 'NO_WORKSPACE',
        rule: evaluation.rule,
        legacyCode: 'NO_WORKSPACE',
        messages,
        operationKind,
        traits,
      });
    }

    if (boundary.legacy === 'VALIDATION_ERROR') {
      // Appendix C row 2: lexical integrity failures surface as
      // `VALIDATION_ERROR` with the violated rule appended to the details.
      return this.failure({
        code: boundary.code,
        rule: evaluation.rule,
        legacyCode: 'VALIDATION_ERROR',
        messages: {
          friendly: evaluation.reason,
          details: `${evaluation.reason} (rule ${evaluation.rule})`,
        },
        path: input,
        operationKind,
        traits,
      });
    }

    if (VALIDATION_ERROR_RULES.has(evaluation.rule)) {
      return this.failure({
        code: boundary.code,
        rule: evaluation.rule,
        legacyCode: 'VALIDATION_ERROR',
        messages: { friendly: evaluation.reason, details: evaluation.reason },
        path: input,
        operationKind,
        traits,
      });
    }

    return this.failure({
      code: boundary.code,
      rule: evaluation.rule,
      legacyCode: boundary.legacy,
      messages: this.pathMessages(boundary.code, input, evaluation.reason, evaluation.rule),
      path: input,
      operationKind,
      traits,
    });
  }

  /**
   * Synchronous path validation.
   *
   * Exists for the legacy synchronous boundary (`BrudAPI.validate.path`),
   * which cannot await. It runs the same engines and the same mapping as
   * {@link validatePath}; only the containment proof is lexical rather than
   * `realpath`-based.
   *
   * @param input - Absolute or workspace-relative path.
   * @param operationKind - Operation kind.
   */
  validatePathSync(input: string, operationKind?: string): ValidationDecision {
    return this.pathDecision(this.paths.evaluateSync(input, operationKind), input, operationKind);
  }

  validateCommand(command: string, cwd?: string): ValidationDecision {
    if (typeof command !== 'string') {
      return this.failure({
        code: 'MISSING_FIELD',
        rule: 'CMD.NO_COMMAND',
        legacyCode: 'MISSING_FIELD',
        messages: legacyMessages('MISSING_FIELD', { field: 'command' }),
        traits: ruleTraits('CMD.NO_COMMAND'),
      });
    }

    if (command.trim().length === 0) {
      return this.failure({
        code: 'MISSING_FIELD',
        rule: 'CMD.NO_COMMAND',
        legacyCode: 'MISSING_FIELD',
        messages: legacyMessages('MISSING_FIELD', { field: 'command or commands' }),
        traits: ruleTraits('CMD.NO_COMMAND'),
      });
    }

    if (cwd !== undefined && cwd.trim().length > 0) {
      const resolved = this.commands.resolveCwd(cwd);

      if (resolved === null) {
        return this.failure({
          code: 'INVALID_CWD',
          rule: 'PATH.CWD_INVALID',
          legacyCode: 'INVALID_CWD',
          messages: legacyMessages('INVALID_CWD', { path: cwd }),
          path: cwd,
          traits: ruleTraits('PATH.CWD_INVALID'),
        });
      }
    }

    if (this.gate.commandValidationEnabled) {
      const match = this.commands.scan(command);

      if (match !== null) {
        return this.failure({
          code: 'DANGEROUS_COMMAND',
          rule: match.rule,
          legacyCode: 'DANGEROUS_COMMAND',
          messages: legacyMessages('DANGEROUS_COMMAND', { command }),
          command,
          traits: ruleTraits(match.rule),
          metadata: {
            patternIndex: match.legacyIndex ?? -1,
            family: match.description,
          },
        });
      }
    }

    if (!this.gate.workspaceBoundaryEnabled) {
      return VALIDATION_OK;
    }

    if (this.commands.rootCount === 0) {
      // A command with no `cd` family has nothing to contain, so an
      // unconfigured workspace is not a failure. A cd chain, however, can no
      // longer be silently admitted: the old gate skipped it entirely when the
      // folder list was empty (audit §3.4).
      if (!CD_TOKEN_PATTERN.test(command)) {
        return VALIDATION_OK;
      }

      return this.failure({
        code: 'NO_WORKSPACE',
        rule: 'PATH.NO_WORKSPACE',
        legacyCode: 'NO_WORKSPACE',
        messages: legacyMessages('NO_WORKSPACE'),
        traits: ruleTraits('PATH.NO_WORKSPACE'),
      });
    }

    const chain: CommandChainOutcome = this.commands.evaluateChain(command, cwd);

    if (chain.rule === null) {
      return VALIDATION_OK;
    }

    // The scanner reports `CMD.PRIVILEGE` before it classifies a `cd` chain, so
    // only the two cwd rules reach here; the `cd`-family owner (`PATH.CWD_*`)
    // is the emitted vocabulary. The `CMD.CD_*` aliases are gone.
    const isEscape = chain.rule === 'PATH.CWD_ESCAPE';
    const rule: Extract<PathRule, 'PATH.CWD_ESCAPE' | 'PATH.CWD_DYNAMIC'> =
      isEscape ? 'PATH.CWD_ESCAPE' : 'PATH.CWD_DYNAMIC';
    const resolvedCode: ValidationCode = isEscape ? 'CWD_ESCAPE' : 'DYNAMIC_PATH';

    return this.failure({
      code: resolvedCode,
      rule,
      legacyCode: resolvedCode,
      messages: isEscape
        ? legacyMessages('CWD_ESCAPE', { command, target: chain.target ?? command })
        : legacyMessages('DYNAMIC_PATH', { target: chain.target ?? command }),
      command,
      path: chain.target ?? command,
      traits: ruleTraits(rule),
      metadata: { matchedRule: chain.rule },
    });
  }

  /**
   * Resolves a working directory synchronously for the legacy boundary.
   *
   * @param cwd - Declared working directory.
   */
  resolveCwdSync(cwd: string): string | null {
    return this.commands.resolveCwd(cwd);
  }

  /**
   * Validates a line range synchronously, sharing the read-engine arithmetic.
   *
   * @param startLine - Requested start.
   * @param endLine - Requested end.
   * @param totalLines - File line count.
   */
  validateLineRangeSync(
    startLine: number | undefined,
    endLine: number | undefined,
    totalLines: number,
  ): ValidationDecision {
    const outcome = this.schema.validateLineRange(startLine, endLine, totalLines);

    if (outcome.ok) {
      return VALIDATION_OK;
    }

    return this.failure({
      code: 'INVALID_LINE_RANGE',
      rule: 'INPUT.LINE_RANGE',
      legacyCode: 'INVALID_LINE_RANGE',
      messages: legacyMessages('INVALID_LINE_RANGE', { startLine, endLine, totalLines }),
      traits: ruleTraits('INPUT.LINE_RANGE'),
    });
  }

  validateInput(kind: string, input: unknown): ValidationDecision {
    if (typeof kind !== 'string') {
      return this.failure({
        code: 'UNKNOWN_OPERATION',
        rule: 'INPUT.UNKNOWN_OPERATION',
        legacyCode: 'UNKNOWN_OPERATION',
        messages: legacyMessages('UNKNOWN_OPERATION', { operation: String(kind) }),
        traits: ruleTraits('INPUT.UNKNOWN_OPERATION'),
      });
    }

    const outcome = this.schema.validate({ kind, input, terminalAvailable: true });

    if (outcome.ok) {
      return VALIDATION_OK;
    }

    return this.schemaFailure(outcome, kind);
  }

  /**
   * Membership-only check behind `validate.knownOperation`.
   *
   * Runs no field pass, matching the pre-Phase-3 contract (audit F-1).
   *
   * @param kind - Operation kind.
   */
  validateKnownOperation(kind: unknown): ValidationDecision {
    const outcome = this.schema.checkKnownOperation(kind);

    return outcome.ok
      ? VALIDATION_OK
      : this.schemaFailure(outcome, typeof kind === 'string' ? kind : String(kind));
  }

  /**
   * Membership-only check behind `validate.knownTool`.
   *
   * A miss produces `INPUT.UNKNOWN_TOOL` → `TOOL_NOT_FOUND` (audit F-2).
   *
   * @param toolKind - Tool kind.
   */
  validateKnownTool(toolKind: unknown): ValidationDecision {
    const outcome = this.schema.checkKnownTool(toolKind);

    return outcome.ok
      ? VALIDATION_OK
      : this.schemaFailure(outcome, typeof toolKind === 'string' ? toolKind : String(toolKind));
  }

  /**
   * Validates a path-embedded input (a kind payload's path field).
   *
   * Convenience composition used by the facade and by the filesystem's
   * directory gates: shape first, then path policy.
   *
   * @param kind - Operation kind.
   * @param input - Operation payload.
   * @param field - Path-bearing field to validate.
   */
  async validateOperationPath(kind: string, input: unknown, field: string): Promise<ValidationDecision> {
    const shape = this.validateInput(kind, input);

    if (!shape.ok) {
      return shape;
    }

    const constraint = kindConstraint(kind);

    if (constraint === undefined) {
      return VALIDATION_OK;
    }

    const candidate = (input as Record<string, unknown>)[field];

    if (typeof candidate !== 'string') {
      return VALIDATION_OK;
    }

    return this.validatePath(candidate, kind);
  }

  /**
   * Validates a whole read batch against the frozen resource ceilings.
   *
   * Two forms are accepted:
   * - `validateBatch(requested, isImportRead?)` checks the file count only
   *   through `INPUT.BATCH_LIMIT` (the legacy read governor call).
   * - `validateBatch(requested, totalBytes, isImportRead?)` also checks the
   *   aggregate footprint and fails through `POLICY.AGGREGATE_BYTES`, so the
   *   pre-execution read pipeline rejects oversized batches through the same
   *   gate that owns the policy ceilings.
   *
   * @param requested - Number of files.
   * @param totalBytesOrImportRead - Aggregate bytes, or the import-read flag.
   * @param isImportRead - Import reads are exempt from both ceilings.
   */
  validateBatch(
    requested: number,
    totalBytesOrImportRead?: number | boolean,
    isImportRead = false,
  ): ValidationDecision {
    const totalBytes = typeof totalBytesOrImportRead === 'number' ? totalBytesOrImportRead : undefined;
    const importRead = typeof totalBytesOrImportRead === 'boolean' ? totalBytesOrImportRead : isImportRead;

    const limitOutcome = this.schema.validateBatchLimit(requested, importRead);

    if (!limitOutcome.ok) {
      return this.failure({
        code: 'BATCH_LIMIT_EXCEEDED',
        rule: 'INPUT.BATCH_LIMIT',
        legacyCode: 'BATCH_LIMIT_EXCEEDED',
        messages: legacyMessages('BATCH_LIMIT_EXCEEDED', {
          requested,
          limit: this.gate.readMaxBatchFiles,
        }),
        traits: ruleTraits('INPUT.BATCH_LIMIT'),
        metadata: { requested, limit: this.gate.readMaxBatchFiles },
      });
    }

    if (totalBytes === undefined || importRead) {
      return VALIDATION_OK;
    }

    const bytesOutcome = this.schema.validateAggregateBytes(totalBytes);

    if (bytesOutcome.ok) {
      return VALIDATION_OK;
    }

    return this.failure({
      code: 'BATCH_LIMIT_EXCEEDED',
      rule: 'POLICY.AGGREGATE_BYTES',
      legacyCode: 'BATCH_LIMIT_EXCEEDED',
      messages: {
        friendly: 'Read batch too large.',
        details: `The batch of ${requested} files requests ${totalBytes} bytes; the limit is ${this.gate.readMaxAggregateBytes} bytes per batch. Narrow the pattern, add excludePatterns, or split the read into sequential batches.`,
      },
      traits: ruleTraits('POLICY.AGGREGATE_BYTES'),
      metadata: { requested, limit: this.gate.readMaxAggregateBytes, totalBytes },
    });
  }

  /**
   * Rejects a mutating call made through a read-only projection.
   *
   * Emitted by the write-routing layer (the scoped partition facade) whenever a
   * mutating member is invoked on a facade pinned read-only, so the catalogued
   * `INPUT.READ_ONLY_PROJECTION` rule has a live emission site across the
   * service boundary instead of existing only in the catalogue.
   *
   * @param operationKind - Mutating member that was attempted.
   * @param input - Path the mutation targeted, for the message.
   */
  validateReadOnlyProjection(operationKind: string, input?: string): ValidationDecision {
    return this.failure({
      code: 'READ_ONLY_VIOLATION',
      rule: 'INPUT.READ_ONLY_PROJECTION',
      legacyCode: 'VALIDATION_ERROR',
      messages: legacyMessages('READ_ONLY_VIOLATION', {
        reason: `"${operationKind}" cannot mutate a read-only projection${
          input === undefined ? '' : ` ("${input}")`
        }.`,
      }),
      ...(input === undefined ? {} : { path: input }),
      operationKind,
      traits: ruleTraits('INPUT.READ_ONLY_PROJECTION'),
    });
  }

  private freeze(
    policy: ValidationPolicy,
    workspace: ValidationWorkspacePort,
    environment: ValidationEnvironment,
  ): void {
    this.gate = new PolicyGateEngine(policy);
    this.schema = new InputSchemaEngine(this.gate.policy);
    this.paths = new PathEvaluationEngine(
      workspace,
      environment.flavor,
      this.gate.workspaceBoundaryEnabled,
      this.schema,
    );
    this.commands = new CommandScannerEngine(workspace, environment);
  }

  /**
   * Validates a whole operation batch envelope.
   *
   * @param operations - Operation list.
   */
  validateOperations(operations: unknown): ValidationDecision {
    const outcome = this.schema.validateOperations(operations);

    return outcome.ok ? VALIDATION_OK : this.schemaFailure(outcome, 'batch');
  }

  /**
   * Validates that a batch carries an `extract_structure` operation.
   *
   * @param operations - Operation list.
   */
  validateExtractOperations(operations: unknown): ValidationDecision {
    const outcome = this.schema.validateExtractOperations(operations);

    return outcome.ok ? VALIDATION_OK : this.schemaFailure(outcome, 'batch');
  }

  /**
   * Validates the legacy block-format markers.
   *
   * @param message - Raw message text.
   */
  validateFormat(message: string): ValidationDecision {
    const outcome = this.schema.validateFormat(message);

    return outcome.ok ? VALIDATION_OK : this.schemaFailure(outcome, 'parse');
  }

  /**
   * Validates preview eligibility for a kind.
   *
   * @param kind - Operation kind.
   * @param files - Candidate files.
   */
  validatePreview(kind: string, files: readonly unknown[]): ValidationDecision {
    const outcome = this.schema.validatePreview(kind, files);

    return outcome.ok ? VALIDATION_OK : this.schemaFailure(outcome, kind);
  }

  /**
   * Validates that a search text occurs exactly once in a file.
   *
   * @param path - File path, for the message only.
   * @param content - File content.
   * @param searchText - Text to locate.
   */
  validateSingleMatch(path: string, content: string, searchText: string): ValidationDecision {
    const outcome = this.schema.validateSingleMatch(path, content, searchText);

    return outcome.ok ? VALIDATION_OK : this.schemaFailure(outcome, 'search_replace');
  }

  /**
   * Validates that a session lookup resolved.
   *
   * @param sessionId - Requested session.
   * @param session - Resolved session.
   */
  validateSession(sessionId: string, session: unknown): ValidationDecision {
    const outcome = this.schema.validateSession(sessionId, session);

    return outcome.ok ? VALIDATION_OK : this.schemaFailure(outcome, 'canRevert');
  }

  /**
   * Validates a revert request.
   *
   * @param sessionId - Target session.
   * @param targetState - Target state label.
   */
  validateRevertRequest(sessionId: string | undefined, targetState: string | undefined): ValidationDecision {
    const outcome = this.schema.validateRevertRequest(sessionId, targetState);

    return outcome.ok ? VALIDATION_OK : this.schemaFailure(outcome, 'revert');
  }

  /**
   * Validates a write or delete target against its actual entry kind.
   *
   * @param kind - Operation kind.
   * @param target - Entry kind at the target.
   */
  validateTargetKind(kind: string, target: 'file' | 'directory' | 'absent'): ValidationDecision {
    const outcome = this.schema.validateTargetKind(kind, target);

    return outcome.ok ? VALIDATION_OK : this.schemaFailure(outcome, kind);
  }

  /**
   * Validates one metadata member check.
   *
   * @param rule - Metadata rule to report.
   * @param values - Wrapper, operation index or offending field.
   * @param reason - Explanation surfaced verbatim.
   */
  validateMetadata(
    rule: MetadataRule,
    values?: SchemaFailure['values'],
    reason?: string,
  ): ValidationDecision {
    const outcome = this.schema.checkMetadata(rule, values, reason);

    return outcome.ok ? VALIDATION_OK : this.schemaFailure(outcome, 'metadata');
  }

  private schemaFailure(outcome: Extract<SchemaOutcome, { readonly ok: false }>, kind: string): ValidationDecision {
    const failure = outcome.failure;
    const rule = failure.rule;

    if (rule in METADATA_RULE_CODES) {
      const metadataRule = rule as MetadataRule;

      return this.failure({
        code: METADATA_RULE_CODES[metadataRule],
        rule: metadataRule,
        legacyCode: METADATA_RULE_CODES[metadataRule],
        messages: legacyMessages(METADATA_RULE_CODES[metadataRule], failure.values),
        operationKind: kind,
        traits: ruleTraits(metadataRule),
      });
    }

    switch (rule) {
      case 'CMD.NO_COMMAND':
        return this.failure({
          code: 'MISSING_FIELD',
          rule,
          legacyCode: 'MISSING_FIELD',
          messages: legacyMessages('MISSING_FIELD', { field: failure.field, operation: kind }),
          operationKind: kind,
          traits: ruleTraits(rule),
        });
      case 'CMD.TERMINAL_UNAVAILABLE':
        return this.failure({
          code: 'TERMINAL_UNAVAILABLE',
          rule,
          legacyCode: 'TERMINAL_UNAVAILABLE',
          messages: legacyMessages('TERMINAL_UNAVAILABLE'),
          operationKind: kind,
          traits: ruleTraits(rule),
        });
      case 'INPUT.UNKNOWN_OPERATION':
        return this.failure({
          code: 'UNKNOWN_OPERATION',
          rule,
          legacyCode: 'UNKNOWN_OPERATION',
          messages: legacyMessages('UNKNOWN_OPERATION', { operation: kind }),
          operationKind: kind,
          traits: ruleTraits(rule),
        });
      case 'INPUT.UNKNOWN_TOOL':
        return this.failure({
          code: 'TOOL_NOT_FOUND',
          rule,
          legacyCode: 'TOOL_NOT_FOUND',
          messages: legacyMessages('TOOL_NOT_FOUND', { operation: kind }),
          operationKind: kind,
          traits: ruleTraits(rule),
        });
      case 'INPUT.TOOL_DISABLED':
        return this.failure({
          code: 'TOOL_DISABLED',
          rule,
          legacyCode: 'TOOL_DISABLED',
          messages: legacyMessages('TOOL_DISABLED', { operation: kind }),
          operationKind: kind,
          traits: ruleTraits(rule),
        });
      case 'INPUT.MISSING_INDEX':
        return this.failure({
          code: 'MISSING_INDEX',
          rule,
          legacyCode: 'MISSING_INDEX',
          messages: legacyMessages('MISSING_INDEX'),
          operationKind: kind,
          traits: ruleTraits(rule),
        });
      case 'INPUT.EMPTY_PATTERNS':
        return this.failure({
          code: 'MISSING_FIELD',
          rule,
          legacyCode: 'MISSING_FIELD',
          messages: legacyMessages('MISSING_FIELD', { field: 'patterns', operation: kind }),
          operationKind: kind,
          traits: ruleTraits(rule),
        });
      case 'INPUT.INVALID_POSITION':
      case 'INPUT.INVALID_MODE': {
        return this.failure({
          code: 'INVALID_FIELD',
          rule,
          legacyCode: 'INVALID_FIELD',
          messages: legacyMessages('INVALID_FIELD', { field: failure.field, reason: failure.reason }),
          operationKind: kind,
          traits: ruleTraits(rule),
          metadata: { field: failure.field ?? '' },
        });
      }
      case 'INPUT.EMPTY_ANSWERS':
        return this.failure({
          code: 'MISSING_FIELD',
          rule,
          legacyCode: 'MISSING_FIELD',
          messages: legacyMessages('MISSING_FIELD', { field: 'answers', operation: kind }),
          operationKind: kind,
          traits: ruleTraits(rule),
        });
      case 'INPUT.EMPTY_OPERATIONS':
        return this.failure({
          code: 'NO_VALID_OPERATIONS',
          rule,
          legacyCode: 'NO_VALID_OPERATIONS',
          messages: legacyMessages('NO_VALID_OPERATIONS'),
          traits: ruleTraits(rule),
        });
      case 'INPUT.NO_EXTRACT_OPS':
        return this.failure({
          code: 'NO_EXTRACT_OPERATIONS',
          rule,
          legacyCode: 'NO_EXTRACT_OPERATIONS',
          messages: legacyMessages('NO_EXTRACT_OPERATIONS'),
          traits: ruleTraits(rule),
        });
      case 'INPUT.PARSE_FORMAT':
        return this.failure({
          code: 'PARSE_ERROR',
          rule,
          legacyCode: 'PARSE_ERROR',
          messages: legacyMessages('PARSE_ERROR'),
          traits: ruleTraits(rule),
        });
      case 'INPUT.PREVIEW_UNSUPPORTED':
        return this.failure({
          code: 'PREVIEW_NOT_AVAILABLE',
          rule,
          legacyCode: 'PREVIEW_NOT_AVAILABLE',
          messages: legacyMessages('PREVIEW_NOT_AVAILABLE'),
          operationKind: kind,
          traits: ruleTraits(rule),
        });
      case 'INPUT.NO_PREVIEW':
        return this.failure({
          code: 'NO_PREVIEW',
          rule,
          legacyCode: 'NO_PREVIEW',
          messages: legacyMessages('NO_PREVIEW'),
          operationKind: kind,
          traits: ruleTraits(rule),
        });
      case 'INPUT.SEARCH_NOT_FOUND':
        return this.failure({
          code: 'SEARCH_NOT_FOUND',
          rule,
          legacyCode: 'SEARCH_NOT_FOUND',
          messages: legacyMessages('SEARCH_NOT_FOUND', { reason: failure.reason }),
          operationKind: kind,
          traits: ruleTraits(rule),
        });
      case 'INPUT.MULTIPLE_MATCHES':
        return this.failure({
          code: 'MULTIPLE_MATCHES',
          rule,
          legacyCode: 'MULTIPLE_MATCHES',
          messages: legacyMessages('MULTIPLE_MATCHES', { reason: failure.reason }),
          operationKind: kind,
          traits: ruleTraits(rule),
        });
      case 'INPUT.LINE_RANGE':
        return this.failure({
          code: 'INVALID_LINE_RANGE',
          rule,
          legacyCode: 'INVALID_LINE_RANGE',
          messages: legacyMessages('INVALID_LINE_RANGE', { reason: failure.reason }),
          details: failure.reason,
          operationKind: kind,
          traits: ruleTraits(rule),
        });
      case 'INPUT.TARGET_KIND':
        return this.failure({
          code: kind === 'delete_file' ? 'CANNOT_DELETE_DIRECTORY' : 'CANNOT_WRITE_DIRECTORY',
          rule,
          legacyCode: 'VALIDATION_ERROR',
          messages: { friendly: failure.reason, details: failure.reason },
          operationKind: kind,
          traits: ruleTraits(rule),
        });
      case 'INPUT.SESSION_MISSING':
        return this.failure({
          code: 'SESSION_NOT_FOUND',
          rule,
          legacyCode: 'SESSION_NOT_FOUND',
          messages: legacyMessages('SESSION_NOT_FOUND', { reason: failure.reason }),
          traits: ruleTraits(rule),
        });
      case 'INPUT.REVERT_REQUEST':
        return this.failure({
          code: 'INVALID_REVERT_REQUEST',
          rule,
          legacyCode: 'INVALID_REVERT_REQUEST',
          messages: legacyMessages('INVALID_REVERT_REQUEST'),
          traits: ruleTraits(rule),
        });
      case 'INPUT.MISSING_FIELD':
      default:
        return this.failure({
          code: failure.field === 'index' ? 'MISSING_INDEX' : 'MISSING_FIELD',
          rule,
          legacyCode: failure.field === 'index' ? 'MISSING_INDEX' : 'MISSING_FIELD',
          messages: failure.field === 'index'
            ? legacyMessages('MISSING_INDEX')
            : legacyMessages('MISSING_FIELD', { field: failure.field, operation: kind }),
          operationKind: kind,
          traits: ruleTraits(rule),
        });
    }
  }

  private pathMessages(
    code: ValidationCode,
    input: string,
    reason: string,
    rule: PathRule,
  ): { readonly friendly: string; readonly details: string } {
    if (code === 'PATH_TRAVERSAL_DETECTED') {
      return legacyMessages(code, { path: input });
    }

    if (code === 'WORKSPACE_PATH_VIOLATION') {
      return { friendly: reason, details: reason };
    }

    if (code === 'WORKSPACE_CONFIGURATION_INVALID') {
      return legacyMessages(code, { reason, path: input });
    }

    return legacyMessages(code, { path: input, reason });
  }

  private failure(input: {
    readonly code: ValidationCode;
    readonly rule: ValidationRule;
    readonly legacyCode: string;
    readonly messages: { readonly friendly: string; readonly details: string };
    readonly path?: string;
    readonly operationKind?: string;
    readonly command?: string;
    readonly traits: RuleTraits;
    readonly metadata?: Readonly<Record<string, string | number | boolean>>;
    readonly details?: string;
  }): ValidationDecision {
    return validationFailure({
      code: input.code,
      rule: input.rule,
      legacyCode: input.legacyCode,
      friendly: input.messages.friendly,
      details: input.details ?? input.messages.details,
      actionable: input.traits.actionable,
      retryable: input.traits.retryable,
      ...(input.path === undefined ? {} : { path: input.path }),
      ...(input.operationKind === undefined ? {} : { operationKind: input.operationKind }),
      ...(input.command === undefined ? {} : { command: input.command }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    });
  }
}
