/**
 * Errors of the unified history store. Names live in the unified namespace;
 * the legacy classes are untouched.
 */
import type { HistoryDegradedReason } from './types.js';

/** History storage is read-only or too new; mutations are refused. */
export class UnifiedHistoryDegradedError extends Error {
  public readonly code = 'HISTORY_DEGRADED' as const;

  constructor(public readonly reason: HistoryDegradedReason) {
    super(`Universal history is running in degraded mode (${reason}); history mutations are unavailable`);
    this.name = 'UnifiedHistoryDegradedError';
  }
}

/** Stored bytes no longer match their content address. They are never returned. */
export class UnifiedBlobIntegrityError extends Error {
  public readonly code = 'BLOB_DIGEST_MISMATCH' as const;

  constructor(public readonly expectedSha256: string, public readonly actualSha256: string) {
    super(`Stored content ${expectedSha256} is corrupt (digest ${actualSha256})`);
    this.name = 'UnifiedBlobIntegrityError';
  }
}

/** Content referenced by history is missing from the store. */
export class UnifiedBlobMissingError extends Error {
  public readonly code = 'BLOB_NOT_FOUND' as const;

  constructor(public readonly sha256: string) {
    super(`Stored content ${sha256} is missing`);
    this.name = 'UnifiedBlobMissingError';
  }
}

/** A write conflicts with existing state (registration or status compare-and-set). */
export class UnifiedStoreConflictError extends Error {
  public readonly code = 'HISTORY_STORE_CONFLICT' as const;

  constructor(message: string) {
    super(message);
    this.name = 'UnifiedStoreConflictError';
  }
}

export class UnifiedSessionNotFoundError extends Error {
  public readonly code = 'SESSION_NOT_FOUND' as const;

  constructor(public readonly sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = 'UnifiedSessionNotFoundError';
  }
}

/** One UTC day exhausted the `BR-YYYYMMDD-NNNN` sequence space. */
export class UnifiedSessionIdExhaustedError extends Error {
  public readonly code = 'SESSION_ID_EXHAUSTED' as const;

  constructor(public readonly day: string, public readonly maxSequence: number) {
    super(`Session id sequence exhausted for ${day} (maximum ${maxSequence})`);
    this.name = 'UnifiedSessionIdExhaustedError';
  }
}

/** A content address is not a lowercase 64-character SHA-256 hex digest. */
export class UnifiedInvalidDigestError extends Error {
  public readonly code = 'INVALID_DIGEST' as const;

  constructor(public readonly digest: string) {
    super('Content address must be a lowercase 64-character SHA-256 hex digest');
    this.name = 'UnifiedInvalidDigestError';
  }
}

/** The store was used before `open()` or after `close()`. */
export class UnifiedStoreClosedError extends Error {
  public readonly code = 'HISTORY_STORE_CLOSED' as const;

  constructor() {
    super('Unified history store is not open');
    this.name = 'UnifiedStoreClosedError';
  }
}
