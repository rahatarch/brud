import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { BrudConfigError } from './types.js';
import { protectPath, releasePath } from './pathWriteGuard.js';

/**
 * Runtime integrity for the root config document.
 *
 * The root config is read exactly once per boot. Its digest is recorded then,
 * and every later read of that path is checked against the record. While a
 * kernel is alive the path is also made read-only and mutating `node:fs`
 * operations against it are refused before they reach the host.
 */

const CONFIG_DIGESTS = new Map<string, string>();

function digestOf(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function configPathError(configPath: string, operation: string): BrudConfigError {
  return new BrudConfigError(
    'CONFIG_INTEGRITY',
    `The root config file is protected and cannot be ${operation}: ${configPath}`,
    configPath,
  );
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
  protectPath(
    configPath,
    (key, operation) => configPathError(key, operation),
  );
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
  releasePath(configPath);
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