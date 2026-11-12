import type {
  TerminalChunkCallback,
  TerminalResult,
  TerminalRunMode,
  TerminalRunRequest,
} from '../../TerminalService/contracts/ITerminalService.js';

/**
 * Live view of one terminal execution owned by a plugin handle.
 *
 * `executionId` is the terminal service session id, so a plugin can cancel the
 * execution it started without learning the underlying process id.
 */
export interface TerminalExecutionInfo {
  /** Stable execution id (`proc-<timestamp>-<counter>`). */
  readonly executionId: string;

  /** OS process id, when the spawn succeeded. */
  readonly pid?: number;

  /** Request mode that created the execution. */
  readonly mode: TerminalRunMode;

  /** Command text of the execution. */
  readonly command: string;

  /** Epoch milliseconds at spawn. */
  readonly startedAt: number;

  /** Calling plugin id. */
  readonly callerId?: string;
}

/**
 * Plugin-scoped terminal execution handle.
 *
 * The handle is a thin authorization and isolation facade over
 * `brud.core.terminal`: it pins the workspace root and caller identity so a
 * plugin can only observe and cancel sessions it created.
 *
 * Decision failures (a blocked command, a timeout, a non-zero exit) resolve to
 * a `TerminalResult`; they never reject. Only a driver fault can reject.
 */
export interface ITerminalHandle {
  /**
   * Validates, admits and executes one terminal request.
   *
   * @param request - Fully described request. `callerId` and a missing `cwd`
   * are supplied by the handle.
   * @param onChunk - Optional streaming receiver for stdout and stderr.
   */
  run(request: TerminalRunRequest, onChunk?: TerminalChunkCallback): Promise<TerminalResult>;

  /**
   * Cancels one execution started by this plugin.
   *
   * @param executionId - Id returned by {@link list}.
   */
  cancel(executionId: string): Promise<void>;

  /** Live executions started by this plugin, in creation order. */
  list(): readonly TerminalExecutionInfo[];

  /** Cancels every live execution this plugin started and releases the handle. */
  dispose(): Promise<void>;
}