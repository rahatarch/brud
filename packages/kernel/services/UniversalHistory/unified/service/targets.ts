/** Target-path normalization and content classification (ported from legacy capture rules). */
import { UnifiedInvalidTargetPathError } from './errors.js';

/** Same probe window as the legacy session ledger. */
export const BINARY_PROBE_LENGTH = 8_000;

/** Paths inside history storage are never recorded. */
export const HISTORY_PATH_PREFIX = '.brud/history';

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
