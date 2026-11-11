import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrudConfigError } from './types.js';

/**
 * Runtime integrity for the root config document.
 *
 * The root config is read exactly once per boot. Its digest is recorded then,
 * and every later read of that path is checked against the record. While a
 * kernel is alive the path is also made read-only and mutating `node:fs`
 * operations against it are refused before they reach the host.
 */

type AnyFunction = (...args: unknown[]) => unknown;
type MutableFs = Record<string, unknown>;

const CONFIG_DIGESTS = new Map<string, string>();

const ACTIVE_PROTECTIONS = new Map<string, number>();

const ORIGINAL_MODES = new Map<string, number>();

const DELETION_ANCESTORS: string[] = [];

let guardInstalled = false;

function digestOf(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

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

function configPathError(configPath: string, operation: string): BrudConfigError {
  return new BrudConfigError(
    'CONFIG_INTEGRITY',
    `The root config file is protected and cannot be ${operation}: ${configPath}`,
    configPath,
  );
}

function isStrictAncestor(ancestor: string, target: string): boolean {
  return target.startsWith(ancestor.endsWith(sep) ? ancestor : `${ancestor}${sep}`);
}

function assertConfigMutable(target: unknown, operation: string): void {
  const keys = pathKeys(target);

  // Removing a whole directory that happens to contain the config is a
  // directory-level operation, not a config-targeted write. Direct deletion,
  // rename, or overwrite of the config still fails closed.
  if (
    operation === 'deleted'
    && DELETION_ANCESTORS.some((ancestor) =>
      keys.some((key) => isStrictAncestor(ancestor, key)))
  ) {
    return;
  }

  for (const key of keys) {
    if (ACTIVE_PROTECTIONS.has(key)) {
      throw configPathError(key, operation);
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

function guardSync(original: AnyFunction, indexes: readonly number[], operation: string): AnyFunction {
  return function(this: unknown, ...args: unknown[]): unknown {
    for (const index of indexes) {
      assertConfigMutable(args[index], operation);
    }

    return Reflect.apply(original, this, args);
  };
}

function guardCallback(original: AnyFunction, indexes: readonly number[], operation: string): AnyFunction {
  return function(this: unknown, ...args: unknown[]): unknown {
    try {
      for (const index of indexes) {
        assertConfigMutable(args[index], operation);
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

function guardPromise(original: AnyFunction, indexes: readonly number[], operation: string): AnyFunction {
  return function(this: unknown, ...args: unknown[]): unknown {
    try {
      for (const index of indexes) {
        assertConfigMutable(args[index], operation);
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
      assertConfigMutable(args[0], 'opened for writing');
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

function recursiveDeletionAncestor(target: unknown): string | undefined {
  const keys = pathKeys(target);

  return keys[0];
}

function isRecursiveOptions(value: unknown): boolean {
  return value !== null
    && typeof value === 'object'
    && (value as { readonly recursive?: unknown }).recursive === true;
}

function guardRemoveSync(original: AnyFunction): AnyFunction {
  return function(this: unknown, ...args: unknown[]): unknown {
    if (!isRecursiveOptions(args[1])) {
      assertConfigMutable(args[0], 'deleted');
      return Reflect.apply(original, this, args);
    }

    const ancestor = recursiveDeletionAncestor(args[0]);

    if (ancestor === undefined) {
      return Reflect.apply(original, this, args);
    }

    DELETION_ANCESTORS.push(ancestor);

    try {
      return Reflect.apply(original, this, args);
    } finally {
      DELETION_ANCESTORS.pop();
    }
  };
}

function guardRemoveCallback(original: AnyFunction): AnyFunction {
  return function(this: unknown, ...args: unknown[]): unknown {
    if (!isRecursiveOptions(args[1])) {
      assertConfigMutable(args[0], 'deleted');
      return Reflect.apply(original, this, args);
    }

    const ancestor = recursiveDeletionAncestor(args[0]);

    if (ancestor === undefined) {
      return Reflect.apply(original, this, args);
    }

    DELETION_ANCESTORS.push(ancestor);

    const callback = args.at(-1);

    if (typeof callback !== 'function') {
      try {
        return Reflect.apply(original, this, args);
      } finally {
        DELETION_ANCESTORS.pop();
      }
    }

    const wrapped = (...callbackArgs: unknown[]): unknown => {
      DELETION_ANCESTORS.pop();
      return Reflect.apply(callback, undefined, callbackArgs);
    };

    return Reflect.apply(original, this, [...args.slice(0, -1), wrapped]);
  };
}

function guardRemovePromise(original: AnyFunction): AnyFunction {
  return function(this: unknown, ...args: unknown[]): unknown {
    if (!isRecursiveOptions(args[1])) {
      assertConfigMutable(args[0], 'deleted');
      return Reflect.apply(original, this, args);
    }

    const ancestor = recursiveDeletionAncestor(args[0]);

    if (ancestor === undefined) {
      return Reflect.apply(original, this, args);
    }

    DELETION_ANCESTORS.push(ancestor);

    const result = Reflect.apply(original, this, args) as Promise<unknown>;

    return result.finally(() => {
      DELETION_ANCESTORS.pop();
    });
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

function addProtectionKeys(configPath: string): readonly string[] {
  const keys = pathKeys(configPath);

  for (const key of keys) {
    ACTIVE_PROTECTIONS.set(key, (ACTIVE_PROTECTIONS.get(key) ?? 0) + 1);
  }

  return keys;
}

/**
 * Records the digest of the raw config document and returns it.
 *
 * A second read at the same path must hash identically. This is what makes a
 * modified config refuse a reboot even if it changed outside the guarded APIs.
 *
 * @param configPath - Path the document was read from.
 * @param raw - Exact file contents.
 */
export function recordConfigRead(configPath: string, raw: string): void {
  const key = resolvePath(configPath);
  const digest = digestOf(raw);
  const recorded = CONFIG_DIGESTS.get(key);

  if (recorded !== undefined && recorded !== digest) {
    throw new BrudConfigError(
      'CONFIG_INTEGRITY',
      `Config integrity check failed: "${key}" changed since it was first read`,
      configPath,
    );
  }

  CONFIG_DIGESTS.set(key, digest);
}

/**
 * Marks the root config read-only for the lifetime of one kernel.
 *
 * Both the declared path and its real path are protected so an alias cannot
 * bypass the guard.
 *
 * @param configPath - Path the kernel read.
 */
export function protectConfigFile(configPath: string): void {
  installWriteGuard();
  const keys = addProtectionKeys(configPath);

  if (keys.length === 0) {
    return;
  }

  const primary = keys[0] as string;

  if (!ORIGINAL_MODES.has(primary)) {
    try {
      ORIGINAL_MODES.set(primary, fs.statSync(primary).mode);
      fs.chmodSync(primary, 0o444);
    } catch {
      // A host that cannot change the mode still gets the API-level guard.
    }
  }
}

/**
 * Releases one kernel's claim on the config path.
 *
 * The digest record is intentionally retained for the process lifetime, so a
 * later boot of the same path is still compared against the first read.
 *
 * @param configPath - Path the kernel read.
 */
export function releaseConfigProtection(configPath: string): void {
  const keys = pathKeys(configPath);

  for (const key of keys) {
    const count = ACTIVE_PROTECTIONS.get(key);

    if (count === undefined) {
      continue;
    }

    if (count <= 1) {
      ACTIVE_PROTECTIONS.delete(key);
    } else {
      ACTIVE_PROTECTIONS.set(key, count - 1);
    }
  }

  const primary = resolvePath(configPath);
  const mode = ORIGINAL_MODES.get(primary);

  if (mode !== undefined && !ACTIVE_PROTECTIONS.has(primary)) {
    try {
      fs.chmodSync(primary, mode);
    } catch {
      // Best effort; the file may have been removed.
    }

    ORIGINAL_MODES.delete(primary);
  }
}

/**
 * Re-reads the config and compares it with the digest recorded at boot.
 *
 * @param configPath - Path the kernel read.
 */
export async function verifyConfigIntegrity(configPath: string): Promise<void> {
  const key = resolvePath(configPath);
  const recorded = CONFIG_DIGESTS.get(key);

  let raw: string;

  try {
    raw = await readFile(configPath, 'utf8');
  } catch (error: unknown) {
    throw new BrudConfigError(
      'CONFIG_INTEGRITY',
      `Config integrity check failed: cannot re-read "${key}": ${error instanceof Error ? error.message : String(error)}`,
      configPath,
    );
  }

  if (recorded === undefined || recorded !== digestOf(raw)) {
    throw new BrudConfigError(
      'CONFIG_INTEGRITY',
      `Config integrity check failed: "${key}" no longer matches its boot-time digest`,
      configPath,
    );
  }
}