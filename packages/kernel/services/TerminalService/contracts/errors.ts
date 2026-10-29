import type { ValidationRule } from '../../ValidationService/contracts/rules.js';
import type { TerminalResult } from './ITerminalService.js';

/**
 * Machine-readable terminal failure codes.
 *
 * Every code is stable and may be persisted, so values must not be renamed
 * without a migration. The kernel never emits a legacy code directly; the
 * facade maps these onto the legacy vocabulary through {@link legacyCodeFor}.
 */
export type TerminalErrorCode =
  | 'TERMINAL_UNAVAILABLE'
  | 'TERMINAL_INVALID_REQUEST'
  | 'TERMINAL_BLOCKED'
  | 'TERMINAL_SPAWN_FAILED'
  | 'TERMINAL_EXIT_NONZERO'
  | 'TERMINAL_TIMEOUT'
  | 'TERMINAL_INTERRUPTED'
  | 'TERMINAL_OUTPUT_LIMIT'
  | 'TERMINAL_INTERNAL';

/**
 * Outcome of one terminal request.
 *
 * Mirrors `ValidationDecision` so the two gates compose identically:
 * `ok: true` carries no authority beyond the result payload, and every
 * failure carries a code, the violated rule (when the gate produced one),
 * the legacy-compatible text and the flags a host needs to react.
 */
export type TerminalDecision =
  | { readonly ok: true; readonly result: TerminalResult }
  | {
      readonly ok: false;
      readonly code: TerminalErrorCode;
      /** Violated validation rule, present for gate rejections. */
      readonly rule?: ValidationRule;
      /** Facade-level code a legacy caller sees for this failure. */
      readonly legacyCode: string;
      readonly friendly: string;
      readonly details: string;
      readonly command?: string;
      readonly cwd?: string;
      /** Exit code, when the failure came from a completed process. */
      readonly exitCode: number | null;
      /**
       * Measured outcome the failure was derived from, when a process ran.
       *
       * A gate rejection carries no outcome; an execution failure carries the
       * full transcript so a host can render every command of a failed batch
       * rather than only the projected first failure.
       */
      readonly result?: TerminalResult;
      /** Terminating signal, when the process died from one. */
      readonly signal?: string | null;
      /** The caller can fix the input without waiting. */
      readonly actionable: boolean;
      /** The same input may succeed later without change. */
      readonly retryable: boolean;
      readonly metadata?: Readonly<Record<string, string | number | boolean>>;
    };

/** Inputs accepted by {@link terminalFailure}. */
export interface TerminalFailureDetails {
  readonly code: TerminalErrorCode;
  readonly rule?: ValidationRule;
  readonly legacyCode: string;
  readonly friendly: string;
  readonly details: string;
  readonly command?: string;
  readonly cwd?: string;
  readonly exitCode?: number | null;
  readonly result?: TerminalResult;
  readonly signal?: string | null;
  readonly actionable?: boolean;
  readonly retryable?: boolean;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

/** Success decision factory. */
export function terminalSuccess(result: TerminalResult): TerminalDecision {
  return Object.freeze({ ok: true as const, result });
}

/**
 * Builds a frozen failure decision.
 *
 * @param details - Code, rule, legacy code, messages and flags.
 */
export function terminalFailure(details: TerminalFailureDetails): TerminalDecision {
  return Object.freeze({
    ok: false as const,
    code: details.code,
    ...(details.rule === undefined ? {} : { rule: details.rule }),
    legacyCode: details.legacyCode,
    friendly: details.friendly,
    details: details.details,
    ...(details.command === undefined ? {} : { command: details.command }),
    ...(details.cwd === undefined ? {} : { cwd: details.cwd }),
    exitCode: details.exitCode ?? null,
    ...(details.result === undefined ? {} : { result: details.result }),
    ...(details.signal === undefined ? {} : { signal: details.signal }),
    actionable: details.actionable ?? false,
    retryable: details.retryable ?? false,
    ...(details.metadata === undefined ? {} : { metadata: details.metadata }),
  });
}

/**
 * Builds the fail-closed decision of an unbound validation authority.
 *
 * A service without an active `ValidationService` cannot prove a command is
 * safe, so every execution attempt is refused instead of being admitted on a
 * structural check.
 *
 * @param command - Command the caller attempted.
 * @param cwd - Working directory of the attempt.
 */
export function terminalUnavailable(command?: string, cwd?: string): TerminalDecision {
  return terminalFailure({
    code: 'TERMINAL_UNAVAILABLE',
    legacyCode: 'TERMINAL_UNAVAILABLE',
    friendly: 'Terminal execution unavailable: validation authority not bound',
    details: 'The terminal service cannot execute commands without an active ValidationService.',
    ...(command === undefined ? {} : { command }),
    ...(cwd === undefined ? {} : { cwd }),
    actionable: false,
    retryable: true,
  });
}

/** Legacy `BrudError` codes by kernel terminal code. */
const LEGACY_CODE_BY_TERMINAL_CODE: Readonly<Record<TerminalErrorCode, string>> = Object.freeze({
  TERMINAL_UNAVAILABLE: 'TERMINAL_UNAVAILABLE',
  TERMINAL_INVALID_REQUEST: 'EXECUTION_FAILED',
  TERMINAL_BLOCKED: 'DANGEROUS_COMMAND',
  TERMINAL_SPAWN_FAILED: 'EXECUTION_FAILED',
  TERMINAL_EXIT_NONZERO: 'EXECUTION_FAILED',
  TERMINAL_TIMEOUT: 'TERMINAL_TIMEOUT',
  TERMINAL_INTERRUPTED: 'TERMINAL_INTERRUPTED',
  TERMINAL_OUTPUT_LIMIT: 'TERMINAL_OUTPUT_LIMIT',
  TERMINAL_INTERNAL: 'EXECUTION_FAILED',
});

/**
 * Default legacy code for a terminal code.
 *
 * Gate rejections usually carry a precise `legacyCode` already; this mapping
 * covers execution outcomes, where the legacy surface only knows
 * `EXECUTION_FAILED` and the three additive codes.
 *
 * @param code - Kernel terminal code.
 */
export function legacyCodeFor(code: TerminalErrorCode): string {
  return LEGACY_CODE_BY_TERMINAL_CODE[code];
}

/**
 * Translates a `ValidationDecision` failure into a terminal failure.
 *
 * `TERMINAL_BLOCKED` is reserved for the command and containment gates;
 * request-shape failures (missing command, unusable cwd) are classified as
 * `TERMINAL_INVALID_REQUEST` so a host can tell "retry with a different
 * command" from "this command is refused".
 *
 * @param decision - Failure raised by the validation gate.
 * @param fallbackCommand - Command echoed when the decision omits one.
 */
export function terminalFailureFromValidation(
  decision: Extract<TerminalFailureSource, { readonly ok: false }>,
  fallbackCommand?: string,
): TerminalDecision {
  const requestedCode = decision.code as string;
  const code: TerminalErrorCode = INVALID_REQUEST_VALIDATION_CODES.has(requestedCode)
    ? 'TERMINAL_INVALID_REQUEST'
    : 'TERMINAL_BLOCKED';
  const command = decision.command ?? fallbackCommand;

  return terminalFailure({
    code,
    rule: decision.rule,
    legacyCode: decision.legacyCode,
    friendly: decision.friendly,
    details: decision.details,
    ...(command === undefined ? {} : { command }),
    actionable: decision.actionable,
    retryable: decision.retryable,
    ...(decision.metadata === undefined ? {} : { metadata: decision.metadata }),
  });
}

/** Validation codes that describe an unusable request rather than a denied command. */
const INVALID_REQUEST_VALIDATION_CODES: ReadonlySet<string> = new Set([
  'MISSING_FIELD',
  'INVALID_FIELD',
  'INVALID_CWD',
  'NO_WORKSPACE',
  'BATCH_LIMIT_EXCEEDED',
  'UNEXPECTED_ERROR',
]);

/** Structural shape of a validation failure, kept local to avoid a cycle. */
export type TerminalFailureSource =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: string;
      readonly rule: ValidationRule;
      readonly legacyCode: string;
      readonly friendly: string;
      readonly details: string;
      readonly command?: string;
      readonly actionable: boolean;
      readonly retryable: boolean;
      readonly metadata?: Readonly<Record<string, string | number | boolean>>;
    };
