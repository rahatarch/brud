import type {
  IPluginExecutionContext,
  ITerminalHandle,
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
  toMilliseconds,
} from '../shared/terminalResult.js';
import type { TerminalOperationResult } from '../shared/terminalResult.js';

/**
 * JSON Schema for `terminal_interactive`.
 *
 * Mirrors the legacy discovery audit (the quarantined legacy engine's `tool-registry/init.ts`
 * lines 440-463). Both `command` and `answers` are required; an empty array is
 * accepted because it means "run interactively without supplying answers".
 */
export const TERMINAL_INTERACTIVE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    command: {
      type: 'string',
      description: 'Terminal command to run',
    },
    answers: {
      type: 'array',
      items: { type: 'string' },
      description: 'Responses to interactive prompts in order',
    },
    timeout: {
      type: 'number',
      description: 'Maximum seconds to wait',
    },
    cwd: {
      type: 'string',
      description: 'Working directory; resolved and validated against the workspace',
    },
    env: {
      type: 'object',
      additionalProperties: { type: 'string' },
      description: 'Additional environment variables for the interactive session',
    },
  },
  required: ['command', 'answers'],
  additionalProperties: false,
};

interface BuiltInteractiveRequest {
  readonly request: TerminalRunRequest;
  readonly timeoutMs: number;
}

function readAnswers(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.every((entry): entry is string => typeof entry === 'string')
    ? value
    : undefined;
}

function readCwd(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/**
 * Reads the optional `env` map.
 *
 * Returns `undefined` when the field is absent, `null` when it is present but
 * malformed. The schema already enforces the object-of-strings shape on the
 * dispatch path; this guard keeps the exported builder honest for direct use.
 */
function readEnv(value: unknown): Readonly<Record<string, string>> | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const entries = Object.entries(value);

  if (!entries.every(([, entry]) => typeof entry === 'string')) {
    return null;
  }

  return Object.fromEntries(entries) as Record<string, string>;
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
 * Translates the tool payload into an interactive terminal request.
 *
 * @param input - Validated payload from the tool registry.
 * @returns The request and the timeout it will use, or a structured failure.
 */
export function createTerminalInteractiveRequest(
  input: Record<string, unknown>,
): BuiltInteractiveRequest | TerminalOperationResult {
  const command = input.command;
  const answers = readAnswers(input.answers);

  if (typeof command !== 'string' || command.length === 0) {
    return invalid('Interactive execution requires a non-empty "command".');
  }

  if (answers === undefined) {
    return invalid('Interactive execution requires "answers" to be an array of strings.');
  }

  const timeoutMs = toMilliseconds(input.timeout);
  const cwd = readCwd(input.cwd);
  const env = readEnv(input.env);

  if (env === null) {
    return invalid('"env" must be an object whose values are strings.');
  }

  return {
    request: {
      mode: 'interactive',
      command,
      answers,
      timeoutMs,
      ...(cwd === undefined ? {} : { cwd }),
      ...(env === undefined ? {} : { env }),
    },
    timeoutMs,
  };
}

function interruptedBeforeStart(command: string): TerminalOperationResult {
  return terminalFailureResult({
    code: 'TERMINAL_INTERRUPTED',
    message: 'Terminal command was interrupted before it started.',
    details: 'The request was cancelled before any command ran.',
    command,
    exitCode: null,
  });
}

/**
 * Executes `terminal_interactive` through the plugin-scoped terminal handle.
 *
 * Answers are delivered by the terminal service on stdout quiescence, so the
 * handler only has to forward the ordered list and translate the measured
 * outcome into the legacy OperationResult envelope.
 */
export async function terminalInteractive(
  input: Record<string, unknown>,
  terminal: ITerminalHandle,
  context: IPluginExecutionContext,
): Promise<TerminalOperationResult> {
  const built = createTerminalInteractiveRequest(input);

  if ('status' in built) {
    return built;
  }

  const { request, timeoutMs } = built;

  if (context.signal?.aborted === true) {
    return interruptedBeforeStart(request.command ?? '');
  }

  let result: TerminalRunOutcome;

  try {
    const outcome = await runWithCancellation(terminal, request, context.signal);

    if (isGroupResult(outcome)) {
      return internalFailure(
        request.command,
        new Error('Interactive execution returned a group outcome'),
      );
    }

    result = outcome;
  } catch (error: unknown) {
    return internalFailure(request.command, error);
  }

  const command = request.command ?? '';
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