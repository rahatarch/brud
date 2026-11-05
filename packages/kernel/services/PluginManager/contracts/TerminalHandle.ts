import type {
  ITerminalService,
  TerminalChunkCallback,
  TerminalResult,
  TerminalRunFailure,
  TerminalRunOutcome,
  TerminalRunRequest,
  TerminalSessionInfo,
} from '../../TerminalService/contracts/ITerminalService.js';
import type { TerminalDecision } from '../../TerminalService/contracts/errors.js';
import type { ITerminalHandle, TerminalExecutionInfo } from './ITerminalHandle.js';

/** Construction options for {@link createTerminalHandle}. */
export interface TerminalHandleOptions {
  /** Underlying `brud.core.terminal` service. */
  readonly service: ITerminalService;

  /** Plugin id that owns the handle and all executions it starts. */
  readonly callerId: string;

  /** Workspace root pinned as the default working directory. */
  readonly workspaceRoot: string;
}

/**
 * Maps a terminal error code onto the narrower run-failure taxonomy.
 *
 * Gate rejections and internal faults have no `TerminalRunFailure` member, so
 * they produce no failure field and are reported through the output text.
 */
function runFailureFor(decision: Extract<TerminalDecision, { readonly ok: false }>): TerminalRunFailure | undefined {
  switch (decision.code) {
    case 'TERMINAL_SPAWN_FAILED':
      return 'TERMINAL_SPAWN_FAILED';
    case 'TERMINAL_EXIT_NONZERO':
      return 'TERMINAL_EXIT_NONZERO';
    case 'TERMINAL_TIMEOUT':
      return 'TERMINAL_TIMEOUT';
    case 'TERMINAL_OUTPUT_LIMIT':
      return 'TERMINAL_OUTPUT_LIMIT';
    case 'TERMINAL_INTERRUPTED':
      return 'TERMINAL_INTERRUPTED';
    default:
      return undefined;
  }
}

function failureOutcome(
  decision: Extract<TerminalDecision, { readonly ok: false }>,
): TerminalRunOutcome {
  const failure = runFailureFor(decision);
  const output = decision.details.length > 0 ? decision.details : decision.friendly;

  return {
    success: false,
    output,
    exitCode: decision.exitCode ?? null,
    duration: 0,
    status: 'failed',
    ...(failure === undefined ? {} : { failure }),
  };
}

function toExecutionInfo(session: TerminalSessionInfo): TerminalExecutionInfo {
  return {
    executionId: session.processId,
    ...(session.pid === undefined ? {} : { pid: session.pid }),
    mode: session.mode,
    command: session.command,
    startedAt: session.startedAt,
    ...(session.callerId === undefined ? {} : { callerId: session.callerId }),
  };
}

/**
 * Creates the plugin-scoped terminal facade exposed by
 * {@link IPluginContext.getTerminal}.
 *
 * Sessions are attributed to the plugin through `callerId`; therefore
 * `list()`, `cancel()` and `dispose()` only ever see executions started by
 * this handle's plugin.
 *
 * @param options - Service, plugin id and pinned workspace root.
 * @returns A cancellation-isolated terminal handle.
 */
export function createTerminalHandle(options: TerminalHandleOptions): ITerminalHandle {
  const { service, callerId, workspaceRoot } = options;
  let disposed = false;

  const ownedSessions = (): readonly TerminalExecutionInfo[] =>
    service
      .activeSessions()
      .filter((session) => session.callerId === callerId)
      .map(toExecutionInfo);

  return Object.freeze({
    async run(
      request: TerminalRunRequest,
      onChunk?: TerminalChunkCallback,
    ): Promise<TerminalResult> {
      if (disposed) {
        throw new Error(`Terminal handle for "${callerId}" has been disposed`);
      }

      const decision = await service.run(
        {
          ...request,
          cwd: request.cwd ?? workspaceRoot,
          callerId,
        },
        onChunk === undefined ? undefined : { onChunk },
      );

      if (decision.ok) {
        return decision.result;
      }

      if (decision.result !== undefined) {
        return decision.result;
      }

      return failureOutcome(decision);
    },

    async cancel(executionId: string): Promise<void> {
      if (disposed) {
        return;
      }

      const owned = service
        .activeSessions()
        .some((session) => session.processId === executionId && session.callerId === callerId);

      if (owned) {
        service.kill(executionId);
      }
    },

    list(): readonly TerminalExecutionInfo[] {
      return disposed ? Object.freeze([]) : Object.freeze(ownedSessions());
    },

    async dispose(): Promise<void> {
      if (disposed) {
        return;
      }

      disposed = true;

      for (const session of ownedSessions()) {
        service.kill(session.executionId);
      }
    },
  });
}