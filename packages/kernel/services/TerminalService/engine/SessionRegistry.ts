import type {
  TerminalChunkCallback,
  TerminalRunMode,
  TerminalSessionControls,
  TerminalSessionInfo,
} from '../contracts/ITerminalService.js';

/** Registry entry for one live session. */
export interface SessionRecord {
  readonly info: TerminalSessionInfo;
  readonly controls?: TerminalSessionControls;
  /** Detaches the AbortSignal listener correlated with this session. */
  readonly detachSignal?: () => void;
}

/**
 * Active session registry.
 *
 * Sessions are keyed by the legacy `proc-<timestamp>-<counter>` identity so a
 * host that already persists those ids keeps working. The registry is the only
 * place a caller sees live sessions; it never owns a child process, so it can
 * be inspected from a transport without resolving the process manager.
 */
export class SessionRegistry {
  private counter = 0;

  private readonly sessions = new Map<string, SessionRecord>();

  /** Allocates a session id in the legacy sequence. */
  nextId(): string {
    this.counter++;

    return `proc-${Date.now()}-${this.counter}`;
  }

  /**
   * Registers a session.
   *
   * @param info - Session identity.
   * @param controls - Out-of-band kill and stream receiver.
   */
  register(info: TerminalSessionInfo, controls?: TerminalSessionControls): string {
    this.sessions.set(info.processId, { info, ...(controls === undefined ? {} : { controls }) });

    return info.processId;
  }

  /**
   * Correlates an abort signal with a registered session.
   *
   * @param sessionId - Session id.
   * @param signal - Caller signal.
   * @param onAbort - Invoked once, from the abort event.
   */
  bindSignal(sessionId: string, signal: AbortSignal, onAbort: () => void): void {
    const record = this.sessions.get(sessionId);

    if (record === undefined) {
      return;
    }

    const listener = (): void => {
      onAbort();
    };

    signal.addEventListener('abort', listener, { once: true });
    this.sessions.set(sessionId, {
      ...record,
      detachSignal: () => {
        try {
          signal.removeEventListener('abort', listener);
        } catch {
          // A signal from another realm cannot be detached; it is inert anyway.
        }
      },
    });
  }

  /** One session by id. */
  get(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  /** Whether a session id is registered. */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** Live sessions in registration order. */
  list(): readonly TerminalSessionInfo[] {
    return Array.from(this.sessions.values(), (record) => record.info);
  }

  /** Ids in registration order. */
  ids(): readonly string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Stream callback of one session.
   *
   * @param sessionId - Session id.
   */
  chunkCallback(sessionId: string): TerminalChunkCallback | undefined {
    return this.sessions.get(sessionId)?.controls?.onChunk;
  }

  /**
   * Removes a session and detaches its signal listener.
   *
   * @param sessionId - Session id.
   * @returns `true` when the session was registered.
   */
  remove(sessionId: string): boolean {
    const record = this.sessions.get(sessionId);

    if (record === undefined) {
      return false;
    }

    record.detachSignal?.();
    this.sessions.delete(sessionId);

    return true;
  }

  /**
   * Removes every session, detaching each signal listener.
   *
   * @returns The removed records.
   */
  drain(): readonly SessionRecord[] {
    const records = Array.from(this.sessions.values());

    for (const sessionId of this.sessions.keys()) {
      this.sessions.get(sessionId)?.detachSignal?.();
    }

    this.sessions.clear();

    return records;
  }

  /** Count of live sessions. */
  get size(): number {
    return this.sessions.size;
  }
}

/**
 * Builds a session record for a spawn.
 *
 * @param processId - Allocated session id.
 * @param mode - Request mode.
 * @param command - Primary command.
 * @param options - Optional pid, caller and start time.
 */
export function sessionInfo(
  processId: string,
  mode: TerminalRunMode,
  command: string,
  options: { readonly pid?: number; readonly callerId?: string; readonly startedAt?: number },
): TerminalSessionInfo {
  return {
    processId,
    ...(options.pid === undefined ? {} : { pid: options.pid }),
    mode,
    ...(options.callerId === undefined ? {} : { callerId: options.callerId }),
    command,
    startedAt: options.startedAt ?? Date.now(),
  };
}
