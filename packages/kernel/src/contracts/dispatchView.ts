/**
 * The caller of a routed operation, as recorded on the kernel call chain.
 * It is never taken from the request. `capabilities` is the same read-only
 * view every participant sees for a caller.
 */
export interface DispatchCallerView {
  readonly identity: string | null;
  readonly callerClass: string;
  readonly official: boolean;
  readonly capabilities: ReadonlySet<string>;
  readonly origin: string;
}

/** What a kind's dispatch exposure receives for one operation. */
export interface DispatchContextView {
  /** Kernel-derived caller of the route request. */
  readonly caller: DispatchCallerView;
  /** Cancellation signal, when the transport supplied one. */
  readonly signal?: AbortSignal;
  /** Validate only; do not execute. */
  readonly dryRun?: boolean;
}
