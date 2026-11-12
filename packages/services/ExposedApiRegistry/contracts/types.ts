import type { CapabilityToken } from '@brud/kernel';
import type { ServiceTier } from '@brud/kernel';
import type { ServiceToken } from '@brud/kernel';

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

  /** Projection; defaults to identity. */
  readonly projection?: ExposedApiProjection;

  /** Combiner used when multiple entries match; defaults to a safe merge. */
  readonly combine?: ExposedApiCombiner;
}

/** Stored registration entry. */
export interface ExposedApiEntry {
  readonly name: string;
  readonly token: ServiceToken<unknown>;
  readonly tokenId: string;
  readonly capability: CapabilityToken;
  readonly projection: ExposedApiProjection;
  readonly combine?: ExposedApiCombiner;
}