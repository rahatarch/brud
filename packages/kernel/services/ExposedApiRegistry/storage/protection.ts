import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { ExposedApiScopeRecordWriteError } from '../contracts/errors.js';
import {
  isPathProtected,
  protectPath,
  releasePath,
} from '../../../src/bootstrap/config/pathWriteGuard.js';

/**
 * Runtime write protection for the exposed API scope record.
 *
 * The scope record may be edited by an operator only while the kernel is
 * stopped. While a kernel holds the path, the file is made read-only and every
 * mutating filesystem entry point is refused before it reaches the host.
 */

/**
 * Makes an existing scope record read-only for the running kernel.
 *
 * @param storagePath - Absolute scope record file path.
 */
export function protectScopeRecord(storagePath: string): void {
  const resolvedPath = resolvePath(storagePath);

  if (!existsSync(resolvedPath)) {
    return;
  }

  protectPath(
    resolvedPath,
    (key, operation) => new ExposedApiScopeRecordWriteError(
      key,
      `scope record is protected and cannot be ${operation} while the kernel is running`,
    ),
  );
}

/**
 * Releases one claim on a protected scope record.
 *
 * @param storagePath - Absolute scope record file path.
 */
export function releaseScopeRecordProtection(storagePath: string): void {
  releasePath(storagePath);
}

/** Reports whether a scope record path is currently protected by this process. */
export function isScopeRecordProtected(storagePath: string): boolean {
  return isPathProtected(storagePath);
}