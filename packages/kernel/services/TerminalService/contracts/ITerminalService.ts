import type { ChildProcessLike } from '../engine/ProcessManager.js';
import type { TerminalDecision } from './errors.js';
import type { TerminalPolicy } from './policies.js';

/** Terminal result status taxonomy. */
export type TerminalStatus = 'success' | 'failed' | 'interrupted';

/** Failure classification attached to a non-successful outcome. */
export type TerminalRunFailure =
  | 'TERMINAL_SPAWN_FAILED'
  | 'TERMINAL_EXIT_NONZERO'
  | 'TERMINAL_TIMEOUT'
  | 'TERMINAL_OUTPUT_LIMIT'
  | 'TERMINAL_INTERRUPTED';

/** Payload of one command or interactive session. */
export interface TerminalRunOutcome {
  readonly success: boolean;
  readonly output: string;
  readonly exitCode: number | null;
  readonly duration: number;
  readonly status: TerminalStatus;
  /** Why the command failed; absent for success and interruption. */
  readonly failure?: TerminalRunFailure;
}

/** One executed command inside a batch or conditional group. */
export interface TerminalExecutedCommand extends TerminalRunOutcome {
  readonly command: string;
}

/** Result of a sequential, parallel or conditional batch. */
export interface TerminalGroupOutcome {
  readonly success: boolean;
  readonly results: readonly TerminalExecutedCommand[];
  readonly totalDuration: number;
}

/**
 * Result union produced by {@link ITerminalService.run}.
 *
 * `execute()` (interactive) and `executeCommand()` (single) resolve to
 * {@link TerminalRunOutcome}; every composite mode resolves to
 * {@link TerminalGroupOutcome}. Consumers branch on the request mode they
 * sent, exactly as the legacy executor contract already requires.
 */
export type TerminalResult = TerminalRunOutcome | TerminalGroupOutcome;

/** Command tree executed after a conditional completes. */
export interface TerminalCommandGroup {
  readonly type: 'sequential' | 'parallel';
  readonly commands: readonly (string | TerminalCommandGroup)[];
  readonly stopOnFailure?: boolean;
}

/** Conditional request: one command, then exactly one branch. */
export interface TerminalConditionalCommand {
  readonly command: string;
  readonly onSuccess?: TerminalCommandGroup;
  readonly onFailure?: TerminalCommandGroup;
}

/** Run mode selected by the caller. */
export type TerminalRunMode = 'single' | 'interactive' | 'sequential' | 'parallel' | 'conditional';

/**
 * Fully described terminal request.
 *
 * The orchestrator re-validates every command in this request — including the
 * `onSuccess` and `onFailure` trees — before anything spawns, so a request is
 * not trusted merely because a legacy dispatcher already checked it.
 */
export interface TerminalRunRequest {
  /** Primary command, used by `single`, `interactive` and `conditional`. */
  readonly command?: string;

  /** Ordered command list, used by `sequential` and `parallel`. */
  readonly commands?: readonly string[];

  /** Run mode. Defaults to `single`. */
  readonly mode?: TerminalRunMode;

  /** Stop a sequential batch at the first failure. */
  readonly stopOnFailure?: boolean;

  /** Branch executed when the conditional primary command succeeds. */
  readonly onSuccess?: TerminalCommandGroup;

  /** Branch executed when the conditional primary command fails. */
  readonly onFailure?: TerminalCommandGroup;

  /** Answers written to stdin for an interactive session. */
  readonly answers?: readonly string[];

  /** Working directory; the orchestrator resolves it against the workspace. */
  readonly cwd?: string;

  /** Per-command timeout in milliseconds. */
  readonly timeoutMs?: number;

  /** Additional environment variables, subject to the policy allow/deny lists. */
  readonly env?: Readonly<Record<string, string>>;

  /**
   * Identity of the calling transport. Reported on every session record so a
   * host can attribute and kill only its own sessions.
   */
  readonly callerId?: string;
}

/** Options accepted alongside a request. */
export interface TerminalRunOptions {
  /** Cancels every child spawned by this request. */
  readonly signal?: AbortSignal;

  /** Receives stdout and stderr chunks in arrival order. */
  readonly onChunk?: TerminalChunkCallback;
}

/**
 * Streaming callback.
 *
 * `chunkIndex` is the session-wide arrival index; `stream` identifies the
 * channel so a consumer can render stderr differently without losing order.
 * `truncated` is set on the final chunk of a stream that hit the ceiling.
 */
export type TerminalChunkCallback = (
  chunk: string,
  chunkIndex: number,
  stream?: 'stdout' | 'stderr',
) => void;

/** Live view of one registered session. */
export interface TerminalSessionInfo {
  /** Stable session id (`proc-<timestamp>-<counter>`). */
  readonly processId: string;
  /** OS process id, when the spawn succeeded. */
  readonly pid?: number;
  /** Request mode that created the session. */
  readonly mode: TerminalRunMode;
  /** Calling transport, when it supplied one. */
  readonly callerId?: string;
  /** Command text of the session. */
  readonly command: string;
  /** Epoch milliseconds at spawn. */
  readonly startedAt: number;
}

/**
 * Terminal execution authority.
 *
 * Every method is decision-producing and never throws for invalid input;
 * driver faults (an unexpected spawn failure) surface as
 * `TERMINAL_SPAWN_FAILED` or `TERMINAL_INTERNAL`.
 */
export interface ITerminalService {
  /**
   * Validates, admits and executes one terminal request.
   *
   * No command reaches a shell without passing the validation gate: the
   * orchestrator re-validates `command`, every entry of `commands[]` and every
   * command nested in the `onSuccess`/`onFailure` trees before spawning.
   *
   * @param request - Fully described request.
   * @param options - Signal and streaming callbacks.
   */
  run(request: TerminalRunRequest, options?: TerminalRunOptions): Promise<TerminalDecision>;

  /** Registers a session that was spawned outside the service (legacy bridge). */
  registerExternal(session: TerminalSessionInfo, controls?: TerminalSessionControls): void;

  /**
   * Registers a host-spawned child so the kill surface and streaming registry
   * see it.
   *
   * The service does not take ownership of the spawn: it records the session,
   * drains it when the child closes, and kills only that child when asked
   * (it never signals a process group it did not create).
   *
   * @param child - Spawned child process.
   * @param onChunk - Stream receiver of the session.
   * @returns The session id allocated for the child.
   */
  registerChild(child: ChildProcessLike, onChunk?: TerminalChunkCallback): string;

  /** Kills one session by id. Returns `false` when it is not registered. */
  kill(sessionId: string): boolean;

  /** Kills every registered session. Returns how many were killed. */
  killAll(): number;

  /** Live sessions in creation order. */
  activeSessions(): readonly TerminalSessionInfo[];

  /** Stream callback of one session, when it registered one. */
  chunkCallback(sessionId: string): TerminalChunkCallback | undefined;

  /** Whether a session id is currently registered. */
  hasSession(sessionId: string): boolean;

  /** Detaches a session from the registry without killing it. */
  unregister(sessionId: string): void;

  /** Frozen policy this instance enforces. */
  getPolicy(): TerminalPolicy;
}

/** Out-of-band controls of a session registered by a host. */
export interface TerminalSessionControls {
  /** Receiver for chunks this session emits. */
  readonly onChunk?: TerminalChunkCallback;
  /** Called when the host asks the service to terminate the session. */
  readonly terminate: () => void;
}
