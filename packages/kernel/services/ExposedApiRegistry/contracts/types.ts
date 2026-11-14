import {
  CALL_ORIGINS,
  type CallOrigin,
  type CallerClass,
} from '../../../src/contracts/callChain.js';

/** API names accept dotted, kebab, and snake segments. */
export const EXPOSED_API_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;

/** The four reachability scopes, ordered from narrowest to widest. */
export const EXPOSED_API_SCOPES = ['kernel', 'runtime', 'host', 'any'] as const;

/** Reachability scope declared by an exposed API identity. */
export type ExposedApiScope = (typeof EXPOSED_API_SCOPES)[number];

/** The three root origins a call chain can carry. Assigned by the kernel. */
export const EXPOSED_API_ORIGINS = CALL_ORIGINS;

/** Root origin of a call chain. */
export type ExposedApiOrigin = CallOrigin;

/**
 * API version.
 *
 * A positive integer is a major version. A string must be a semantic version.
 */
export type ExposedApiVersion = number | string;

/** Identity of one exposed API. */
export interface ExposedApiIdentity {
  readonly name: string;
  readonly version: ExposedApiVersion;
}

/**
 * Reports whether a value is a supported scope.
 *
 * @param value - Candidate value.
 */
export function isExposedApiScope(value: unknown): value is ExposedApiScope {
  return typeof value === 'string'
    && (EXPOSED_API_SCOPES as readonly string[]).includes(value);
}

/**
 * Reports whether a value is a supported root origin.
 *
 * @param value - Candidate value.
 */
export function isExposedApiOrigin(value: unknown): value is ExposedApiOrigin {
  return typeof value === 'string'
    && (EXPOSED_API_ORIGINS as readonly string[]).includes(value);
}

const SEMANTIC_VERSION_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

/**
 * Reports whether a value is a valid API version.
 *
 * @param value - Candidate value.
 */
export function isExposedApiVersion(value: unknown): value is ExposedApiVersion {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 1;
  }

  return typeof value === 'string' && SEMANTIC_VERSION_PATTERN.test(value);
}

/**
 * Returns the order rank of a scope. Higher is wider.
 *
 * @param scope - Supported scope.
 */
export function exposedApiScopeRank(scope: ExposedApiScope): number {
  return EXPOSED_API_SCOPES.indexOf(scope);
}

/**
 * Applies the four-case origin-and-scope rule.
 *
 * @param scope - Scope declared by the API identity.
 * @param origin - Root origin of the call chain.
 */
export function exposedApiScopeAllowsOrigin(
  scope: ExposedApiScope,
  origin: ExposedApiOrigin,
): boolean {
  switch (scope) {
    case 'kernel':
      return origin === 'kernel';
    case 'runtime':
      return origin === 'kernel' || origin === 'runtime';
    case 'host':
      return origin === 'host';
    case 'any':
      return true;
  }
}

/**
 * Caller view handed to a giver's projection.
 *
 * Every field is assigned by the kernel and read from the kernel-provided
 * execution context. Namespace-scoped projections bind to {@link identity}.
 */
export interface ExposedApiCaller {
  /**
   * The caller's kernel-issued identity token.
   *
   * `null` for the kernel itself and for a host session, which carry no
   * participant identity and are distinguished by {@link callerClass}.
   */
  readonly identity: string | null;

  /** The caller's identity class. */
  readonly callerClass: CallerClass;

  /**
   * The caller's official status in this composition.
   *
   * Kernel-derived from the identity-to-official mapping the kernel builds at
   * boot from the composition's frozen config. Never supplied by the caller.
   * A Layer 1 policy input.
   */
  readonly official: boolean;

  /** Capabilities the caller declared it wants. */
  readonly capabilities: ReadonlySet<string>;

  /** Root origin of the call chain. */
  readonly origin: ExposedApiOrigin;
}

/**
 * Projects a giver's instance into the view one caller receives.
 *
 * This is Layer 2: optional narrowing by the giver. It runs only after the
 * kernel has enforced Layer 1, and it can never widen what Layer 1 decided,
 * because Layer 1 is evaluated again on every use of the handle.
 */
export type ExposedApiProjection = (
  service: unknown,
  caller: ExposedApiCaller,
) => unknown;

/** How a giver's code binds one declared exposure. */
export interface ExposedApiBinding {
  /** Layer 2 projection. Defaults to the giver's instance itself. */
  readonly projection?: ExposedApiProjection;
}

/** Options for one resolve. */
export interface ExposedApiResolveOptions {
  /** API version: a major version or a semantic version. Defaults to 1. */
  readonly version?: ExposedApiVersion;

  /**
   * Identity token the caller expects to own the exposure.
   *
   * The resolve fails when the registered owner differs.
   */
  readonly expectedOwner?: string;
}

/**
 * Returns the major version of a valid API version.
 *
 * @param version - A valid API version.
 */
export function exposedApiMajor(version: ExposedApiVersion): number {
  return typeof version === 'number'
    ? version
    : Number.parseInt(version.split('.')[0] ?? '', 10);
}
