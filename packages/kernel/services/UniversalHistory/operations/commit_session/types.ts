import type { IBrudFileSystem } from '../../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
import type { SqliteLedger } from '../../storage/SqliteLedger/SqliteLedger.js';
import type { FileDelta } from '../compute_delta/types.js';

import type { CasBlobWrite, CommitReceipt } from '../../contracts/IUniversalHistoryService/types.js';

export type { CasBlobWrite, CommitReceipt };

/** Input contract for {@link commitSession}. */
export interface CommitSessionInput {
  readonly ledger: SqliteLedger;
  /** Workspace-scoped filesystem backing `.brud/history/blobs`. */
  readonly fileSystem: IBrudFileSystem;
  readonly sessionId: string;
  /** Finalized forward deltas; unchanged entries are ignored. */
  readonly deltas: readonly FileDelta[];
  /** Override for the receipt timestamp; defaults to the current time. */
  readonly committedAt?: string;
}


/** Thrown when a binary delta has no payload to persist. */
export class MissingBlobPayloadError extends Error {
  readonly relativePath: string;

  constructor(relativePath: string) {
    super(`Binary delta for "${relativePath}" has no blob payload`);
    this.name = 'MissingBlobPayloadError';
    this.relativePath = relativePath;
  }
}

/** Thrown when a blob payload does not match its recorded post-digest. */
export class BlobDigestMismatchError extends Error {
  readonly relativePath: string;

  readonly expected: string;

  readonly actual: string;

  constructor(relativePath: string, expected: string, actual: string) {
    super(
      `Blob digest mismatch for "${relativePath}": expected ${expected}, received ${actual}`,
    );
    this.name = 'BlobDigestMismatchError';
    this.relativePath = relativePath;
    this.expected = expected;
    this.actual = actual;
  }
}

/** Thrown when a CAS path cannot be derived from a digest. */
export class InvalidCasDigestError extends Error {
  readonly digest: string;

  constructor(digest: string) {
    super(`Invalid CAS digest: "${digest}"`);
    this.name = 'InvalidCasDigestError';
    this.digest = digest;
  }
}
