/**
 * Classifies storage failures that mean "history storage is read-only", so the
 * store degrades instead of failing kernel boot (F-UP-1).
 */

const READ_ONLY_ERRNO: ReadonlySet<string> = new Set(['EACCES', 'EPERM', 'EROFS']);

/** SQLite primary result codes: READONLY (8) and CANTOPEN (14). */
const READ_ONLY_SQLITE_PRIMARY: ReadonlySet<number> = new Set([8, 14]);

export function isReadOnlyStorageError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const code: unknown = (error as { code?: unknown }).code;
  if (typeof code === 'string' && READ_ONLY_ERRNO.has(code)) {
    return true;
  }

  const errcode: unknown = (error as { errcode?: unknown }).errcode;
  return typeof errcode === 'number' && READ_ONLY_SQLITE_PRIMARY.has(errcode & 0xff);
}
