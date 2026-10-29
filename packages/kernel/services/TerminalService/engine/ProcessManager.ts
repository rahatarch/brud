import { spawn } from 'node:child_process';
import type { TerminalPolicy } from '../contracts/policies.js';
import { ShellAdapter, type EnvironmentOutcome, type ShellInvocation } from './ShellAdapter.js';

/**
 * Structural view of a spawned child the manager drives.
 *
 * Declared locally so the manager never leaks `node:child_process` types into
 * its contracts: anything with a pid, the standard streams and the lifecycle
 * events can be registered, including an `EventEmitter`-shaped test double.
 */
export interface ChildProcessLike {
  /** OS process id, absent when the spawn failed outright. */
  readonly pid?: number;
  readonly stdin?: NodeJS.WritableStream | null;
  readonly stdout?: NodeJS.ReadableStream | null;
  readonly stderr?: NodeJS.ReadableStream | null;
  on(event: 'close', listener: (code: number | null, signal: string | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: string, listener: (...args: never[]) => void): unknown;
  once?(event: string, listener: (...args: never[]) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
}

/** Why a managed child stopped. Exactly one reason wins per child. */
export type TerminationReason = 'exit' | 'timeout' | 'abort' | 'limit' | 'spawn_error';

/**
 * Precedence of termination reasons when more than one applies.
 *
 * A caller's cancellation is never rewritten as a timeout, and a spawn
 * failure or a ceiling breach outranks both.
 */
const PRIORITY: Readonly<Record<TerminationReason, number>> = Object.freeze({
  exit: 0,
  timeout: 1,
  abort: 2,
  limit: 3,
  spawn_error: 4,
});

/** Terminal outcome of one managed child. */
export interface ManagedExit {
  readonly exitCode: number | null;
  readonly signal: string | null;
  /** The single reason that terminated the child. */
  readonly reason: TerminationReason;
  /** Whether the process manager itself terminated the child. */
  readonly killed: boolean;
  /** Whether the timeout elapsed before the child closed. */
  readonly timedOut: boolean;
  /** Spawn error text, when the child never started. */
  readonly spawnError?: string;
  /** Measured lifetime in milliseconds. */
  readonly duration: number;
}

/** Options accepted by {@link ProcessManager.spawn}. */
export interface ProcessSpawnOptions {
  readonly command: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly graceMs: number;
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
  /** Whether stdin stays open for answers written after spawn. */
  readonly interactive?: boolean;
  /** Invoked once, when the child closed and its tree was reaped. */
  onClose?: () => void;
  /**
   * Invoked once, the first time the child is force-killed because its
   * retained output breached the ceiling.
   */
  onLimitBreached?: () => void;
}

/** Internal bookkeeping for one live child. */
interface LiveEntry {
  readonly pid: number;
  readonly terminate: () => void;
  /** Kills the tree immediately, used to reap a child when the host leaves. */
  readonly forceTerminate: () => void;
  readonly stdin?: NodeJS.WritableStream;
}

/** Outcome of {@link ProcessManager.spawn}, before the process closes. */
export interface SpawnHandle {
  readonly pid?: number;
  readonly sessionId: string;
  readonly terminate: () => void;
  readonly hardTerminate: () => void;
  /**
   * Kills the tree immediately and records the stop as a ceiling breach.
   *
   * Distinct from {@link hardTerminate}, which records a cancellation: the
   * reaped outcome reports `reason: 'limit'` so the orchestrator can classify
   * a runaway producer as `TERMINAL_OUTPUT_LIMIT`, not `TERMINAL_INTERRUPTED`.
   */
  readonly terminateForLimit: () => void;
  readonly closed: Promise<ManagedExit>;
}

/**
 * The sole authorized spawn site of the kernel.
 *
 * Every child is spawned in its own process group on POSIX so a timeout or a
 * kill reaps the whole tree, never just the shell. The manager also owns the
 * live-pid map that shutdown, descriptor disposal and host termination drain.
 */
export class ProcessManager {
  private readonly adapter: ShellAdapter;

  private readonly live = new Map<string, LiveEntry>();

  private sessionCounter = 0;

  /**
   * @param adapter - Platform shell strategy.
   */
  constructor(adapter?: ShellAdapter) {
    this.adapter = adapter ?? new ShellAdapter();
  }

  /** Platform strategy used by this manager. */
  get shells(): ShellAdapter {
    return this.adapter;
  }

  /** Whether a session id is live. */
  has(sessionId: string): boolean {
    return this.live.has(sessionId);
  }

  /** Live pids owned by this manager. */
  livePids(): readonly number[] {
    return Array.from(this.live.values(), (entry) => entry.pid);
  }

  /** Allocates a session id in the legacy `proc-<timestamp>-<counter>` sequence. */
  nextSessionId(): string {
    this.sessionCounter++;

    return `proc-${Date.now()}-${this.sessionCounter}`;
  }

  /**
   * Spawns one command in its own process group.
   *
   * @param options - Command, cwd, environment, timeout and stream sinks.
   */
  spawn(options: ProcessSpawnOptions): SpawnHandle {
    const invocation: ShellInvocation = this.adapter.build(options.command);
    const sessionId = this.nextSessionId();
    const startedAt = Date.now();
    let child: ChildProcessLike;

    try {
      child = spawn(invocation.file, [...invocation.args], {
        cwd: options.cwd,
        env: { ...options.env },
        detached: this.adapter.detached,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      }) as unknown as ChildProcessLike;
    } catch (error) {
      // A synchronous `spawn` throw (`EMFILE`, an unusable `cwd`, ...) never
      // produced a child, so there is nothing to reap. The handle still
      // resolves `closed` with a synthetic `spawn_error` outcome so the
      // orchestrator classifies it into a structured decision instead of
      // surfacing an unhandled rejection.
      const message = messageOf(error);
      const spawnError = message.length > 0 ? message : 'spawn failed';

      return {
        sessionId,
        terminate: () => undefined,
        hardTerminate: () => undefined,
        terminateForLimit: () => undefined,
        closed: Promise.resolve({
          exitCode: null,
          signal: null,
          reason: 'spawn_error',
          killed: false,
          timedOut: false,
          spawnError,
          duration: Date.now() - startedAt,
        }),
      };
    }

    const pid = child.pid;
    let reason: TerminationReason | undefined;
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let escalationHandle: NodeJS.Timeout | undefined;

    // The first authoritative reason wins. A cancellation (abort or limit)
    // is reported ahead of a timeout that may fire while the tree is being
    // reaped, and a spawn failure is never masked by either.
    const markReason = (next: TerminationReason): void => {
      if (reason === undefined) {
        reason = next;
        return;
      }

      if (PRIORITY[next] > PRIORITY[reason]) {
        reason = next;
      }
    };

    const escalate = (): void => {
      clearTimeout(escalationHandle);
      escalationHandle = setTimeout(() => {
        this.forceKill(child, pid, this.adapter.detached);
      }, options.graceMs);
      // Deliberately not unref'd: the force-kill timer must survive an early
      // settling of the standard-I/O handles, otherwise a shell that outlives
      // its pipes would never be reaped.
    };

    const terminate = (): void => {
      if (settled) {
        return;
      }

      markReason('abort');

      try {
        child.kill('SIGTERM');
      } catch {
        // An already-dead child raises ESRCH; the escalation below still runs.
      }

      escalate();
    };

    const hardTerminate = (): void => {
      if (settled) {
        return;
      }

      markReason('abort');
      clearTimeout(escalationHandle);
      this.forceKill(child, pid, this.adapter.detached);
    };

    const forceTerminate = (): void => {
      if (settled) {
        return;
      }

      this.forceKill(child, pid, this.adapter.detached);
    };

    /**
     * Kills the tree as a ceiling breach.
     *
     * A breach is not negotiable: the tree is killed immediately rather than
     * escalated, because a chatty descendant would otherwise keep allocating
     * while the grace period elapses. The recorded reason is `limit`, so
     * `finish()` reports it and the orchestrator emits `TERMINAL_OUTPUT_LIMIT`.
     */
    const terminateForLimit = (): void => {
      if (settled) {
        return;
      }

      markReason('limit');
      clearTimeout(escalationHandle);
      this.forceKill(child, pid, this.adapter.detached);
      options.onLimitBreached?.();
    };

    const closed = new Promise<ManagedExit>((resolve) => {
      const finish = (exit: Omit<ManagedExit, 'reason' | 'killed' | 'timedOut'>): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutHandle);
        clearTimeout(escalationHandle);
        this.live.delete(sessionId);

        const finalReason = reason ?? 'exit';

        if (finalReason !== 'exit' && finalReason !== 'spawn_error') {
          // A descendant that outlived its shell must not survive the reaping.
          this.forceKill(child, pid, this.adapter.detached);
        }

        resolve({
          ...exit,
          reason: finalReason,
          killed: finalReason !== 'exit' && finalReason !== 'spawn_error',
          timedOut: finalReason === 'timeout',
        });
        // Released after `closed` resolves, so the awaiting caller finishes
        // classifying before a queued command starts and hands the slot on.
        queueMicrotask(() => options.onClose?.());
      };

      child.on('close', (code: number | null, signal: string | null) => {
        finish({
          exitCode: code,
          signal: signal ?? null,
          duration: Date.now() - startedAt,
        });
      });

      child.on('error', (error: Error) => {
        markReason('spawn_error');
        finish({
          exitCode: null,
          signal: null,
          duration: Date.now() - startedAt,
          spawnError: error.message.length > 0 ? error.message : 'spawn failed',
        });
      });
    });

    // A child that reports spawn failure has no pipes to read.
    child.stdout?.on('data', (chunk: Buffer) => {
      options.onStdout?.(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      options.onStderr?.(chunk);
    });

    const script = this.adapter.scriptFor(options.command);

    if (pid !== undefined) {
      // Every live child is registered before the timeout rail can fire, so
      // `killAll()` reaps a child whose spawn is still settling.
      this.live.set(sessionId, {
        pid,
        terminate,
        forceTerminate,
        ...(child.stdin === undefined || child.stdin === null ? {} : { stdin: child.stdin }),
      });
    }

    // Stdin always stays open until the shell closes it: a POSIX shell reads
    // its script from stdin, and a write followed by `end()` in the same tick
    // can discard the command before the shell starts reading. The `close`
    // handler ends the stream once the child is gone.
    this.feed(child, script, false);

    timeoutHandle = setTimeout(() => {
      if (settled) {
        return;
      }

      markReason('timeout');
      try {
        child.kill('SIGTERM');
      } catch {
        // The escalation below still reaps the group.
      }
      escalate();
    }, options.timeoutMs);
    timeoutHandle.unref();

    return {
      ...(pid === undefined ? {} : { pid }),
      sessionId,
      terminate,
      hardTerminate,
      terminateForLimit,
      closed,
    };
  }

  /**
   * Closes the stdin of a live interactive session.
   *
   * @param sessionId - Session id.
   */
  finishAnswers(sessionId: string): void {
    const entry = this.live.get(sessionId);

    try {
      entry?.stdin?.end();
    } catch {
      // The pipe may already be closed by the child.
    }
  }

  /**
   * Appends an answer to a live session's stdin.
   *
   * The command script is fed at spawn; an interactive session keeps stdin
   * open until the answers were written, so a prompt that appears later than
   * a fixed delay still receives its answer.
   *
   * @param sessionId - Session id.
   * @param payload - Bytes to append.
   */
  answer(sessionId: string, payload: string): boolean {
    const entry = this.live.get(sessionId);

    if (entry?.stdin === undefined) {
      return false;
    }

    try {
      entry.stdin.write(payload);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Writes the command script and closes stdin for non-interactive runs.
   *
   * @param child - Child process.
   * @param payload - Bytes written before stdin is closed.
   * @param closeStdin - Whether stdin is closed after the write.
   */
  feed(child: ChildProcessLike, payload: string, closeStdin: boolean): void {
    try {
      // A child that exits before reading stdin raises EPIPE; the exit status
      // is authoritative, so the write error is ignored deliberately.
      child.stdin?.on('error', () => undefined);
      child.stdin?.write(payload);

      if (closeStdin) {
        child.stdin?.end();
      }
    } catch {
      // Nothing left to write when the pipe is already closed.
    }
  }

  /**
   * Kills one managed process tree.
   *
   * @param sessionId - Session id.
   */
  kill(sessionId: string): boolean {
    const entry = this.live.get(sessionId);

    if (entry === undefined) {
      return false;
    }

    entry.terminate();

    return true;
  }

  /**
   * Kills every managed process tree.
   *
   * Every registered child is force-killed as a group, not merely signalled,
   * so `dispose()` cannot leave a descendant behind when the host is going
   * away.
   *
   * @returns The number of trees that were signalled.
   */
  killAll(): number {
    const entries = Array.from(this.live.values());

    for (const entry of entries) {
      entry.terminate();
      entry.forceTerminate();
    }

    return entries.length;
  }

  /**
   * Force-kills a process tree on the target platform.
   *
   * On POSIX the group is signalled only when this manager created it; a
   * bridge for a host-spawned child kills just that child so an unrelated
   * process group is never targeted.
   *
   * @param child - Child process.
   * @param pid - Process id, when known.
   * @param ownGroup - Whether the manager created the process group.
   */
  forceKill(
    child: ChildProcessLike,
    pid?: number,
    ownGroup = true,
  ): void {
    if (pid === undefined) {
      this.signalChild(child);

      return;
    }

    if (this.adapter.needsTaskkill) {
      this.killWindowsTree(child, pid);

      return;
    }

    if (!ownGroup) {
      this.signalChild(child);

      return;
    }

    try {
      // The child leads its own group (`detached`), so the negative pid
      // addresses the shell and every descendant in one signal.
      process.kill(-pid, 'SIGKILL');
    } catch {
      this.signalChild(child);
    }
  }

  /**
   * Sanitizes a request environment through the platform adapter.
   *
   * @param policy - Frozen terminal policy.
   * @param requested - Caller-supplied environment.
   */
  environment(
    policy: TerminalPolicy,
    requested?: Readonly<Record<string, string>>,
  ): EnvironmentOutcome {
    return this.adapter.buildEnvironment(policy, requested);
  }

  private signalChild(child: ChildProcessLike): void {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already reaped.
    }
  }

  private killWindowsTree(child: ChildProcessLike, pid: number): void {
    try {
      const helper = spawn(this.adapter.treeKillHelper(), [...this.adapter.treeKillArgs(pid)], {
        stdio: 'ignore',
        windowsHide: true,
      });
      helper.on('error', () => {
        this.signalChild(child);
      });
    } catch {
      this.signalChild(child);
    }
  }
}

/**
 * Extracts a diagnostic message from an arbitrary thrown value.
 *
 * @param error - Thrown value.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
