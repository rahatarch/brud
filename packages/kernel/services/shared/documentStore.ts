import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { canonicalJson } from './canonicalJson.js';

/**
 * Shared document primitives for the kernel's integrity-protected stores.
 *
 * Both stores canonicalize a body, digest it, write through an exclusive
 * sibling file and an atomic rename, and compare digests without
 * short-circuiting. Keeping one implementation is what keeps their integrity
 * answers identical.
 */

const DIGEST_ALGORITHM = 'sha256';
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

/** Raises a storage failure selected by the calling store. */
export type StorageFailure = (storagePath: string, reason: string) => never;

/** Builds the write failure selected by the calling store. */
export type WriteErrorFactory = (storagePath: string, reason: string) => Error;

/** Builds the path failure selected by the calling store. */
export type PathFailure = (storagePath: string) => never;

/** Computes the SHA-256 digest over a body's canonical JSON. */
export function canonicalDigest(body: unknown): string {
  return createHash(DIGEST_ALGORITHM)
    .update(canonicalJson(body), 'utf8')
    .digest('hex');
}

/** Compares two lowercase hex digests without short-circuiting. */
export function digestsEqual(expected: string, actual: string): boolean {
  if (!DIGEST_PATTERN.test(expected) || !DIGEST_PATTERN.test(actual)) {
    return false;
  }

  const expectedBytes = Buffer.from(expected, 'hex');
  const actualBytes = Buffer.from(actual, 'hex');

  if (expectedBytes.length !== actualBytes.length) {
    return false;
  }

  return timingSafeEqual(expectedBytes, actualBytes);
}

/** Asserts that an object contains exactly the expected keys. */
export function assertExactKeys(
  value: Record<string, unknown>,
  expected: ReadonlySet<string>,
  storagePath: string,
  label: string,
  fail: StorageFailure,
): void {
  const keys = Object.keys(value);

  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
    fail(storagePath, `${label} has an unexpected shape`);
  }
}

/** Resolves an absolute storage path, or raises the caller's path failure. */
export function resolveAbsoluteStoragePath(
  storagePath: string,
  fail: PathFailure,
): string {
  if (
    typeof storagePath !== 'string'
    || storagePath.length === 0
    || storagePath.includes('\0')
    || !isAbsolute(storagePath)
  ) {
    fail(storagePath);
  }

  return resolve(storagePath);
}

/** Writes bytes through an exclusive sibling file and an atomic rename. */
export function writeAtomically(
  storagePath: string,
  raw: string,
  makeError: WriteErrorFactory,
): void {
  const directory = dirname(storagePath);
  const temporaryPath = join(
    directory,
    `.${basename(storagePath)}.${String(process.pid)}.${randomUUID()}.tmp`,
  );

  let descriptor: number | undefined;

  try {
    mkdirSync(directory, { recursive: true });
    descriptor = openSync(temporaryPath, 'wx', 0o600);
    writeFileSync(descriptor, raw, 'utf8');
    fsyncSync(descriptor);
  } catch (error: unknown) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // The original write failure is the useful one.
      }
      descriptor = undefined;
    }

    try {
      unlinkSync(temporaryPath);
    } catch {
      // Nothing to clean up.
    }

    const code = (error as NodeJS.ErrnoException).code;

    throw makeError(
      storagePath,
      code === undefined ? 'unknown filesystem error' : code,
    );
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }

  try {
    renameSync(temporaryPath, storagePath);
  } catch (error: unknown) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // Nothing to clean up.
    }

    const code = (error as NodeJS.ErrnoException).code;

    throw makeError(
      storagePath,
      code === undefined ? 'unknown filesystem error' : code,
    );
  }
}