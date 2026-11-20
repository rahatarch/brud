import type { JsonRpcId } from './framing.js';
import type { DaemonProtocolVersion } from './version.js';

export const DAEMON_CONNECT = 'daemon.connect';
export const DAEMON_PING = 'daemon.ping';
export const DAEMON_INFO = 'daemon.info';

/** Kernel-instance methods: the daemon is a neutral host for kernels. */
export const KERNEL_REQUIREMENTS = 'kernel.requirements';
export const KERNEL_BOOT = 'kernel.boot';
export const KERNEL_ATTACH = 'kernel.attach';
export const KERNEL_LIST = 'kernel.list';
export const KERNEL_STATUS = 'kernel.status';
export const KERNEL_DISPOSE = 'kernel.dispose';
export const KERNEL_KINDS = 'kernel.kinds';
export const KERNEL_ROUTE = 'kernel.route';

export const REQUEST_CANCEL = 'request.cancel';
export const REQUEST_CANCELLED = 'request.cancelled';

export const REQUEST_METHODS = [REQUEST_CANCEL] as const;
export type RequestMethod = (typeof REQUEST_METHODS)[number];

export const DAEMON_METHODS = [DAEMON_CONNECT, DAEMON_PING, DAEMON_INFO] as const;
export type DaemonMethod = (typeof DAEMON_METHODS)[number];

export const KERNEL_METHODS = [
  KERNEL_REQUIREMENTS,
  KERNEL_BOOT,
  KERNEL_ATTACH,
  KERNEL_LIST,
  KERNEL_STATUS,
  KERNEL_DISPOSE,
  KERNEL_KINDS,
  KERNEL_ROUTE,
] as const;
export type KernelMethod = (typeof KERNEL_METHODS)[number];

export interface DaemonClientIdentity {
  readonly name: string;
  readonly version: string;
}

/**
 * Caller capability tier presented during `daemon.connect`.
 *
 * `ui` identifies a human-facing client (for example the editor UI) and `ai`
 * identifies an autonomous caller. Each maps to host-session capabilities in
 * the operator's daemon config.
 */
export type DaemonCallerTier = 'ui' | 'ai';

/**
 * Post-handshake connect parameters.
 *
 * Authentication, the caller principal, and the daemon home are fixed by
 * the authenticated Noise session before this request is accepted. They are
 * deliberately absent from this payload: a caller cannot re-assert or override
 * its tier here.
 */
export interface DaemonConnectParams {
  readonly protocolVersion: string;
  /** Client identity supplied by the authenticated client. */
  readonly clientInfo?: DaemonClientIdentity;
  /** Legacy client identity field retained for wire compatibility. */
  readonly client?: DaemonClientIdentity;
  readonly capabilities?: readonly string[];
}

export interface DaemonServerIdentity {
  readonly name: string;
  readonly version: string;
  readonly pid: number;
}

export interface DaemonCapabilities {
  readonly protocolVersion: DaemonProtocolVersion;
  /** Methods this daemon serves. */
  readonly methods: readonly string[];
}

export interface DaemonHandshakeResult {
  readonly connectionId: string;
  readonly protocolVersion: DaemonProtocolVersion;
  /** Validated caller tier recorded on the daemon session. */
  readonly tier: DaemonCallerTier;
  readonly capabilities: DaemonCapabilities;
  readonly server: DaemonServerIdentity;
}

/** Lifecycle state of a daemon-hosted kernel instance. */
export type KernelInstanceState = 'booting' | 'running' | 'shutting-down' | 'disposed';

/** One startup field a composition requires, as declared by a participant. */
export interface KernelRequirementField {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly description?: string;
  /** Participant (module) that declared the field. */
  readonly service: string;
  /** Whether a client may set it (operator allowlist). */
  readonly clientSettable: boolean;
}

export interface KernelRequirementsResult {
  readonly fields: readonly KernelRequirementField[];
}

export interface KernelBootParams {
  /** Startup options; only fields the operator allows clients to set. */
  readonly options?: Readonly<Record<string, unknown>>;
}

export interface KernelInstanceParams {
  readonly instanceId: string;
}

export interface KernelInstanceDescriptor {
  readonly instanceId: string;
  readonly state: KernelInstanceState;
  readonly clientCount: number;
  readonly lastUsedAt: string;
}

export interface KernelBootResult {
  readonly instance: KernelInstanceDescriptor;
  /** True when an existing kernel with identical options was reused. */
  readonly reused: boolean;
  /**
   * Participants the kernel left out because required startup fields were
   * missing. The kernel prunes them instead of refusing the boot (it refuses
   * only for hardcore services or participants others depend on).
   */
  readonly pruned: readonly { readonly participants: readonly string[]; readonly path: string; readonly missingFields: readonly string[] }[];
}

export interface KernelListResult {
  /** Instances this connection is attached to. */
  readonly instances: readonly KernelInstanceDescriptor[];
}

export interface KernelStatusResult {
  readonly instance: KernelInstanceDescriptor | null;
}

export interface KernelDisposeResult {
  readonly disposed: boolean;
}

/** Public description of one operation of a kind. */
export interface KernelKindOperation {
  readonly description?: string;
  readonly input?: Readonly<Record<string, unknown>>;
}

export interface KernelKindInfo {
  readonly kind: string;
  readonly description?: string;
  readonly operations?: Readonly<Record<string, KernelKindOperation>>;
}

export interface KernelKindsResult {
  readonly kinds: readonly KernelKindInfo[];
}

export interface KernelRouteParams extends KernelInstanceParams {
  /** Brud syntax text. */
  readonly text: string;
  readonly stopOnFailure?: boolean;
  readonly dryRun?: boolean;
  readonly maxOperations?: number;
}

/** The Router's route result, as JSON. */
export type KernelRouteResult = Readonly<Record<string, unknown>>;

export interface DaemonPingParams {
  readonly nonce?: string;
}

export interface DaemonPingResult {
  readonly connectionId: string;
  readonly timestamp: number;
  readonly nonce?: string;
}

export type DaemonEmptyParams = Record<string, never>;

export interface DaemonInfoResult {
  readonly connectionId: string;
  readonly name: string;
  readonly version: string;
  readonly protocolVersion: DaemonProtocolVersion;
  readonly pid: number;
  readonly uptimeMs: number;
}

export interface RequestCancelParams {
  /** Id of the in-flight request the caller is abandoning. */
  readonly id: JsonRpcId;
}

/**
 * Outcome the daemon observed for a cancellation.
 *
 * - `cancelled`: the signal was delivered and the operation settled as
 *   `aborted`, so the work stopped.
 * - `not-abortable`: the signal was delivered but the operation completed
 *   normally; it does not honor cancellation.
 * - `aborting`: the signal was delivered but the operation had not settled
 *   within the acknowledgement grace window.
 * - `not-found`: no matching request was in flight (already finished).
 * - `invalid`: the cancellation frame did not name a valid request id.
 */
export type RequestCancelStatus =
  | 'cancelled'
  | 'not-abortable'
  | 'aborting'
  | 'not-found'
  | 'invalid';

export interface RequestCancelledParams {
  /** Id of the request the cancellation referred to. */
  readonly id: JsonRpcId;
  readonly status: RequestCancelStatus;
  readonly message?: string;
}

export interface DaemonMethodMap {
  readonly 'daemon.connect': { readonly params: DaemonConnectParams; readonly result: DaemonHandshakeResult };
  readonly 'daemon.ping': { readonly params: DaemonPingParams; readonly result: DaemonPingResult };
  readonly 'daemon.info': { readonly params: DaemonEmptyParams; readonly result: DaemonInfoResult };
  readonly 'kernel.requirements': { readonly params: DaemonEmptyParams; readonly result: KernelRequirementsResult };
  readonly 'kernel.boot': { readonly params: KernelBootParams; readonly result: KernelBootResult };
  readonly 'kernel.attach': { readonly params: KernelInstanceParams; readonly result: KernelStatusResult };
  readonly 'kernel.list': { readonly params: DaemonEmptyParams; readonly result: KernelListResult };
  readonly 'kernel.status': { readonly params: KernelInstanceParams; readonly result: KernelStatusResult };
  readonly 'kernel.dispose': { readonly params: KernelInstanceParams; readonly result: KernelDisposeResult };
  readonly 'kernel.kinds': { readonly params: KernelInstanceParams; readonly result: KernelKindsResult };
  readonly 'kernel.route': { readonly params: KernelRouteParams; readonly result: KernelRouteResult };
  readonly 'request.cancel': {
    readonly params: RequestCancelParams;
    readonly result: RequestCancelledParams;
  };
}

export type DaemonRequestMethod = keyof DaemonMethodMap;

export type DaemonMethodParams<TMethod extends DaemonRequestMethod> = DaemonMethodMap[TMethod]['params'];

export type DaemonMethodResult<TMethod extends DaemonRequestMethod> = DaemonMethodMap[TMethod]['result'];
