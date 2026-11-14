import { AsyncLocalStorage } from 'node:async_hooks';
import {
  DEFAULT_KERNEL_CALL_LIMITS,
  type CallOrigin,
  type KernelCallAuthority,
  type KernelCallContext,
  type KernelCallLimits,
  type KernelCaller,
  type KernelHostSession,
  type KernelObservation,
} from '../contracts/callChain.js';

/** One active frame, tagged with the chain that owns it. */
interface Frame {
  readonly chain: KernelCallChain;
  readonly context: KernelCallContext;
}

/**
 * Process-wide carrier of active frames.
 *
 * Several kernels may share one process. Each frame names the chain that owns
 * it, and a chain reads only its own frames.
 */
const frames = new AsyncLocalStorage<Frame>();

/** Largest number of records the observation stream retains. */
const OBSERVATION_CAPACITY = 1_000;

const EMPTY_CAPABILITIES: ReadonlySet<string> = Object.freeze(new Set<string>());

/** The kernel itself as a caller. */
export const KERNEL_CALLER: KernelCaller = Object.freeze({
  callerClass: 'kernel',
  identity: null,
  official: true,
  capabilities: EMPTY_CAPABILITIES,
});

/** A participant the kernel has not assigned an identity to. */
export const UNIDENTIFIED_PARTICIPANT: KernelCaller = Object.freeze({
  callerClass: 'participant',
  identity: null,
  official: false,
  capabilities: EMPTY_CAPABILITIES,
});

/** One admitted participant as the call chain records it. */
export interface ChainParticipant {
  /** Descriptor token id of the participant. */
  readonly tokenId: string;

  /** The participant as a caller. */
  readonly caller: KernelCaller;
}

/** Sliding usage window for one caller. */
interface Usage {
  windowStart: number;
  calls: number;
}

/**
 * One kernel's call chain.
 *
 * Starts root frames, switches the current caller when the kernel mediates a
 * call into a participant, applies per-identity limits, and keeps the
 * observation stream.
 */
export class KernelCallChain implements KernelCallAuthority {
  readonly #limits: KernelCallLimits;

  readonly #instanceOf: (tokenId: string) => unknown;

  readonly #byToken = new Map<string, ChainParticipant>();

  readonly #byIdentity = new Map<string, ChainParticipant>();

  readonly #usage = new Map<string, Usage>();

  readonly #observations: KernelObservation[] = [];

  /**
   * @param instanceOf - Reads the initialized instance registered for a token.
   * @param limits - Per-identity call and size limits.
   */
  constructor(
    instanceOf: (tokenId: string) => unknown,
    limits: KernelCallLimits = DEFAULT_KERNEL_CALL_LIMITS,
  ) {
    this.#instanceOf = instanceOf;
    this.#limits = Object.freeze({ ...limits });
  }

  /**
   * Records the admitted participants for this boot.
   *
   * @param participants - Every admitted participant with its kernel caller.
   */
  admitParticipants(participants: readonly ChainParticipant[]): void {
    this.#byToken.clear();
    this.#byIdentity.clear();

    for (const participant of participants) {
      this.#byToken.set(participant.tokenId, participant);

      if (participant.caller.identity !== null) {
        this.#byIdentity.set(participant.caller.identity, participant);
      }
    }
  }

  /** Forgets every participant; nothing is live after shutdown. */
  clearParticipants(): void {
    this.#byToken.clear();
    this.#byIdentity.clear();
    this.#usage.clear();
  }

  /** The kernel caller recorded for a descriptor token, if any. */
  callerForToken(tokenId: string): KernelCaller | undefined {
    return this.#byToken.get(tokenId)?.caller;
  }

  /**
   * Starts a root frame. The origin is fixed for everything that runs inside.
   *
   * @param origin - Root origin of the new chain.
   * @param caller - Caller that starts the chain.
   * @param operation - Work performed inside the chain.
   */
  runRoot<T>(origin: CallOrigin, caller: KernelCaller, operation: () => T): T {
    return frames.run(
      { chain: this, context: Object.freeze({ origin, caller }) },
      operation,
    );
  }

  /**
   * Starts a host-origin chain for one host session.
   *
   * @param session - The host session's declaration.
   * @param operation - Work performed inside the chain.
   */
  runHost<T>(session: KernelHostSession, operation: () => T): T {
    const capabilities = new Set<string>();

    for (const capability of session.capabilities ?? []) {
      if (typeof capability === 'string' && capability.length > 0) {
        capabilities.add(capability);
      }
    }

    const caller: KernelCaller = Object.freeze({
      callerClass: 'host',
      identity: null,
      official: false,
      capabilities: Object.freeze(capabilities),
    });

    return this.runRoot('host', caller, operation);
  }

  current(): KernelCallContext | undefined {
    const frame = frames.getStore();

    return frame?.chain === this ? frame.context : undefined;
  }

  runAs<T>(identity: string, operation: () => T): T {
    const context = this.current();

    if (context === undefined) {
      throw new Error('No kernel call chain is active');
    }

    const participant = this.#byIdentity.get(identity);

    if (participant === undefined) {
      throw new Error('Identity is not live in this composition');
    }

    return frames.run(
      {
        chain: this,
        context: Object.freeze({ origin: context.origin, caller: participant.caller }),
      },
      operation,
    );
  }

  isLive(identity: string): boolean {
    return this.#byIdentity.has(identity);
  }

  instanceOf(identity: string): unknown {
    const participant = this.#byIdentity.get(identity);

    return participant === undefined ? undefined : this.#instanceOf(participant.tokenId);
  }

  admitCall(caller: KernelCaller, requestBytes: number): boolean {
    if (!Number.isFinite(requestBytes) || requestBytes > this.#limits.maxRequestBytes) {
      return false;
    }

    const key = caller.identity ?? `class:${caller.callerClass}`;
    const now = Date.now();
    const usage = this.#usage.get(key);

    if (usage === undefined || now - usage.windowStart >= this.#limits.windowMs) {
      this.#usage.set(key, { windowStart: now, calls: 1 });

      return 1 <= this.#limits.maxCallsPerWindow;
    }

    usage.calls += 1;

    return usage.calls <= this.#limits.maxCallsPerWindow;
  }

  observe(source: string, event: string, detail: Readonly<Record<string, unknown>>): void {
    this.#observations.push(Object.freeze({
      at: Date.now(),
      source,
      event,
      detail: Object.freeze({ ...detail }),
    }));

    if (this.#observations.length > OBSERVATION_CAPACITY) {
      this.#observations.splice(0, this.#observations.length - OBSERVATION_CAPACITY);
    }
  }

  /** A snapshot of the observation stream, oldest first. */
  observations(): readonly KernelObservation[] {
    return Object.freeze([...this.#observations]);
  }
}
