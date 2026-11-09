import type {
  IActionExecutionContext,
  ITerminalHandle,
  OperationResult,
  TerminalRunMode,
} from '@brud/kernel';

/** Action name that terminates one plugin-owned terminal process. */
export const TERMINAL_KILL_PROCESS_ACTION = 'terminal.kill_process';

/** Action name that lists the plugin's own live terminal processes. */
export const TERMINAL_LIST_PROCESSES_ACTION = 'terminal.list_processes';

/**
 * JSON Schema for `terminal.kill_process`.
 *
 * `processId` is the identifier reported by `terminal.list_processes`, which is
 * the terminal session id. Unknown properties are rejected by the action gate.
 */
export const TERMINAL_KILL_PROCESS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    processId: {
      type: 'string',
      description: 'Process id reported by terminal.list_processes',
    },
  },
  required: ['processId'],
  additionalProperties: false,
};

/** JSON Schema for `terminal.list_processes`; it takes no input. */
export const TERMINAL_LIST_PROCESSES_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
};

/** UI-facing view of one live terminal process owned by this plugin. */
export interface TerminalProcessInfo {
  /** Identifier to pass to `terminal.kill_process`. */
  readonly processId: string;
  /** OS process id, when the spawn succeeded. */
  readonly pid?: number;
  readonly mode: TerminalRunMode;
  readonly command: string;
  readonly startedAt: number;
  readonly callerId?: string;
}

function toProcessInfo(
  process: ReturnType<ITerminalHandle['list']>[number],
): TerminalProcessInfo {
  return {
    processId: process.executionId,
    ...(process.pid === undefined ? {} : { pid: process.pid }),
    mode: process.mode,
    command: process.command,
    startedAt: process.startedAt,
    ...(process.callerId === undefined ? {} : { callerId: process.callerId }),
  };
}

/**
 * Executes `terminal.kill_process`.
 *
 * The action is isolated to the plugin's own processes: the scoped handle only
 * observes sessions it created, so another plugin's or the host's process can
 * never be selected. An unknown id resolves to a structured failure instead of
 * silently succeeding.
 */
export async function terminalKillProcess(
  input: Record<string, unknown>,
  terminal: ITerminalHandle,
  _context?: IActionExecutionContext,
): Promise<OperationResult<TerminalProcessInfo>> {
  const processId = input.processId;

  if (typeof processId !== 'string' || processId.length === 0) {
    return {
      status: 'failed',
      message: 'A non-empty "processId" is required.',
      error: 'TERMINAL_PROCESS_ID_REQUIRED',
    };
  }

  const target = terminal.list().find((process) => process.executionId === processId);

  if (target === undefined) {
    return {
      status: 'failed',
      message: `No live terminal process "${processId}" is owned by this plugin.`,
      error: 'TERMINAL_PROCESS_NOT_FOUND',
    };
  }

  await terminal.cancel(processId);

  return {
    status: 'success',
    message: `Terminated terminal process "${processId}".`,
    data: toProcessInfo(target),
  };
}

/**
 * Executes `terminal.list_processes`.
 *
 * Only sessions attributed to this plugin are returned; the scoped handle
 * filters on caller identity, so the result cannot leak other plugins' or the
 * host's processes.
 */
export function terminalListProcesses(
  _input: Record<string, unknown>,
  terminal: ITerminalHandle,
  _context?: IActionExecutionContext,
): Promise<OperationResult<{ readonly processes: readonly TerminalProcessInfo[] }>> {
  const processes = terminal.list().map(toProcessInfo);

  return Promise.resolve({
    status: 'success',
    message: `${processes.length} live terminal process${processes.length === 1 ? '' : 'es'}.`,
    data: { processes },
  });
}