/**
 * Kernel call chain.
 *
 * Every call the kernel mediates runs inside a call chain the kernel starts.
 * The kernel fixes the chain's root origin when the chain starts and never
 * changes it while the chain runs. The kernel also records who the current
 * caller is. Neither value is a string a caller supplies: both are read only
 * from the execution context the kernel provides.
 */

/** Root origins a call chain can carry. */
export const CALL_ORIGINS = ['kernel', 'runtime', 'host'] as const;

/**
 * Root origin of a call chain.
 *
 * `kernel` is a chain the kernel itself starts for its own work. `runtime` is a
 * chain the kernel starts when it runs a participant inside the runtime.
 * `host` is a chain the host starts from its authenticated session through the
 * kernel's host entry point.
 */
export type CallOrigin = (typeof CALL_ORIGINS)[number];

/** Identity classes a caller can belong to. */
export const CALLER_CLASSES = ['kernel', 'participant', 'host'] as const;

/**
 * Identity class of a caller.
 *
 * `kernel` is the kernel itself, `participant` is a participant admitted to
 * the composition, and `host` is a host session.
 */
export type CallerClass = (typeof CALLER_CLASSES)[number];

/**
 * A caller as the kernel knows it.
 *
 * Every field is assigned by the kernel. A participant cannot set any of them.
 */
export interface KernelCaller {
  /** Identity class of the caller. */
  readonly callerClass: CallerClass;

  /**
   * Kernel-issued identity token of the caller.
   *
   * Present for an admitted participant. `null` for the kernel itself and for
   * a host session, which are identified by their class.
   */
  readonly identity: string | null;

  /**
   * The caller's official status in this composition.
   *
   * Read from the kernel's identity-to-official mapping, which the kernel
   * builds at boot from the composition's frozen config. Never supplied by the
   * caller.
   */
  readonly official: boolean;

  /** Capabilities the caller declared it wants. A request, not a grant. */
  readonly capabilities: ReadonlySet<string>;

  /**
   * The parent's kernel-issued identity token, when the caller is a caged child.
   *
   * Optional. A top-level participant has no parent and omits the field. A caged
   * child carries the identity token of the participant that loaded it, or the
   * cage's own identity token, as the kernel issued it at admission. The value
   * is the parent's identity, never the parent's name, token id, or descriptor
   * label. The child's own identity is separate and unchanged.
   */
  readonly parentIdentity?: string;
}

/** The kernel-provided execution context of the current call. */
export interface KernelCallContext {
  /** Root origin fixed when the chain started; propagated unchanged. */
  readonly origin: CallOrigin;

  /** The caller currently executing inside the chain. */
  readonly caller: KernelCaller;
}

/** One record on the kernel's observation stream. */
export interface KernelObservation {
  /** Milliseconds since the epoch at which the record was made. */
  readonly at: number;

  /** Kernel component or root primitive that made the record. */
  readonly source: string;

  /** Stable event name. */
  readonly event: string;

  /** Detailed, structured reason. Never returned to the refused caller. */
  readonly detail: Readonly<Record<string, unknown>>;
}

/** Per-identity limits applied to every call the kernel mediates. */
export interface KernelCallLimits {
  /** Calls one caller may make inside one window. */
  readonly maxCallsPerWindow: number;

  /** Window length in milliseconds. */
  readonly windowMs: number;

  /** Largest accepted request size, in bytes, for one mediated call. */
  readonly maxRequestBytes: number;
}

/** Limits used when the host does not supply its own. */
export const DEFAULT_KERNEL_CALL_LIMITS: KernelCallLimits = Object.freeze({
  maxCallsPerWindow: 10_000,
  windowMs: 1_000,
  maxRequestBytes: 65_536,
});

/**
 * Kernel authority over the call chain.
 *
 * The kernel hands this only to root primitives, through the hardcore boot
 * context. It is never reachable through the access broker.
 */
export interface KernelCallAuthority {
  /** The current call's kernel-provided context, or `undefined` outside a chain. */
  current(): KernelCallContext | undefined;

  /**
   * Runs an operation as an admitted participant, keeping the root origin.
   *
   * Used when the kernel mediates a call into a participant's code. The chain's
   * root origin does not change.
   *
   * @param identity - Kernel-issued identity token of the participant.
   * @param operation - Work performed as that participant.
   * @throws {Error} When no chain is active or the identity is not live.
   */
  runAs<T>(identity: string, operation: () => T): T;

  /** Whether an identity is live in the composition. */
  isLive(identity: string): boolean;

  /** The initialized instance of a live participant, or `undefined`. */
  instanceOf(identity: string): unknown;

  /**
   * Starts a chain with the given origin and a participant's recorded caller.
   *
   * The caller is the participant the kernel admitted under `identity`; it is
   * resolved from the same admission record {@link callerForIdentity} reads, so
   * the frame carries the participant's kernel-issued identity and its parent
   * relation exactly as the kernel recorded them. Unlike {@link runAs}, this
   * member sets the chain's root origin and does not require an active chain.
   * It composes what the kernel's own root-start and run-as paths do, without
   * exposing either.
   *
   * @param origin - Root origin the new chain starts with.
   * @param identity - Kernel-issued identity token of the participant.
   * @param operation - Work performed inside the chain as that participant.
   * @throws {Error} When the identity is not live in this composition.
   */
  runAsOrigin<T>(origin: CallOrigin, identity: string, operation: () => T): T;

  /**
   * The kernel caller recorded for an identity token, or `undefined`.
   *
   * Reads the same admission record `isLive` and `instanceOf` read. Used to
   * resolve the caller's class for a caller that is named by another caller's
   * frame — the parent of a caged child — without the caller supplying it.
   *
   * @param identity - Kernel-issued identity token.
   */
  callerForIdentity(identity: string): KernelCaller | undefined;

  /**
   * Applies the per-identity call and size limits to one mediated call.
   *
   * @param caller - The caller making the call.
   * @param requestBytes - Size of the call's request.
   * @returns `true` when the call is within the limits.
   */
  admitCall(caller: KernelCaller, requestBytes: number): boolean;

  /** Appends one record to the kernel's observation stream. */
  observe(source: string, event: string, detail: Readonly<Record<string, unknown>>): void;
}

/** A host session's declaration when it enters a host-origin chain. */
export interface KernelHostSession {
  /** Capabilities the host session declares it wants. */
  readonly capabilities?: Iterable<string>;
}
