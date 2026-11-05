import type {
  ITerminalHandle,
  OperationResult,
  TerminalCommandGroup,
  TerminalExecutedCommand,
  TerminalGroupOutcome,
  TerminalResult,
  TerminalRunOutcome,
  TerminalRunRequest,
} from '@brud/kernel';

/** Stable failure codes surfaced by the Terminal tools. */
export type TerminalFailureCode =
  | 'EXECUTION_FAILED'
  | 'TERMINAL_TIMEOUT'
  | 'TERMINAL_INTERRUPTED'
  | 'TERMINAL_OUTPUT_LIMIT';

/** One command record in the legacy result envelope. */
export interface TerminalCommandData {
  readonly command: string;
  readonly output: string;
  readonly exitCode: number | null;
  readonly duration: number;
  readonly success: boolean;
}

/** Structured data attached to a failed Terminal tool result. */
export interface TerminalFailureData {
  readonly code: TerminalFailureCode;
  readonly details: string;
  readonly command?: string;
  readonly exitCode: number | null;
  readonly results?: readonly TerminalCommandData[];
}

/**
 * Operation result extended with the machine-readable terminal code.
 *
 * The kernel `OperationResult` contract carries `status`, `message`, `data`
 * and `error`; the extra top-level `code` keeps a caller from having to reach
 * into `data` to tell a timeout from an ordinary non-zero exit.
 */
export interface TerminalOperationResult extends OperationResult {
  readonly code?: string;
}

/** Options accepted by {@link TerminalToolError}. */
export interface TerminalToolErrorOptions {
  readonly details: string;
  readonly command?: string;
  readonly exitCode: number | null;
}

/**
 * Error object attached to failed Tool results.
 *
 * It mirrors the legacy `BrudError` fields (`code`, `friendly`, `details`) so
 * an MCP client or JSON-RPC host can branch on the code without parsing the
 * message.
 */
export class TerminalToolError extends Error {
  public readonly code: TerminalFailureCode;

  public readonly friendly: string;

  public readonly details: string;

  public readonly command: string | undefined;

  public readonly exitCode: number | null;

  constructor(
    code: TerminalFailureCode,
    friendly: string,
    options: TerminalToolErrorOptions,
  ) {
    super(`${code}: ${options.details}`);
    this.name = 'TerminalToolError';
    this.code = code;
    this.friendly = friendly;
    this.details = options.details;
    this.command = options.command;
    this.exitCode = options.exitCode;
  }
}

/** Narrows a terminal result union to the composite outcome. */
export function isGroupResult(result: TerminalResult): result is TerminalGroupOutcome {
  return 'results' in result;
}

/** Returns the legacy per-command record for one measured outcome. */
export function toCommandData(
  command: string,
  result: TerminalRunOutcome,
): TerminalCommandData {
  return {
    command,
    output: result.output,
    exitCode: result.exitCode,
    duration: result.duration,
    success: result.success,
  };
}

/** Converts a measured group outcome into the legacy per-command records. */
export function toGroupData(
  results: readonly TerminalExecutedCommand[],
): readonly TerminalCommandData[] {
  return results.map((result) => toCommandData(result.command, result));
}

/** Converts the schema's seconds into the service's milliseconds. */
export function toMilliseconds(seconds: unknown, fallbackSeconds = 120): number {
  const value = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
    ? seconds
    : fallbackSeconds;

  return Math.floor(value * 1000);
}

/** Wraps one command string in the sequential group the service expects. */
export function toCommandGroup(command: string): TerminalCommandGroup {
  return {
    type: 'sequential',
    commands: [command],
    stopOnFailure: true,
  };
}

/** Maps a failed outcome onto the stable terminal failure taxonomy. */
export function failureCodeFor(result: TerminalRunOutcome): TerminalFailureCode {
  if (result.status === 'interrupted') {
    return 'TERMINAL_INTERRUPTED';
  }

  if (result.failure === 'TERMINAL_TIMEOUT') {
    return 'TERMINAL_TIMEOUT';
  }

  if (result.failure === 'TERMINAL_OUTPUT_LIMIT') {
    return 'TERMINAL_OUTPUT_LIMIT';
  }

  return 'EXECUTION_FAILED';
}

/** Builds the legacy-compatible explanation for a failure code. */
export function failureDetailsFor(
  code: TerminalFailureCode,
  command: string,
  result: TerminalRunOutcome,
  timeoutMs: number,
): string {
  switch (code) {
    case 'TERMINAL_TIMEOUT':
      return `The command "${command}" did not finish within ${Math.round(timeoutMs / 1000)} seconds and was terminated.`;
    case 'TERMINAL_INTERRUPTED':
      return `The command "${command}" did not complete because the operation was cancelled.`;
    case 'TERMINAL_OUTPUT_LIMIT':
      return `The command "${command}" produced more output than the terminal retains; the transcript was truncated.`;
    case 'EXECUTION_FAILED':
    default: {
      const excerpt = result.output.trim();
      const output = excerpt.length > 0 ? `\nOutput:\n${excerpt}` : '';

      return `The command "${command}" exited with code ${result.exitCode}.${output}`;
    }
  }
}

/** Builds a failed OperationResult carrying the structured terminal code. */
export function terminalFailureResult(options: {
  readonly code: TerminalFailureCode;
  readonly message: string;
  readonly details: string;
  readonly command?: string;
  readonly exitCode: number | null;
  readonly results?: readonly TerminalCommandData[];
}): TerminalOperationResult {
  const data: TerminalFailureData = {
    code: options.code,
    details: options.details,
    ...(options.command === undefined ? {} : { command: options.command }),
    exitCode: options.exitCode,
    ...(options.results === undefined ? {} : { results: options.results }),
  };

  return {
    status: options.code === 'TERMINAL_INTERRUPTED' ? 'aborted' : 'failed',
    code: options.code,
    message: options.message,
    error: new TerminalToolError(options.code, options.message, {
      details: options.details,
      ...(options.command === undefined ? {} : { command: options.command }),
      exitCode: options.exitCode,
    }),
    data,
  };
}

/**
 * Runs a request and cancels every session it started when the caller aborts.
 *
 * `ITerminalHandle.run` does not accept an AbortSignal (the scoped facade is
 * deliberately minimal), so the handler snapshots the live session list and
 * cancels the new sessions when the tool context's signal fires. Awaiting the
 * original promise preserves the measured `interrupted` outcome instead of
 * synthesising one.
 */
export async function runWithCancellation(
  terminal: ITerminalHandle,
  request: TerminalRunRequest,
  signal: AbortSignal | undefined,
): Promise<TerminalResult> {
  const existing = new Set(terminal.list().map((session) => session.executionId));

  const abort = (): void => {
    for (const session of terminal.list()) {
      if (!existing.has(session.executionId)) {
        void terminal.cancel(session.executionId);
      }
    }
  };

  signal?.addEventListener('abort', abort, { once: true });

  try {
    return await terminal.run(request);
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

/** Converts an unexpected driver fault into a structured failure. */
export function internalFailure(
  command: string | undefined,
  error: unknown,
): TerminalOperationResult {
  const details = error instanceof Error ? error.message : String(error);

  return terminalFailureResult({
    code: 'EXECUTION_FAILED',
    message: 'Terminal command failed.',
    details,
    ...(command === undefined ? {} : { command }),
    exitCode: null,
  });
}