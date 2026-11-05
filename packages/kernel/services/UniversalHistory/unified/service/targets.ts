/** Target-path normalization and content classification (ported from legacy capture rules). */
import { UnifiedInvalidTargetPathError } from './errors.js';

/** Same probe window as the legacy session ledger. */
export const BINARY_PROBE_LENGTH = 8_000;

/** Paths inside history storage are never recorded. */
export const HISTORY_PATH_PREFIX = '.brud/history';

/**
 * Reserved digest identifying a directory node in the byte-based session
 * target model.
 *
 * Session targets record a single SHA-256 per state, or `null` when the target
 * is absent. A directory has no bytes to hash, so it is represented by this
 * fixed digest. The reversal engine recognises it and performs a directory
 * create/remove instead of a byte restore.
 *
 * The value is a valid 64-hex string, so it is *not* collision-proof on its
 * own. Collision safety is enforced structurally: a directory state is only
 * `(DIRECTORY_STATE_SHA256, size 0)`. A file whose content actually hashed to
 * this digest would necessarily be non-empty (`sha256("")` is a different
 * value), so it is classified as a file by {@link classifyTargetState} and is
 * restored byte-for-byte instead of being treated as a directory. Existing
 * session-target payloads already carry `preSize`/`postSize`, so this needs no
 * schema or persistence change.
 */
export const DIRECTORY_STATE_SHA256 =
  '6fdda86b4885b7c3ee174f8dc7f649276c6b4fec8d368eb0e968dafaa4be2424';

/** The node kind a recorded `(digest, size)` pair represents. */
export type TargetStateKind = 'missing' | 'file' | 'directory';

/**
 * Classifies a recorded target state without touching the filesystem.
 *
 * `null` is absent. The reserved directory digest is a directory only when the
 * recorded size is zero. A real file that collided with the reserved digest
 * cannot be empty (SHA-256 of an empty file is a different constant), so its
 * recorded size is non-zero and it classifies as a file. Every other digest is
 * a file.
 */
export function classifyTargetState(sha256: string | null, size: number): TargetStateKind {
  if (sha256 === null) {
    return 'missing';
  }
  if (sha256 === DIRECTORY_STATE_SHA256 && size === 0) {
    return 'directory';
  }
  return 'file';
}

/** Normalizes a declared target to a `/`-separated workspace-relative path. */
export function normalizeTargetPath(candidate: string): string {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.includes('\0')) {
    throw new UnifiedInvalidTargetPathError(String(candidate));
  }
  const unified = candidate.replace(/\\/gu, '/').replace(/\/+$/u, '').replace(/^\.\//u, '');
  if (
    unified.length === 0
    || unified.startsWith('/')
    || /^[A-Za-z]:/u.test(unified)
    || unified.split('/').some((segment) => segment === '..' || segment === '')
  ) {
    throw new UnifiedInvalidTargetPathError(candidate);
  }
  return unified;
}

/** Normalizes and de-duplicates declared targets, preserving first-seen order. */
export function normalizeTargets(targets: readonly string[] | undefined): readonly string[] {
  const seen = new Set<string>();
  for (const target of targets ?? []) {
    seen.add(normalizeTargetPath(target));
  }
  return [...seen];
}

/** A NUL byte within the probe window marks content as binary. */
export function isBinaryContent(bytes: Uint8Array, probeLength = BINARY_PROBE_LENGTH): boolean {
  const limit = Math.min(bytes.byteLength, probeLength);
  for (let index = 0; index < limit; index += 1) {
    if (bytes[index] === 0) {
      return true;
    }
  }
  return false;
}

export function isHistoryPath(path: string): boolean {
  const unified = path.replace(/\\/gu, '/').replace(/^\.\//u, '');
  return unified === HISTORY_PATH_PREFIX || unified.startsWith(`${HISTORY_PATH_PREFIX}/`);
}
