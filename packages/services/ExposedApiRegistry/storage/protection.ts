import fs from 'node:fs';
import { existsSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExposedApiScopeRecordWriteError } from '../contracts/errors.js';

/**
 * Runtime write protection for the exposed API scope record.
 *
 * The scope record may be edited by an operator only while the kernel is
 * stopped. While a kernel holds the path, the file is made read-only and every
 * mutating filesystem entry point is refused before it reaches the host. This
 * mirrors the identity registry's protected-store pattern.
 */

type AnyFunction = (...args: unknown[]) => unknown;
type MutableFs = Record<string, unknown>;

interface ActiveProtection {
  count: number;
  readonly originalMode: number;
}

const ACTIVE_PROTECTIONS = new Map<string, ActiveProtection>();

let guardInstalled = false;

function pathKeys(target: unknown): readonly string[] {
  let text: string | undefined;

  if (typeof target === 'string') {
    text = target;
  } else if (Buffer.isBuffer(target)) {
    text = target.toString();
  } else if (target instanceof URL) {
    try {
      text = fileURLToPath(target);
    } catch {
      return [];
    }
  }

  if (text === undefined) {
    return [];
  }

  const resolved = resolvePath(text);
  const keys = [resolved];

  try {
    const real = fs.realpathSync.native(resolved);

    if (real !== resolved) {
      keys.push(real);
    }
  } catch {
    // A target that does not exist yet can still equal the protected path.
  }

  return keys;
}

function protectedPathError(storagePath: string, operation: string): ExposedApiScopeRecordWriteError {
  return new ExposedApiScopeRecordWriteError(
    storagePath,
    `scope record is protected and cannot be ${operation} while the kernel is running`,
  );
}

function assertMutable(target: unknown, operation: string): void {
  for (const key of pathKeys(target)) {
    if (ACTIVE_PROTECTIONS.has(key)) {
      throw protectedPathError(key, operation);
    }
  }
}

function flagsMutate(flags: unknown): boolean {
  if (typeof flags === 'string') {
    return /[wa+]/u.test(flags);
  }

  if (typeof flags === 'number') {
    const constants = fs.constants;
    const mutable = constants.O_WRONLY
      | constants.O_RDWR
      | constants.O_CREAT
      | constants.O_TRUNC
      | constants.O_APPEND;

    return (flags & mutable) !== 0;
  }

  return false;
}

function guardSync(
  original: AnyFunction,
  indexes: readonly number[],
  operation: string,
): AnyFunction {
  return function(this: unknown, ...args: unknown[]): unknown {
    for (const index of indexes) {
      assertMutable(args[index], operation);
    }

    return Reflect.apply(original, this, args);
  };
}

function guardCallback(
  original: AnyFunction,
  indexes: readonly number[],
  operation: string,
): AnyFunction {
  return function(this: unknown, ...args: unknown[]): unknown {
    try {
      for (const index of indexes) {
        assertMutable(args[index], operation);
      }
    } catch (error: unknown) {
      const callback = args.at(-1);

      if (typeof callback === 'function') {
        Reflect.apply(callback, undefined, [error]);

        return undefined;
      }

      throw error;
    }

    return Reflect.apply(original, this, args);
  };
}

function guardPromise(
  original: AnyFunction,
  indexes: readonly number[],
  operation: string,
): AnyFunction {
  return function(this: unknown, ...args: unknown[]): unknown {
    try {
      for (const index of indexes) {
        assertMutable(args[index], operation);
      }
    } catch (error: unknown) {
      return Promise.reject(error);
    }

    return Reflect.apply(original, this, args);
  };
}

function guardOpen(original: AnyFunction): AnyFunction {
  return function(this: unknown, ...args: unknown[]): unknown {
    if (flagsMutate(args[1])) {
      assertMutable(args[0], 'opened for writing');
    }

    return Reflect.apply(original, this, args);
  };
}

function replace(
  target: MutableFs,
  name: string,
  wrap: (original: AnyFunction) => AnyFunction,
): void {
  const original = target[name];

  if (typeof original === 'function') {
    target[name] = wrap(original as AnyFunction);
  }
}

const SYNC_TARGETS: readonly (readonly [string, readonly number[], string])[] = [
  ['writeFileSync', [0], 'written'],
  ['appendFileSync', [0], 'written'],
  ['truncateSync', [0], 'truncated'],
  ['unlinkSync', [0], 'deleted'],
  ['chmodSync', [0], 'modified'],
  ['lchmodSync', [0], 'modified'],
  ['chownSync', [0], 'modified'],
  ['lchownSync', [0], 'modified'],
  ['utimesSync', [0], 'modified'],
  ['lutimesSync', [0], 'modified'],
  ['renameSync', [0, 1], 'renamed'],
  ['copyFileSync', [1], 'overwritten'],
  ['cpSync', [1], 'overwritten'],
  ['linkSync', [1], 'overwritten'],
  ['symlinkSync', [1], 'overwritten'],
];

const CALLBACK_TARGETS: readonly (readonly [string, readonly number[], string])[] = [
  ['writeFile', [0], 'written'],
  ['appendFile', [0], 'written'],
  ['truncate', [0], 'truncated'],
  ['unlink', [0], 'deleted'],
  ['chmod', [0], 'modified'],
  ['lchmod', [0], 'modified'],
  ['chown', [0], 'modified'],
  ['lchown', [0], 'modified'],
  ['utimes', [0], 'modified'],
  ['lutimes', [0], 'modified'],
  ['rename', [0, 1], 'renamed'],
  ['copyFile', [1], 'overwritten'],
  ['cp', [1], 'overwritten'],
  ['link', [1], 'overwritten'],
  ['symlink', [1], 'overwritten'],
];

const PROMISE_TARGETS: readonly (readonly [string, readonly number[], string])[] = [
  ['writeFile', [0], 'written'],
  ['appendFile', [0], 'written'],
  ['truncate', [0], 'truncated'],
  ['unlink', [0], 'deleted'],
  ['chmod', [0], 'modified'],
  ['lchmod', [0], 'modified'],
  ['chown', [0], 'modified'],
  ['lchown', [0], 'modified'],
  ['utimes', [0], 'modified'],
  ['lutimes', [0], 'modified'],
  ['rename', [0, 1], 'renamed'],
  ['copyFile', [1], 'overwritten'],
  ['cp', [1], 'overwritten'],
  ['link', [1], 'overwritten'],
  ['symlink', [1], 'overwritten'],
];

function isRecursiveOptions(value: unknown): boolean {
  return value !== null
    && typeof value === 'object'
    && (value as { readonly recursive?: unknown }).recursive === true;
}

function isStrictAncestor(ancestor: string, target: string): boolean {
  return target.startsWith(ancestor.endsWith(sep) ? ancestor : `${ancestor}${sep}`);
}

function guardRemoveSync(original: AnyFunction): AnyFunction {
  return function(this: unknown, ...args: unknown[]): unknown {
    if (!isRecursiveOptions(args[1])) {
      assertMutable(args[0], 'deleted');
    } else {
      // Removing a containing directory is a directory-level operation. A
      // direct delete, rename, or overwrite of the record still fails closed.
      const target = pathKeys(args[0])[0];

      if (target !== undefined) {
        for (const key of ACTIVE_PROTECTIONS.keys()) {
          if (isStrictAncestor(target, key)) {
            return Reflect.apply(original, this, args);
          }
        }
      }

      assertMutable(args[0], 'deleted');
    }

    return Reflect.apply(original, this, args);
  };
}

function guardRemoveCallback(original: AnyFunction): AnyFunction {
  return function(this: unknown, ...args: unknown[]): unknown {
    try {
      if (isRecursiveOptions(args[1])) {
        const target = pathKeys(args[0])[0];
        const coversProtected = target !== undefined
          && [...ACTIVE_PROTECTIONS.keys()].some((key) => isStrictAncestor(target, key));

        if (!coversProtected) {
          assertMutable(args[0], 'deleted');
        }
      } else {
        assertMutable(args[0], 'deleted');
      }
    } catch (error: unknown) {
      const callback = args.at(-1);

      if (typeof callback === 'function') {
        Reflect.apply(callback, undefined, [error]);

        return undefined;
      }

      throw error;
    }

    return Reflect.apply(original, this, args);
  };
}

function guardRemovePromise(original: AnyFunction): AnyFunction {
  return function(this: unknown, ...args: unknown[]): unknown {
    try {
      if (isRecursiveOptions(args[1])) {
        const target = pathKeys(args[0])[0];
        const coversProtected = target !== undefined
          && [...ACTIVE_PROTECTIONS.keys()].some((key) => isStrictAncestor(target, key));

        if (!coversProtected) {
          assertMutable(args[0], 'deleted');
        }
      } else {
        assertMutable(args[0], 'deleted');
      }
    } catch (error: unknown) {
      return Promise.reject(error);
    }

    return Reflect.apply(original, this, args);
  };
}

function installWriteGuard(): void {
  if (guardInstalled) {
    return;
  }

  guardInstalled = true;

  const mutableFs = fs as unknown as MutableFs;

  for (const [name, indexes, operation] of SYNC_TARGETS) {
    replace(mutableFs, name, (original) => guardSync(original, indexes, operation));
  }

  for (const [name, indexes, operation] of CALLBACK_TARGETS) {
    replace(mutableFs, name, (original) => guardCallback(original, indexes, operation));
  }

  replace(mutableFs, 'openSync', (original) => guardOpen(original));
  replace(mutableFs, 'open', (original) => guardOpen(original));

  const originalCreateWriteStream = mutableFs['createWriteStream'];

  if (typeof originalCreateWriteStream === 'function') {
    mutableFs['createWriteStream'] = guardSync(
      originalCreateWriteStream as AnyFunction,
      [0],
      'opened for writing',
    );
  }

  for (const name of ['rmSync', 'rmdirSync']) {
    replace(mutableFs, name, (original) => guardRemoveSync(original));
  }

  for (const name of ['rm', 'rmdir']) {
    replace(mutableFs, name, (original) => guardRemoveCallback(original));
  }

  const promises = mutableFs['promises'] as MutableFs | undefined;

  if (promises !== undefined) {
    for (const name of ['rm', 'rmdir']) {
      replace(promises, name, (original) => guardRemovePromise(original));
    }

    for (const [name, indexes, operation] of PROMISE_TARGETS) {
      replace(promises, name, (original) => guardPromise(original, indexes, operation));
    }

    replace(promises, 'open', (original) => guardOpen(original));
  }

  syncBuiltinESMExports();
}

/**
 * Makes an existing scope record read-only for the running kernel.
 *
 * @param storagePath - Absolute scope record file path.
 */
export function protectScopeRecord(storagePath: string): void {
  installWriteGuard();

  const resolvedPath = resolvePath(storagePath);
  const existing = ACTIVE_PROTECTIONS.get(resolvedPath);

  if (existing !== undefined) {
    existing.count += 1;
    return;
  }

  if (!existsSync(resolvedPath)) {
    return;
  }

  let originalMode = 0o644;

  try {
    originalMode = fs.statSync(resolvedPath).mode;
    fs.chmodSync(resolvedPath, 0o444);
  } catch {
    // A host that cannot change the mode still gets the API-level guard.
  }

  ACTIVE_PROTECTIONS.set(resolvedPath, { count: 1, originalMode });
}

/**
 * Releases one claim on a protected scope record.
 *
 * @param storagePath - Absolute scope record file path.
 */
export function releaseScopeRecordProtection(storagePath: string): void {
  const resolvedPath = resolvePath(storagePath);
  const existing = ACTIVE_PROTECTIONS.get(resolvedPath);

  if (existing === undefined) {
    return;
  }

  if (existing.count > 1) {
    existing.count -= 1;
    return;
  }

  ACTIVE_PROTECTIONS.delete(resolvedPath);

  try {
    fs.chmodSync(resolvedPath, existing.originalMode);
  } catch {
    // Best effort; the file may have been removed.
  }
}

/** Reports whether a scope record path is currently protected by this process. */
export function isScopeRecordProtected(storagePath: string): boolean {
  return ACTIVE_PROTECTIONS.has(resolvePath(storagePath));
}