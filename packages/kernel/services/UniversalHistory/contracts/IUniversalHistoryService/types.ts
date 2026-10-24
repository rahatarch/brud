/**
 * Identifier assigned to a universal history session.
 *
 * The formatted template mirrors the allocator output (`BR-YYYYMMDD-NNN`)
 * while remaining a plain string at runtime, so it can be serialized
 * directly into manifests without any unsafe casts.
 */
export type SessionId = `BR-${string}`;

/** Canonical session identifier shape produced by {@link SessionId}. */
export const SESSION_ID_PATTERN = /^BR-\d{8}-\d{3,4}$/;

/**
 * Narrows an arbitrary string to a {@link SessionId}.
 *
 * @param value - Candidate identifier.
 * @returns `true` when the value matches the canonical session format.
 */
export function isSessionId(value: string): value is SessionId {
  return SESSION_ID_PATTERN.test(value);
}

/** Every mutation kind the universal history ledger can describe. */
export type OperationKind =
  | 'create_file'
  | 'delete_file'
  | 'modify_file'
  | 'rename_file'
  | 'create_directory'
  | 'delete_directory';

/**
 * Content digest captured for a single workspace target.
 *
 * `sha256` is the lowercase hexadecimal SHA-256 of the raw bytes, or an
 * empty string when the target did not exist at capture time.
 */
export interface TargetDigest {
  relativePath: string;
  sha256: string;
  sizeBytes: number;
  isBinary: boolean;
  exists: boolean;
}

/** Materialized baseline payload for one target. */
export interface BaselineTarget {
  content?: Uint8Array;
  text?: string;
  digest: TargetDigest;
}

/** Complete pre-mutation snapshot of a set of workspace targets. */
export interface BaselineSnapshot {
  sessionId: string;
  capturedAt: string;
  targets: Record<string, BaselineTarget>;
}

/** Lifecycle status of a session manifest. */
export type SessionStatus = 'active' | 'committed' | 'aborted' | 'reverted';

/** Durable metadata describing one history session. */
export interface SessionManifest {
  schemaVersion: 1;
  sessionId: string;
  createdAt: string;
  prompt: string;
  status: SessionStatus;
  filesAffected: readonly string[];
  preDigests: Record<string, TargetDigest>;
  postDigests: Record<string, TargetDigest>;
  revertRecordIds?: readonly string[];
  isDeleted?: boolean;
  deletedAt?: string;
  expiresAt?: string;
}
