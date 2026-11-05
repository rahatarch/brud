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
 * Mirrors the legacy discovery audit (`packages/core/src/tool-registry/init.ts`
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

  return {
    request: {
      mode: 'interactive',
      command,
      answers,
      timeoutMs,
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