/**
 * Public types for the kernel-owned identity registry.
 *
 * The registry records opaque values. It does not interpret a publisher, a
 * content hash, or a metadata record; it stores what the boot-time issuer
 * supplies and returns the same values on resolve.
 */

/** Opaque token issued by the registry. It is not a credential. */
export type IdentityToken = string;

/** Lifecycle state of one recorded identity. */
export const IDENTITY_STATES = ['active', 'retired', 'revoked'] as const;

/** Lifecycle state of one recorded identity. */
export type IdentityState = (typeof IDENTITY_STATES)[number];

/** Opaque values the boot-time issuer records against a token. */
export interface IdentityBinding {
  /** Opaque publisher identifier. Never verified or interpreted here. */
  readonly publisher: string;

  /** Opaque content hash. Never verified or interpreted here. */
  readonly contentHash: string;

  /** Opaque JSON metadata record. */
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** A token together with the binding it was issued for. */
export interface IdentityRecord extends IdentityBinding {
  /** Registry-issued opaque token. */
  readonly token: IdentityToken;

  /** Current lifecycle state. */
  readonly state: IdentityState;
}

/**
 * Identity registry contract.
 *
 * The four operations are the only mutation and read paths. `issue`, `retire`,
 * and `revoke` are available only during the boot window; the service freezes
 * itself when the kernel reaches `RUNNING`. `resolve` remains available.
 */
export interface IIdentityRegistry {
  /**
   * Issues a token for an opaque binding, or returns the existing one.
   *
   * The same publisher and content hash always return the same token. A
   * retired binding is reclaimed by reactivating its token. A revoked binding
   * is never reissued.
   *
   * @param binding - Opaque publisher, content hash, and metadata.
   * @returns The active record for the binding.
   */
  issue(binding: IdentityBinding): IdentityRecord;

  /**
   * Resolves a token to its recorded binding.
   *
   * @param token - Opaque token value.
   * @returns The recorded binding, including its lifecycle state, or `null`
   * when the token is unknown.
   */
  resolve(token: IdentityToken): IdentityRecord | null;

  /**
   * Marks a token inactive while preserving its record.
   *
   * @param token - Opaque token value.
   * @returns The retired record.
   */
  retire(token: IdentityToken): IdentityRecord;

  /**
   * Revokes a token permanently. A revoked binding is never reissued.
   *
   * @param token - Opaque token value.
   * @returns The revoked record.
   */
  revoke(token: IdentityToken): IdentityRecord;
}

/**
 * Reports whether a value is a supported identity state.
 *
 * @param value - Candidate value.
 */
export function isIdentityState(value: unknown): value is IdentityState {
  return typeof value === 'string'
    && (IDENTITY_STATES as readonly string[]).includes(value);
}