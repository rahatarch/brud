import type { CapabilityToken } from '@brud/kernel';
import type { ServiceTier } from '@brud/kernel';
import type { ServiceToken } from '@brud/kernel';

/** API names accept dotted, kebab, and snake segments. */
export const EXPOSED_API_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;

/** The four reachability scopes, ordered from narrowest to widest. */
export const EXPOSED_API_SCOPES = ['kernel', 'runtime', 'host', 'any'] as const;

/** Reachability scope declared by an exposed API identity. */
export type ExposedApiScope = (typeof EXPOSED_API_SCOPES)[number];

/** The three root origins a call chain can carry. */
export const EXPOSED_API_ORIGINS = ['kernel', 'runtime', 'host'] as const;

/** Root origin of a call chain. */
export type ExposedApiOrigin = (typeof EXPOSED_API_ORIGINS)[number];

/**
 * API version.
 *
 * A positive integer is a major version. A string must be a semantic version.
 */
export type ExposedApiVersion = number | string;

/** Opaque policy declaration owned by the declaring participant. */
export type ExposedApiPolicy = Readonly<Record<string, unknown>>;

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

/** Caller view handed to a projection function. */
export interface ExposedApiCaller {
  /** Capabilities the caller declared. */
  readonly capabilities: ReadonlySet<CapabilityToken>;

  /** Whether the caller carries the kernel-derived official brand. */
  readonly official: boolean;

  /** Caller identity used for the broker request. */
  readonly callerId: string;

  /**
   * Identity of the capability consumer, when different from the broker
   * caller. Plugin contexts use the plugin id so namespace-scoped projections
   * stay bound to the plugin.
   */
  readonly subjectId: string;

  /** Absolute workspace root of the caller. */
  readonly workspaceRoot: string;
}

/** Broker access context a consumer supplies when resolving. */
export interface ExposedApiAccessContext {
  /** Caller identity used by the access broker. */
  readonly callerId: string;

  /** Caller tier used by service projections. */
  readonly tier: ServiceTier;

  /** Absolute workspace root. */
  readonly workspaceRoot: string;

  /** Whether the caller is a certified official plugin. */
  readonly official?: boolean;

  /** Identity of the capability consumer. Defaults to {@link callerId}. */
  readonly subjectId?: string;

  /** Optional partition prefix forwarded to scoped services. */
  readonly partitionPrefix?: string;

  /**
   * Root origin of the call chain.
   *
   * Set at the entry point and preserved across nested calls. When omitted, the
   * registry derives a conservative origin from the legacy access shape.
   */
  readonly origin?: ExposedApiOrigin;
}

/**
 * Projects a service instance into the view a caller may receive.
 *
 * The Registry never interprets the result; the declaring service owns all
 * capability semantics.
 */
export type ExposedApiProjection = (
  service: unknown,
  caller: ExposedApiCaller,
) => unknown;

/**
 * Combines multiple matching projections for one API name.
 *
 * Called only when a caller matches more than one capability entry.
 */
export type ExposedApiCombiner = (
  projections: readonly unknown[],
  caller: ExposedApiCaller,
) => unknown;

/** One capability entry for an exposed API. */
export interface ExposedApiRegistration {
  /** Capability that unlocks this projection. */
  readonly capability: CapabilityToken;

  /** API version. Defaults to major version 1. */
  readonly version?: ExposedApiVersion;

  /** Reachability scope. Defaults to `kernel`. */
  readonly scope?: ExposedApiScope;

  /** Policy declaration. Defaults to an empty declaration. */
  readonly policy?: ExposedApiPolicy;

  /** Projection; defaults to identity. */
  readonly projection?: ExposedApiProjection;

  /** Combiner used when multiple entries match; defaults to a safe merge. */
  readonly combine?: ExposedApiCombiner;
}

/** Stored registration entry. */
export interface ExposedApiEntry {
  readonly name: string;
  readonly version: ExposedApiVersion;
  readonly scope: ExposedApiScope;
  readonly policy: ExposedApiPolicy;
  readonly token: ServiceToken<unknown>;
  readonly tokenId: string;
  readonly capability: CapabilityToken;
  readonly projection: ExposedApiProjection;
  readonly combine?: ExposedApiCombiner;
}

/** Resolved handle plus the declaration that authorized it. */
export interface ExposedApiResolved<T> extends ExposedApiIdentity {
  /** Scope recorded for the identity at resolution time. */
  readonly scope: ExposedApiScope;

  /** Policy of the first matching capability entry. */
  readonly policy: ExposedApiPolicy;

  /** Policies of every matching capability entry, in registration order. */
  readonly policies: readonly ExposedApiPolicy[];

  /** The resolved projection. */
  readonly handle: T;
}