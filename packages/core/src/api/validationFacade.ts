import * as pathModule from 'path';
import type {
  MetadataRule as KernelMetadataRule,
  ValidationCode as KernelValidationCode,
  ValidationDecision as KernelDecision,
  ValidationPolicy as KernelPolicy,
  ValidationService as KernelValidationService,
  ValidationWorkspacePort as KernelWorkspacePort,
} from '@brud/kernel' with { 'resolution-mode': 'import' };

/**
 * Runtime handle on `@brud/kernel`.
 *
 * The kernel is an ESM package while this package compiles to CommonJS. Node's
 * `require(esm)` support loads it synchronously, which is exactly what the
 * legacy synchronous boundary needs. Types come from the type-only import
 * above; only the constructors are taken from the runtime handle.
 */
interface KernelRuntime {
  readonly ValidationService: new (options: {
    readonly policy: KernelPolicy;
    readonly workspace: KernelWorkspacePort;
    readonly environment: { readonly homeDirectory: string; readonly flavor: 'posix' | 'win32' };
  }) => KernelValidationService;
  readonly legacyMessages: (
    code: 'NO_WORKSPACE' | 'TERMINAL_UNAVAILABLE' | 'DANGEROUS_COMMAND' | 'INVALID_LINE_RANGE',
    values?: { readonly path?: string; readonly command?: string; readonly startLine?: number; readonly endLine?: number; readonly totalLines?: number },
  ) => { readonly friendly: string; readonly details: string };
  readonly isProtectedWritePath: (relativePath: string) => boolean;
  readonly isKnownOperationKind: (kind: string) => boolean;
}

const kernelModule = require('@brud/kernel') as KernelRuntime;
const { ValidationService, legacyMessages, isKnownOperationKind } = kernelModule;

/**
 * Kernel A10 denylist predicate, re-exported for the legacy execution gate.
 *
 * The execution layer needs the same `.brud/settings.json`, `.brud/history/**`
 * and `.git/**` denylist the kernel filesystem enforces, so it imports the one
 * predicate instead of re-declaring the patterns.
 *
 * @param relativePath - Workspace-relative path with `'/'` separators.
 */
export function isProtectedWritePath(relativePath: string): boolean {
  return kernelModule.isProtectedWritePath(relativePath);
}

type ValidationDecision = KernelDecision;
type ValidationPolicy = KernelPolicy;
type ValidationWorkspacePort = KernelWorkspacePort;

import type { ValidationResult } from './types';
import type { BrudSettings } from '../settings/types';
import { getWorkspaceRootForPath } from '../utils/workspacePath';

/**
 * Legacy facade over the kernel `ValidationService`.
 *
 * `BrudAPI.validate` is a synchronous boundary that predates the kernel, so it
 * cannot await `validatePath`. The facade therefore constructs a kernel
 * `ValidationService` over a fixed root registry and calls its synchronous
 * `validatePathSync` entry point, which runs the *same* lexical rules,
 * boundary switch and A10 denylist as the asynchronous service. Commands and
 * inputs are delegated to the service's genuinely synchronous methods.
 *
 * Error mapping is the rollout plan's Appendix C with the audit's six
 * corrections applied (W-10): the kernel code stays structured inside the
 * decision, and only `legacyCode`, `friendly` and `details` cross this
 * boundary. Membership checks (`knownOperation`, `knownTool`) never construct
 * a service: they consult the kernel's closed kind vocabulary directly.
 */

/** Frozen policy a legacy execution boundary was configured with. */
export interface LegacyValidationPolicy {
  readonly workspaceBoundaryEnabled: boolean;
  readonly commandValidationEnabled: boolean;
  readonly toolAllowList: Readonly<Record<string, boolean>>;
}

/**
 * Narrows legacy settings into a frozen validation policy.
 *
 * The legacy settings object is read once per execution batch; this is the
 * boot snapshot for that boundary, not a per-call override. There is no
 * default: a boundary that never resolved settings must not silently assert
 * safety-on (audit F-4).
 *
 * @param settings - Legacy settings.
 */
export function policyFromSettings(settings: BrudSettings): ValidationPolicy {
  return {
    workspaceBoundaryEnabled: settings.workspaceBoundaryEnabled !== false,
    commandValidationEnabled: settings.commandValidationEnabled !== false,
    toolAllowList: { ...settings.toolAllowList },
    readConcurrency: settings.readConcurrency ?? 16,
    readMaxBatchFiles: settings.readMaxBatchFiles ?? 100,
    readMaxAggregateBytes: settings.readMaxAggregateBytes ?? 8 * 1024 * 1024,
    schemaVersion: 1,
  };
}

/**
 * Resolves the policy a synchronous legacy entry point enforces.
 *
 * Plan Phase 3 item 2 forbids per-call settings reads. A stateless helper
 * cannot reach a settings snapshot, so this boundary no longer pretends to:
 * it uses the explicit batch policy when one is supplied and otherwise an
 * explicit fail-closed literal. Operator opt-outs reach the boundary through
 * exactly one path, `validateTerminalCommand`, which hands this function the
 * batch's snapshot; no other entry point can observe or forge a policy. The
 * resolved value is frozen, so a returned policy can never weaken later.
 *
 * @param policy - Frozen batch policy, when the caller has one.
 */
export function boundaryPolicy(policy?: ValidationPolicy): ValidationPolicy {
  const resolved: ValidationPolicy = policy ?? {
    workspaceBoundaryEnabled: true,
    commandValidationEnabled: true,
    toolAllowList: {},
    readConcurrency: 16,
    readMaxBatchFiles: 100,
    readMaxAggregateBytes: 8 * 1024 * 1024,
    schemaVersion: 1,
  };

  return Object.freeze({ ...resolved, toolAllowList: Object.freeze({ ...resolved.toolAllowList }) });
}

/**
 * Builds a workspace port over a plain folder list.
 *
 * Legacy callers pass absolute folders, so root identity needs no port. The
 * synchronous path entry point only reads `roots` and `primaryRoot`; `resolve`
 * exists to satisfy the contract and is never reached from the sync boundary.
 *
 * @param workspaceFolders - Absolute workspace folders.
 */
function workspacePort(workspaceFolders: readonly string[]): ValidationWorkspacePort {
  const roots = workspaceFolders.length > 0 ? [...workspaceFolders] : [];

  return {
    roots,
    primaryRoot: roots[0] ?? '',
    resolve: async (userPath: string) => {
      throw new Error(`legacy sync boundary cannot resolve "${userPath}" asynchronously`);
    },
    toAbsolutePath: (kernelPath: string) => kernelPath,
  };
}

/**
 * Builds a kernel validation service for a legacy call.
 *
 * @param workspaceFolders - Absolute workspace folders.
 * @param policy - Frozen boundary policy.
 */
function createService(
  workspaceFolders: readonly string[],
  policy: ValidationPolicy,
): KernelValidationService {
  return new ValidationService({
    policy,
    workspace: workspacePort(workspaceFolders),
    environment: {
      homeDirectory: process.env.HOME ?? process.env.USERPROFILE ?? '/home',
      flavor: process.platform === 'win32' ? 'win32' : 'posix',
    },
  });
}

/**
 * Converts a decision into the legacy `ValidationResult` shape.
 *
 * @param decision - Kernel decision.
 * @param successData - Payload for the success arm.
 */
export function toValidationResult(decision: ValidationDecision, successData?: unknown): ValidationResult {
  if (decision.ok) {
    return { success: true, data: successData };
  }

  return {
    success: false,
    code: decision.legacyCode,
    friendly: decision.friendly,
    details: decision.details,
    data: decision.path ?? decision.command,
  };
}

/** Failure converted into the legacy shape, for engines that throw. */
export function failureResult(code: string, friendly: string, details: string, data?: string): ValidationResult {
  return { success: false, code, friendly, details, data };
}

/**
 * Translation of a root escape for the legacy boundary.
 *
 * Appendix C is unambiguous on this row: `PATH.OUTSIDE_ROOT` — and every other
 * containment escape that is not a lexical-integrity failure — renders as
 * `PATH_OUTSIDE_WORKSPACE`, never as a catch-all `VALIDATION_ERROR`. Both the
 * kernel decision arm and the legacy "no owning root" arm of `validatePath`
 * build their failure here, so the two boundary calls cannot disagree.
 *
 * @param inputPath - Path that escaped the workspace roots.
 */
export function outsideRootResult(inputPath: string): ValidationResult {
  return failureResult(
    'PATH_OUTSIDE_WORKSPACE',
    'The path is outside the current workspace.',
    `The path "${inputPath}" is outside the current workspace. File operations are restricted to files and folders inside the workspace.`,
    inputPath,
  );
}

/** Mirrors the legacy `noWorkspaceError` payload. */
export function noWorkspaceResult(): ValidationResult {
  const messages = legacyMessages('NO_WORKSPACE');

  return failureResult('NO_WORKSPACE', messages.friendly, messages.details);
}

/**
 * Evaluates a path through the kernel service.
 *
 * @param inputPath - Absolute or relative path.
 * @param workspaceFolders - Registered folders.
 * @param policy - Frozen policy.
 * @param operationKind - Operation kind, when known.
 */
export function validatePathDecision(
  inputPath: string,
  workspaceFolders: readonly string[],
  policy: ValidationPolicy,
  operationKind?: string,
): ValidationDecision {
  if (workspaceFolders.length === 0) {
    return {
      ok: false,
      code: 'NO_WORKSPACE',
      rule: 'PATH.NO_WORKSPACE',
      legacyCode: 'NO_WORKSPACE',
      friendly: legacyMessages('NO_WORKSPACE').friendly,
      details: legacyMessages('NO_WORKSPACE').details,
      actionable: true,
      retryable: true,
    };
  }

  return createService(workspaceFolders, policy).validatePathSync(inputPath, operationKind);
}

/**
 * Legacy `validate.path`.
 *
 * @param inputPath - Absolute or relative path.
 * @param workspaceFolders - Registered folders.
 * @param policy - Frozen boundary policy for the batch.
 * @param options - Operation kind and the legacy realpath cache (unchanged).
 */
export function validatePath(
  inputPath: string,
  workspaceFolders: string[],
  policy: ValidationPolicy,
  options?: {
    readonly operationKind?: string;
    readonly cache?: { canonicalize(input: string): string };
  },
): ValidationResult {
  // The cached canonicalization is consulted first so a batch shares one
  // canonical root and one containment probe, exactly as before Phase 3.
  const root = getWorkspaceRootForPath(
    inputPath,
    workspaceFolders,
    options?.cache as Parameters<typeof getWorkspaceRootForPath>[2],
  );
  // Legacy parity: `BrudAPI.validate.path` never inspected null bytes; the
  // failure surfaced later from the filesystem call (audit A7, and the legacy
  // parity matrix documents this delta). The kernel service still rejects them
  // for every kernel caller, so the check is skipped only at this boundary.
  if (!inputPath.includes('\0')) {
    const decision = validatePathDecision(inputPath, workspaceFolders, policy, options?.operationKind);

    if (!decision.ok) {
      return toValidationResult(decision);
    }
  }

  if (root === null) {
    return outsideRootResult(inputPath);
  }

  const resolvedPath = pathModule.isAbsolute(inputPath)
    ? pathModule.resolve(inputPath)
    : pathModule.resolve(root, inputPath);

  return {
    success: true,
    data: { resolvedPath, path: inputPath, root, operationKind: options?.operationKind },
  };
}

/**
 * Legacy `validate.command`.
 *
 * @param command - Command text.
 * @param cwd - Explicit working directory.
 * @param workspaceFolders - Registered folders.
 * @param policy - Frozen boundary policy (no per-call override).
 */
export function validateCommand(
  command: string,
  cwd: string | undefined,
  workspaceFolders: readonly string[] | undefined,
  policy?: ValidationPolicy,
): ValidationResult {
  const decision = createService(workspaceFolders ?? [], boundaryPolicy(policy)).validateCommand(command, cwd);

  if (decision.ok) {
    return { success: true, data: { command } };
  }

  return toValidationResult(decision);
}

/**
 * Structured command decision for the legacy boundary.
 *
 * `validateCommand` flattens the kernel decision into a `ValidationResult`,
 * which keeps the legacy code but drops the violated rule. Callers that must
 * distinguish a dangerous-command verdict from a containment failure need the
 * rule, so this entry point exposes the unflattened decision, at the same
 * frozen boundary policy and with the same service construction.
 *
 * @param command - Command text.
 * @param cwd - Explicit working directory.
 * @param workspaceFolders - Registered folders.
 * @param policy - Frozen boundary policy (no per-call override).
 */
export function validateCommandDecision(
  command: string,
  cwd: string | undefined,
  workspaceFolders: readonly string[] | undefined,
  policy?: ValidationPolicy,
): ValidationDecision {
  return createService(workspaceFolders ?? [], boundaryPolicy(policy)).validateCommand(command, cwd);
}

/**
 * Structured batch decision for the pre-execution read pipeline.
 *
 * Exposes the unflattened kernel decision so the read engine can report which
 * ceiling rejected the batch (`INPUT.BATCH_LIMIT` or
 * `POLICY.AGGREGATE_BYTES`), while the boundary still throws the legacy
 * `BATCH_LIMIT_EXCEEDED` code.
 *
 * @param fileCount - Files the batch would read.
 * @param totalBytes - Bytes the batch would admit (`0` while unknown).
 * @param isImportRead - Import reads are exempt from both ceilings.
 * @param policy - Frozen boundary policy for the batch.
 */
export function validateBatchDecision(
  fileCount: number,
  totalBytes: number,
  isImportRead: boolean,
  policy?: ValidationPolicy,
): ValidationDecision {
  return createService([], boundaryPolicy(policy)).validateBatch(fileCount, totalBytes, isImportRead);
}

/**
 * Structured read-only projection decision.
 *
 * The write-routing layer calls this before touching a facade pinned read-only,
 * so a mutation attempt fails through `INPUT.READ_ONLY_PROJECTION` →
 * `READ_ONLY_VIOLATION` instead of reaching the filesystem.
 *
 * @param operationKind - Mutating member that was attempted.
 * @param input - Path the mutation targeted.
 * @param policy - Frozen boundary policy (no per-call override).
 */
export function validateReadOnlyProjectionDecision(
  operationKind: string,
  input?: string,
  policy?: ValidationPolicy,
): ValidationDecision {
  return createService([], boundaryPolicy(policy)).validateReadOnlyProjection(operationKind, input);
}

/**
 * Builds the file system error a read-only projection violation raises.
 *
 * Keeps the structured kernel rule in the payload while the thrown error keeps
 * the legacy `VALIDATION_ERROR` code the boundary has always produced.
 *
 * @param decision - Rejected projection decision.
 */
export function readOnlyProjectionViolation(decision: ValidationDecision): Error {
  if (decision.ok) {
    return new Error('read-only projection violation requires a rejected decision');
  }

  const error = new Error(decision.details) as Error & {
    code: string;
    rule: string;
    path?: string;
    friendly: string;
  };
  error.name = 'ReadOnlyProjectionViolationError';
  error.code = decision.legacyCode;
  error.rule = decision.rule;
  error.friendly = decision.friendly;

  if (decision.path !== undefined) {
    error.path = decision.path;
  }

  return error;
}

/**
 * Legacy `validate.cwd`.
 *
 * @param cwd - Declared working directory.
 * @param workspaceFolders - Registered folders.
 * @param policy - Frozen boundary policy.
 */
export function validateCwd(
  cwd: string | undefined,
  workspaceFolders: readonly string[],
  policy?: ValidationPolicy,
): ValidationResult {
  const frozen = boundaryPolicy(policy);

  if (!cwd || cwd.trim() === '') {
    if (workspaceFolders.length === 0) {
      return noWorkspaceResult();
    }

    return { success: true, data: { resolvedCwd: workspaceFolders[0] } };
  }

  const resolved = createService(workspaceFolders, frozen).resolveCwdSync(cwd);

  if (resolved === null) {
    return toValidationResult(createService(workspaceFolders, frozen).validateCommand('ls', cwd));
  }

  return { success: true, data: { resolvedCwd: resolved } };
}

/**
 * Legacy `validate.lineRange`, delegated to the kernel line-range arithmetic.
 *
 * @param startLine - Requested start.
 * @param endLine - Requested end.
 * @param totalLines - File line count.
 */
export function validateLineRange(
  startLine: number | undefined,
  endLine: number | undefined,
  totalLines: number,
): ValidationResult {
  const decision = createService([], boundaryPolicy()).validateLineRangeSync(
    startLine,
    endLine,
    totalLines,
  );

  if (decision.ok) {
    const start = startLine ?? 1;
    const end = Math.min(endLine ?? totalLines, totalLines);

    return { success: true, data: { startLine: start, endLine: end, totalLines } };
  }

  return toValidationResult(decision);
}

/**
 * Legacy `validate.hasValidOperations`.
 *
 * @param operations - Operation list.
 */
export function validateOperations(operations: unknown): ValidationResult {
  return toValidationResult(createService([], boundaryPolicy()).validateOperations(operations));
}

/**
 * Legacy `validate.hasExtractOperations`.
 *
 * @param operations - Operation list.
 */
export function validateExtractOperations(operations: unknown): ValidationResult {
  return toValidationResult(createService([], boundaryPolicy()).validateExtractOperations(operations));
}

/**
 * Legacy `validate.validFormat`.
 *
 * @param message - Raw message text.
 */
export function validateFormat(message: string): ValidationResult {
  return toValidationResult(createService([], boundaryPolicy()).validateFormat(message));
}

/**
 * Legacy `validate.hasPreview`.
 *
 * @param operationType - Operation kind.
 */
export function validatePreview(operationType: string): ValidationResult {
  return toValidationResult(
    createService([], boundaryPolicy()).validatePreview(operationType, [{}]),
    { operationType },
  );
}

/**
 * Legacy `validate.validRevertRequest`.
 *
 * @param sessionId - Target session.
 * @param targetState - Target state label.
 */
export function validateRevertRequest(
  sessionId: string | undefined,
  targetState: string | undefined,
): ValidationResult {
  return toValidationResult(
    createService([], boundaryPolicy()).validateRevertRequest(sessionId, targetState),
    { sessionId, targetState },
  );
}

/**
 * Legacy `validate.knownOperation`.
 *
 * Membership only, exactly as the pre-Phase-3 boundary: a catalogued kind
 * succeeds even though its mandatory fields are absent (audit F-1). Checking
 * membership through the kernel predicate also means the service is never
 * constructed for a pure name lookup.
 *
 * @param operation - Operation kind.
 */
export function validateKnownOperation(operation: string): ValidationResult {
  if (typeof operation !== 'string' || !isKnownOperationKind(operation)) {
    return toValidationResult(createService([], boundaryPolicy()).validateKnownOperation(operation));
  }

  return { success: true, data: { operation } };
}

/**
 * Legacy `validate.knownTool`.
 *
 * Membership only. A miss travels through `INPUT.UNKNOWN_TOOL` so the boundary
 * emits `TOOL_NOT_FOUND`, the code the legacy API produced (audit F-2).
 *
 * @param toolKind - Tool kind.
 */
export function validateKnownTool(toolKind: string): ValidationResult {
  if (typeof toolKind === 'string' && isKnownOperationKind(toolKind)) {
    return { success: true, data: { toolKind } };
  }

  return toValidationResult(createService([], boundaryPolicy()).validateKnownTool(toolKind));
}

/**
 * Legacy metadata member check.
 *
 * Each parser failure now has its own rule id and legacy code instead of the
 * collapsed `INPUT.METADATA_INVALID` (audit F-3).
 *
 * @param rule - Metadata rule reported by the boundary.
 * @param values - Wrapper name, operation index or offending field.
 * @param reason - Explanation surfaced verbatim.
 */
export function validateMetadata(
  rule: KernelMetadataRule,
  values?: { readonly wrapper?: string; readonly index?: string; readonly field?: string },
  reason?: string,
): ValidationResult {
  return toValidationResult(createService([], boundaryPolicy()).validateMetadata(rule, values, reason));
}

/** Legacy `E_*` metadata code type. */
export type LegacyMetadataCode = Extract<KernelValidationCode, `E_${string}`>;

/**
 * Legacy `validate.terminalAvailable`.
 *
 * @param config - Host terminal configuration.
 */
export function validateTerminalAvailable(config: { terminalExecutor?: unknown } | null | undefined): ValidationResult {
  const messages = legacyMessages('TERMINAL_UNAVAILABLE');

  return config?.terminalExecutor
    ? { success: true, data: { config } }
    : failureResult('TERMINAL_UNAVAILABLE', messages.friendly, messages.details);
}
