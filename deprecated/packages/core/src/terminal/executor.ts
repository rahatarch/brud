import type {
  ITerminalService,
  TerminalDecision,
  TerminalErrorCode,
  TerminalResult as KernelResult,
  TerminalExecutedCommand,
  TerminalGroupOutcome,
  TerminalRunOutcome,
  TerminalRunRequest,
} from '@brud/kernel' with { 'resolution-mode': 'import' };
import type { TerminalExecutor, TerminalResult, TerminalFailureCause, GroupResult, ExecutedCommand, ConditionalCommand, CommandGroup, ChunkCallback } from './types';
import { terminalAuthority } from './binding';

/**
 * Legacy `TerminalExecutor` facade over `brud.core.terminal`.
 *
 * The public signatures are frozen: every transport (VS Code extension,
 * daemon adapter, MCP server, kernel legacy bridge) composes this module and
 * must keep working unchanged. Execution, validation, environment sanitation
 * and streaming are kernel responsibilities; this façade only adapts shapes.
 */

/** The legacy facade surface, resolved from the process-wide kernel binding. */
function service(): ITerminalService {
  return terminalAuthority();
}

/** The kernel decision arm the facade consumes. */
type TerminalFailureDecision = Extract<TerminalDecision, { readonly ok: false }>;

/**
 * Maps a kernel failure code onto the legacy failure classification.
 *
 * The legacy `TerminalResult` has no error channel, so a gate rejection is
 * reported as a failed result that also carries the kernel code: a caller can
 * still tell "the service is unbound" or "the command was refused" from a
 * command that actually ran and failed.
 *
 * @param code - Kernel failure code.
 */
function failureCauseOf(code: TerminalErrorCode): TerminalFailureCause {
  switch (code) {
    case 'TERMINAL_UNAVAILABLE':
      return 'TERMINAL_UNAVAILABLE';
    case 'TERMINAL_INVALID_REQUEST':
      return 'TERMINAL_INVALID_REQUEST';
    case 'TERMINAL_BLOCKED':
      return 'TERMINAL_BLOCKED';
    case 'TERMINAL_SPAWN_FAILED':
      return 'TERMINAL_SPAWN_FAILED';
    case 'TERMINAL_TIMEOUT':
      return 'TERMINAL_TIMEOUT';
    case 'TERMINAL_INTERRUPTED':
      return 'TERMINAL_INTERRUPTED';
    case 'TERMINAL_OUTPUT_LIMIT':
      return 'TERMINAL_OUTPUT_LIMIT';
    case 'TERMINAL_EXIT_NONZERO':
      return 'TERMINAL_EXIT_NONZERO';
    case 'TERMINAL_INTERNAL':
    default:
      return 'TERMINAL_INTERNAL';
  }
}

/**
 * Maps a kernel failure onto the legacy result shape.
 *
 * An interrupted command reports `status: 'interrupted'` with no exit code,
 * exactly like a command the caller cancelled; every other rejection is a
 * `failed` result whose output carries the user-facing message.
 *
 * @param decision - Failed decision.
 */
function failedResult(decision: TerminalFailureDecision): TerminalResult {
  const failure = failureCauseOf(decision.code);
  const interrupted = failure === 'TERMINAL_INTERRUPTED';

  return {
    success: false,
    output: decision.details,
    exitCode: interrupted ? null : decision.exitCode,
    duration: 0,
    status: interrupted ? 'interrupted' : 'failed',
    failure,
  };
}

/**
 * Converts a kernel run outcome into the legacy result.
 *
 * @param outcome - Measured outcome.
 */
function toResult(outcome: TerminalRunOutcome): TerminalResult {
  return {
    success: outcome.success,
    output: outcome.output,
    exitCode: outcome.exitCode,
    duration: outcome.duration,
    status: outcome.status,
    ...(outcome.failure === undefined ? {} : { failure: outcome.failure }),
  };
}

/**
 * Converts a kernel group outcome into the legacy group result.
 *
 * @param outcome - Measured group outcome.
 */
function toGroupResult(outcome: TerminalGroupOutcome): GroupResult {
  return {
    success: outcome.success,
    results: outcome.results.map(toExecuted),
    totalDuration: outcome.totalDuration,
  };
}

/**
 * Converts one executed command.
 *
 * @param executed - Kernel executed command.
 */
function toExecuted(executed: TerminalExecutedCommand): ExecutedCommand {
  return {
    command: executed.command,
    success: executed.success,
    output: executed.output,
    exitCode: executed.exitCode,
    duration: executed.duration,
    status: executed.status,
    ...(executed.failure === undefined ? {} : { failure: executed.failure }),
  };
}

/**
 * Builds the request envelope shared by every facade entry point.
 *
 * @param cwd - Working directory.
 * @param timeout - Legacy timeout in milliseconds.
 * @param env - Extra environment variables.
 */
function baseRequest(
  cwd: string | undefined,
  timeout: number | undefined,
  env: Record<string, string> | undefined,
): Pick<TerminalRunRequest, 'cwd' | 'timeoutMs' | 'env'> {
  return {
    ...(cwd === undefined ? {} : { cwd }),
    ...(timeout === undefined ? {} : { timeoutMs: timeout }),
    ...(env === undefined ? {} : { env }),
  };
}

/**
 * Reads the measured outcome of a decision.
 *
 * The kernel's `decide()` returns a failure decision for a command that ran
 * and failed or was interrupted, so the measured outcome is not reachable
 * through the success arm alone: an execution failure attaches it as
 * `result`. A gate rejection (`TERMINAL_BLOCKED`, `TERMINAL_INVALID_REQUEST`,
 * `TERMINAL_UNAVAILABLE`, ...) carries no outcome at all, which is how the two
 * are told apart.
 *
 * @param decision - Kernel decision.
 */
function measuredOf(decision: TerminalDecision): KernelResult | undefined {
  return decision.result;
}

/**
 * Resolves a legacy result union into a single-command result.
 *
 * @param decision - Kernel decision.
 */
function singleFrom(decision: TerminalDecision): TerminalResult {
  const measured = measuredOf(decision);

  if (measured === undefined) {
    return failedResult(decision as TerminalFailureDecision);
  }

  const result = measured as unknown as TerminalResult;
  const candidate = result as unknown as GroupResult;

  if (Array.isArray(candidate.results)) {
    const first = candidate.results[0];

    return first === undefined
      ? { success: false, output: '', exitCode: null, duration: 0, status: 'failed' }
      : first;
  }

  return toResult(result as unknown as TerminalRunOutcome);
}

/**
 * Resolves a legacy result union into a group result.
 *
 * @param decision - Kernel decision.
 */
function groupFrom(decision: TerminalDecision): GroupResult {
  const measured = measuredOf(decision);

  if (measured === undefined) {
    return { success: false, results: [], totalDuration: 0 };
  }

  const result = measured as unknown as TerminalResult;
  const candidate = result as unknown as GroupResult;

  if (Array.isArray(candidate.results)) {
    return candidate;
  }

  const single = result as unknown as TerminalRunOutcome;

  return {
    success: single.success,
    results: [toExecuted({ command: '', ...single })],
    totalDuration: single.duration,
  };
}

export const executeCommand: TerminalExecutor['executeCommand'] = async (
  command: string,
  cwd?: string,
  timeout: number = 120000,
  env?: Record<string, string>,
  onChunk?: ChunkCallback,
  signal?: AbortSignal,
): Promise<TerminalResult> => {
  const decision = await service().run(
    { ...baseRequest(cwd, timeout, env), command, mode: 'single' },
    { ...(onChunk === undefined ? {} : { onChunk }), ...(signal === undefined ? {} : { signal }) },
  );

  return singleFrom(decision);
};

export const executeTerminalCommand: TerminalExecutor['execute'] = async (
  command: string,
  answers: string[],
  cwd?: string,
  timeout: number = 120000,
  env?: Record<string, string>,
  onChunk?: ChunkCallback,
  signal?: AbortSignal,
): Promise<TerminalResult> => {
  const request: TerminalRunRequest = {
    ...baseRequest(cwd, timeout, env),
    command,
    mode: 'interactive',
    answers,
  };
  const decision = await service().run(request, {
    ...(onChunk === undefined ? {} : { onChunk }),
    ...(signal === undefined ? {} : { signal }),
  });

  return singleFrom(decision);
};

export const executeSequential: TerminalExecutor['executeSequential'] = async (
  commands: string[],
  cwd?: string,
  timeout: number = 120000,
  env?: Record<string, string>,
  stopOnFailure?: boolean,
  onChunk?: ChunkCallback,
  signal?: AbortSignal,
): Promise<GroupResult> => {
  const request: TerminalRunRequest = {
    ...baseRequest(cwd, timeout, env),
    commands,
    mode: 'sequential',
    stopOnFailure: stopOnFailure === true,
  };
  const decision = await service().run(request, {
    ...(onChunk === undefined ? {} : { onChunk }),
    ...(signal === undefined ? {} : { signal }),
  });

  return groupFrom(decision);
};

export const executeParallel: TerminalExecutor['executeParallel'] = async (
  commands: string[],
  cwd?: string,
  timeout: number = 120000,
  env?: Record<string, string>,
  onChunk?: ChunkCallback,
  signal?: AbortSignal,
): Promise<GroupResult> => {
  const request: TerminalRunRequest = {
    ...baseRequest(cwd, timeout, env),
    commands,
    mode: 'parallel',
  };
  const decision = await service().run(request, {
    ...(onChunk === undefined ? {} : { onChunk }),
    ...(signal === undefined ? {} : { signal }),
  });

  return groupFrom(decision);
};

export async function executeCommandGroup(
  group: CommandGroup,
  cwd?: string,
  timeout?: number,
  env?: Record<string, string>,
  onChunk?: ChunkCallback,
  signal?: AbortSignal,
): Promise<GroupResult> {
  const links: string[] = [];
  const subGroups: Array<{ group: CommandGroup; index: number }> = [];

  for (let index = 0; index < group.commands.length; index++) {
    const entry = group.commands[index];

    if (typeof entry === 'string') {
      links.push(entry);
    } else {
      subGroups.push({ group: entry, index });
    }
  }

  const stringResults: ExecutedCommand[] = [];

  if (links.length > 0) {
    const request: TerminalRunRequest = {
      ...baseRequest(cwd, timeout, env),
      commands: links,
      mode: group.type === 'parallel' ? 'parallel' : 'sequential',
      stopOnFailure: group.stopOnFailure === true,
    };
    const decision = await service().run(request, {
      ...(onChunk === undefined ? {} : { onChunk }),
      ...(signal === undefined ? {} : { signal }),
    });
    stringResults.push(...groupFrom(decision).results);
  }

  const nested: ExecutedCommand[] = [];

  for (const subGroup of subGroups) {
    const subResult = await executeCommandGroup(subGroup.group, cwd, timeout, env, onChunk, signal);
    nested.push(...subResult.results);
  }

  // Flat commands keep their declaration order and nested groups contribute
  // their results after them, matching the legacy assembly: the legacy test
  // asserts `[outer_first, outer_last]` precede the nested parallel pair.
  const results: ExecutedCommand[] = [...stringResults, ...nested];
  const success = results.every((result) => result.success);

  return {
    success,
    results,
    totalDuration: results.reduce((sum, result) => sum + result.duration, 0),
  };
}

export const executeConditional: TerminalExecutor['executeConditional'] = async (
  conditional: ConditionalCommand,
  cwd?: string,
  timeout: number = 120000,
  env?: Record<string, string>,
  onChunk?: ChunkCallback,
  signal?: AbortSignal,
): Promise<GroupResult> => {
  const request: TerminalRunRequest = {
    ...baseRequest(cwd, timeout, env),
    command: conditional.command,
    mode: 'conditional',
    ...(conditional.onSuccess === undefined ? {} : { onSuccess: conditional.onSuccess }),
    ...(conditional.onFailure === undefined ? {} : { onFailure: conditional.onFailure }),
  };
  const decision = await service().run(request, {
    ...(onChunk === undefined ? {} : { onChunk }),
    ...(signal === undefined ? {} : { signal }),
  });

  return groupFrom(decision);
};

