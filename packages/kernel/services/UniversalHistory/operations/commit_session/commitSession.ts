import { createHash } from 'node:crypto';
import type { IBrudFileSystem } from '../../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
import type { SessionFileInsertRow } from '../../storage/SqliteLedger/types.js';
import type { FileDelta } from '../compute_delta/types.js';
import {
  BlobDigestMismatchError,
  InvalidCasDigestError,
  MissingBlobPayloadError,
} from './types.js';
import type {
  CasBlobWrite,
  CommitReceipt,
  CommitSessionInput,
} from './types.js';

/** Workspace-relative root of the content-addressed blob store. */
export const HISTORY_BLOBS_DIRECTORY = '.brud/history/blobs';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

/**
 * Derives the workspace-relative CAS path for a SHA-256 digest.
 *
 * @param sha256 - Lowercase hexadecimal digest.
 */
export function casBlobPath(sha256: string): string {
  if (!SHA256_PATTERN.test(sha256)) {
    throw new InvalidCasDigestError(sha256);
  }

  return `${HISTORY_BLOBS_DIRECTORY}/${sha256.slice(0, 2)}/${sha256}`;
}

async function storeBlob(
  fileSystem: IBrudFileSystem,
  delta: FileDelta,
): Promise<CasBlobWrite | null> {
  const payload = delta.blobPayload;

  if (payload === null) {
    if (delta.isBinary && delta.postDigest.exists) {
      throw new MissingBlobPayloadError(delta.relativePath);
    }

    return null;
  }

  const sha256 = createHash('sha256').update(payload).digest('hex');

  if (delta.postDigest.exists && delta.postDigest.sha256 !== sha256) {
    throw new BlobDigestMismatchError(
      delta.relativePath,
      delta.postDigest.sha256,
      sha256,
    );
  }

  const relativePath = casBlobPath(sha256);

  if (!(await fileSystem.exists(relativePath))) {
    await fileSystem.writeAtomic(relativePath, payload);
  }

  return { sha256, relativePath };
}

function toFileRow(delta: FileDelta, blobSha256: string | null): SessionFileInsertRow {
  return {
    relative_path: delta.relativePath,
    pre_sha256: delta.preDigest.exists ? delta.preDigest.sha256 : '',
    post_sha256: delta.postDigest.exists ? delta.postDigest.sha256 : '',
    diff_content: delta.diffContent,
    blob_sha256: blobSha256,
    is_binary: delta.isBinary ? 1 : 0,
  };
}

/**
 * Persists a finalized session atomically.
 *
 * Blobs are written to `.brud/history/blobs/<shard>/<sha256>` before the
 * SQLite transaction starts. The ledger then marks the session committed and
 * inserts every file row in one transaction; any failure rolls that
 * transaction back, leaving the session manifest intact and active.
 */
export async function commitSession(input: CommitSessionInput): Promise<CommitReceipt> {
  const finalized = new Map<string, FileDelta>();

  for (const delta of input.deltas) {
    if (delta.isChanged) {
      finalized.set(delta.relativePath, delta);
    }
  }

  const rows: SessionFileInsertRow[] = [];
  const blobs: CasBlobWrite[] = [];

  for (const delta of finalized.values()) {
    const blob = await storeBlob(input.fileSystem, delta);

    if (blob !== null) {
      blobs.push(blob);
    }

    rows.push(toFileRow(delta, blob?.sha256 ?? null));
  }

  input.ledger.commitSession(input.sessionId, rows);

  return {
    sessionId: input.sessionId,
    committedFileCount: rows.length,
    committedAt: input.committedAt ?? new Date().toISOString(),
    blobs,
  };
}
