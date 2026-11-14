import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runtime write guard for protected kernel-owned paths.
 *
 * A protected file may be edited by an operator only while the kernel is
 * stopped. While a kernel holds the path, the file is made read-only and every
 * mutating filesystem entry point is refused before it reaches the host. One
 * guard covers every protected path so two stores cannot disagree about which
 * operations are intercepted or which paths are protected.
 */

type AnyFunction = (...args: unknown[]) => unknown;
type MutableFs = Record<string, unknown>;

/** Builds the failure raised when an operation targets a protected path. */
export type ProtectedPathErrorFactory = (
  storagePath: string,
  operation: string,
) => Error;

interface Protection {
  readonly error: ProtectedPathErrorFactory;
  count: number;
  originalMode?: number;
}

const ACTIVE_PROTECTIONS = new Map<string, Protection>();

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

function assertMutable(target: unknown, operation: string): void {
  for (const key of pathKeys(target)) {
    const entry = ACTIVE_PROTECTIONS.get(key);

    if (entry !== undefined) {
      throw entry.error(key, operation);
    }
  }
}

function isStrictAncestor(ancestor: string, target: string): boolean {
  return target.startsWith(ancestor.endsWith(sep) ? ancestor : `${ancestor}${sep}`);
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

function recursiveCoversProtected(target: unknown): boolean {
  const key = pathKeys(target)[0];

  if (key === undefined) {
    return false;
  }

  for (const protectedKey of ACTIVE_PROTECTIONS.keys()) {
    if (isStrictAncestor(key, protectedKey)) {
      return true;
    }
  }

  return false;
}

function assertRemoveMutable(target: unknown, options: unknown): void {
  if (!isRecursiveOptions(options) || !recursiveCoversProtected(target)) {
    assertMutable(target, 'deleted');
  }
}

function guardRemoveSync(original: AnyFunction): AnyFunction {
  return function(this: unknown, ...args: unknown[]): unknown {
    assertRemoveMutable(args[0], args[1]);

    return Reflect.apply(original, this, args);
  };
}

function guardRemoveCallback(original: AnyFunction): AnyFunction {
  return function(this: unknown, ...args: unknown[]): unknown {
    try {
      assertRemoveMutable(args[0], args[1]);
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
      assertRemoveMutable(args[0], args[1]);
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
 * Marks a path read-only for the lifetime of one claim.
 *
 * Both the declared path and its real path are protected so an alias cannot
 * bypass the guard. Repeated claims are reference-counted.
 *
 * @param storagePath - Absolute or resolvable path to protect.
 * @param error - Failure factory for operations that target the path.
 */
export function protectPath(
  storagePath: string,
  error: ProtectedPathErrorFactory,
): void {
  installWriteGuard();

  const keys = pathKeys(storagePath);

  if (keys.length === 0) {
    return;
  }

  const primary = keys[0] as string;

  if (ACTIVE_PROTECTIONS.has(primary)) {
    for (const key of keys) {
      const entry = ACTIVE_PROTECTIONS.get(key);

      if (entry === undefined) {
        ACTIVE_PROTECTIONS.set(key, { error, count: 1 });
      } else {
        entry.count += 1;
      }
    }

    return;
  }

  let originalMode: number | undefined;

  try {
    if (fs.existsSync(primary)) {
      originalMode = fs.statSync(primary).mode;
      fs.chmodSync(primary, 0o444);
    }
  } catch {
    // A host that cannot change the mode still gets the API-level guard.
  }

  for (const key of keys) {
    const entry = ACTIVE_PROTECTIONS.get(key);

    if (entry === undefined) {
      ACTIVE_PROTECTIONS.set(key, {
        error,
        count: 1,
        ...(originalMode === undefined ? {} : { originalMode }),
      });
    } else {
      entry.count += 1;
    }
  }
}

/**
 * Releases one claim on a protected path.
 *
 * @param storagePath - Path whose claim is released.
 */
export function releasePath(storagePath: string): void {
  const keys = pathKeys(storagePath);
  const primary = keys[0];
  const primaryMode = primary === undefined
    ? undefined
    : ACTIVE_PROTECTIONS.get(primary)?.originalMode;

  for (const key of keys) {
    const entry = ACTIVE_PROTECTIONS.get(key);

    if (entry === undefined) {
      continue;
    }

    if (entry.count <= 1) {
      ACTIVE_PROTECTIONS.delete(key);
    } else {
      entry.count -= 1;
    }
  }

  if (
    primary !== undefined
    && !ACTIVE_PROTECTIONS.has(primary)
    && primaryMode !== undefined
  ) {
    try {
      fs.chmodSync(primary, primaryMode);
    } catch {
      // Best effort; the file may have been removed.
    }
  }
}

/** Reports whether a path is currently protected by this process. */
export function isPathProtected(storagePath: string): boolean {
  return ACTIVE_PROTECTIONS.has(resolvePath(storagePath));
}