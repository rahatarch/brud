import type {
  IPluginExecutionContext,
  ITerminalHandle,
  TerminalGroupOutcome,
  TerminalRunOutcome,
  TerminalRunRequest,
} from '@brud/kernel';
import {
  failureCodeFor,
  failureDetailsFor,
  internalFailure,
  isGroupResult,
  runWithCancellation,
  terminalFailureResult,
  toCommandData,
  toCommandGroup,
  toGroupData,
  toMilliseconds,
} from '../shared/terminalResult.js';
import type { TerminalOperationResult } from '../shared/terminalResult.js';

/**
 * JSON Schema for `terminal_command`.
 *
 * Mirrors the legacy discovery audit (`packages/core/src/tool-registry/init.ts`
 * lines 465-492): every field is optional because the tool dispatches one of
 * single, batch, or conditional mode from the supplied fields.
 */
export const TERMINAL_COMMAND_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    command: {
      type: 'string',
      description: 'Single command to run',
    },
    commands: {
      type: 'array',
      items: { type: 'string' },
      description: 'Multiple commands',
    },
    mode: {
      type: 'string',
      enum: ['sequential', 'parallel'],
      description: 'Execution mode: sequential or parallel',
    },
    stopOnFailure: {
      type: 'boolean',
      description: 'Stop on error for sequential mode',
    },
    onSuccess: {
      type: 'string',
      description: 'Command to run on success',
    },
    onFailure: {
      type: 'string',
      description: 'Command to run on failure',
    },
    timeout: {
      type: 'number',
      description: 'Maximum seconds to wait',
    },
  },
  required: [],
  additionalProperties: false,
};

interface BuiltRequest {
  readonly request: TerminalRunRequest;
  readonly timeoutMs: number;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.every((entry): entry is string => typeof entry === 'string')
    ? value
    : undefined;
}

function invalid(details: string): TerminalOperationResult {
  return terminalFailureResult({
    code: 'EXECUTION_FAILED',
    message: 'Terminal command failed.',
    details,
    exitCode: null,
  });
}

/**
 * Translates the tool payload into a `brud.core.terminal` request.
 *
 * Batch mode wins over conditional mode, and conditional mode wins over a
 * single command, matching the legacy handler's branch order. The schema's
 * seconds are converted to the service's milliseconds here so the handler and
 * the transport never disagree about the unit.
 */
export function createTerminalCommandRequest(
  input: Record<string, unknown>,
): BuiltRequest | TerminalOperationResult {
  const timeoutMs = toMilliseconds(input.timeout);
  const commands = readStringArray(input.commands);

  if (commands !== undefined && commands.length > 0) {
    return {
      request: {
        mode: input.mode === 'parallel' ? 'parallel' : 'sequential',
        commands,
        stopOnFailure: input.stopOnFailure !== false,
        timeoutMs,
      },
      timeoutMs,
    };
  }

  const onSuccess = readString(input.onSuccess);
  const onFailure = readString(input.onFailure);

  if (onSuccess !== undefined || onFailure !== undefined) {
    const command = readString(input.command);

    if (command === undefined) {
      return invalid('Conditional execution requires a "command" to evaluate.');
    }

    return {
      request: {
        mode: 'conditional',
        command,
        ...(onSuccess === undefined ? {} : { onSuccess: toCommandGroup(onSuccess) }),
        ...(onFailure === undefined ? {} : { onFailure: toCommandGroup(onFailure) }),
        timeoutMs,
      },
      timeoutMs,
    };
  }

  const command = readString(input.command);

  if (command === undefined) {
    return invalid('A terminal command requires either "command" or a non-empty "commands" list.');
  }

  return {
    request: { mode: 'single', command, timeoutMs },
    timeoutMs,
  };
}

function interruptedBeforeStart(command: string | undefined): TerminalOperationResult {
  return terminalFailureResult({
    code: 'TERMINAL_INTERRUPTED',
    message: 'Terminal command was interrupted before it started.',
    details: 'The request was cancelled before any command ran.',
    ...(command === undefined ? {} : { command }),
    exitCode: null,
  });
}

function mapGroupResult(
  mode: 'sequential' | 'parallel' | 'conditional',
  result: TerminalGroupOutcome,
  timeoutMs: number,
): TerminalOperationResult {
  const succeeded = result.results.filter((entry) => entry.success).length;
  const failed = result.results.length - succeeded;
  const message = mode === 'conditional'
    ? `Executed conditional command. ${succeeded} succeeded, ${failed} failed.`
    : `Executed ${result.results.length} commands. ${succeeded} succeeded, ${failed} failed.`;
  const data = toGroupData(result.results);

  if (result.success) {
    return { status: 'success', message, data };
  }

  const interrupted = result.results.find((entry) => entry.status === 'interrupted');
  const failing = interrupted ?? result.results.find((entry) => !entry.success);
  const code = failing === undefined ? 'EXECUTION_FAILED' : failureCodeFor(failing);
  const details = failing === undefined
    ? 'The terminal group failed without a command result.'
    : failureDetailsFor(code, failing.command, failing, timeoutMs);

  return terminalFailureResult({
    code,
    message,
    details,
    ...(failing === undefined ? {} : { command: failing.command }),
    exitCode: failing?.exitCode ?? null,
    results: data,
  });
}

function mapSingleResult(
  command: string,
  result: TerminalRunOutcome,
  timeoutMs: number,
): TerminalOperationResult {
  const message = result.success
    ? `Terminal command executed successfully.\nOutput:\n${result.output}`
    : `Terminal command failed (exit code: ${result.exitCode})\nOutput:\n${result.output}`;

  if (result.success && result.exitCode === 0) {
    return {
      status: 'success',
      message,
      data: toCommandData(command, result),
    };
  }

  const code = failureCodeFor(result);

  return terminalFailureResult({
    code,
    message,
    details: failureDetailsFor(code, command, result, timeoutMs),
    command,
    exitCode: result.exitCode,
  });
}

/**
 * Executes `terminal_command` through the plugin-scoped terminal handle.
 *
 * Cancellation is propagated by cancelling the live sessions the request
 * started; the measured `interrupted` outcome is then mapped to
 * `TERMINAL_INTERRUPTED` exactly like the service would report it.
 */
export async function terminalCommand(
  input: Record<string, unknown>,
  terminal: ITerminalHandle,
  context: IPluginExecutionContext,
): Promise<TerminalOperationResult> {
  const built = createTerminalCommandRequest(input);

  if ('status' in built) {
    return built;
  }

  const { request, timeoutMs } = built;

  if (context.signal?.aborted === true) {
    return interruptedBeforeStart(request.command ?? request.commands?.[0]);
  }

  let result: Awaited<ReturnType<ITerminalHandle['run']>>;

  try {
    result = await runWithCancellation(terminal, request, context.signal);
  } catch (error: unknown) {
    return internalFailure(request.command ?? request.commands?.[0], error);
  }

  if (isGroupResult(result)) {
    const mode = request.mode === 'conditional' || request.mode === 'parallel'
      ? request.mode
      : 'sequential';

    return mapGroupResult(mode, result, timeoutMs);
  }

  return mapSingleResult(request.command ?? '', result, timeoutMs);
}