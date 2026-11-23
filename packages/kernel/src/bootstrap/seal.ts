import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, parse as parsePath } from 'node:path';
import type { SealReference } from './bootTypes.js';
import { resolveModuleId } from './bootKernelInternal.js';
import { computePackageContentHash, hashPackageFile } from './hardcore.js';
import { parseBrudConfig } from './config/parse.js';
import { BrudConfigError, type BrudConfig } from './config/types.js';

interface SealedEntry {
  readonly path: string;
  /** Content hash of the participant. Absent for a `kernel:` entry, whose pin is compiled into the kernel. */
  readonly sha256?: string;
}

interface SealDocument {
  readonly format: 1;
  readonly participants: readonly SealedEntry[];
}

/** A generated seal and its digest. */
export interface CreatedSeal {
  /** The text to write to the seal file. */
  readonly text: string;
  /** SHA-256 hex digest of `text`: the value the built product passes at boot. */
  readonly digest: string;
}

const digestOf = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** Finds the file a bare package specifier names, looking through `node_modules` folders above the config. */
function resolveSpecifier(specifier: string, configPath: string): string {
  try {
    return createRequire(configPath).resolve(specifier);
  } catch {
    for (let dir = dirname(configPath); ; dir = dirname(dir)) {
      const candidate = join(dir, 'node_modules', specifier);

      if (existsSync(candidate) && parsePath(candidate).ext !== '') {
        return candidate;
      }

      if (dirname(dir) === dir) {
        throw new BrudConfigError('MODULE_RESOLVE', `Cannot seal "${specifier}": it does not resolve to a file. Declare the file path.`, configPath);
      }
    }
  }
}

/** The content hash a seal records for one participant. */
function sealHash(declared: string, configPath: string): string {
  const resolved = declared.startsWith('.') || declared.startsWith('/') || declared.startsWith('file:') || declared.startsWith('kernel:')
    ? resolveModuleId(declared, configPath)
    : resolveSpecifier(declared, configPath);

  if (!resolved.endsWith('.json')) {
    return computePackageContentHash(resolved);
  }

  // A participant package: the package file, its module, and the native build it may ship.
  const dir = dirname(resolved);
  const manifest = JSON.parse(readFileSync(resolved, 'utf8')) as { cage?: { module?: string }; native?: string };
  const parts = [hashPackageFile(resolved)];

  if (typeof manifest.cage?.module === 'string') {
    parts.push(hashPackageFile(join(dir, manifest.cage.module)));
  }

  if (typeof manifest.native === 'string') {
    parts.push(computePackageContentHash(join(dir, manifest.native)));
  }

  return digestOf(parts.join('\n'));
}

/**
 * Generates the seal for the official participants a config declares.
 *
 * A builder runs this once per release, after the build is final.
 *
 * @param configPath - The composition's config.
 */
export function createSeal(configPath: string): CreatedSeal {
  const config = parseBrudConfig(readFileSync(configPath, 'utf8'), configPath);
  const participants = config.services
    .filter((entry) => entry.official === true)
    .map((entry): SealedEntry => (entry.path.startsWith('kernel:') ? { path: entry.path } : { path: entry.path, sha256: sealHash(entry.path, configPath) }));
  const text = `${JSON.stringify({ format: 1, participants } satisfies SealDocument, null, 2)}\n`;

  return { text, digest: digestOf(text) };
}

/** What a seal says about a config. */
export interface SealCheck {
  /** Official entries the build did not seal. They are not part of the build and are left out. */
  readonly unsealed: ReadonlySet<string>;
  /** Paths the build sealed. */
  readonly sealed: ReadonlySet<string>;
}

/**
 * Checks a config against the build seal.
 *
 * @throws {BrudConfigError} `SEAL_MISMATCH` when the seal file is not the one
 *   the built product holds the digest of; `SEAL_VIOLATION` when a sealed
 *   participant is missing, out of order, or its content changed.
 */
export function checkSeal(seal: SealReference, config: BrudConfig, configPath: string): SealCheck {
  let text: string;

  try {
    text = readFileSync(seal.path, 'utf8');
  } catch (error: unknown) {
    throw new BrudConfigError('SEAL_MISMATCH', `Cannot read the build seal "${seal.path}": ${error instanceof Error ? error.message : String(error)}`, configPath);
  }

  if (digestOf(text) !== seal.digest) {
    throw new BrudConfigError('SEAL_MISMATCH', `The build seal "${seal.path}" is not the one this build was sealed with. Rebuild to change what the build ships.`, configPath);
  }

  const document = JSON.parse(text) as SealDocument;
  const sealed = new Set(document.participants.map((entry) => entry.path));
  const official = config.services.filter((entry) => entry.official === true && sealed.has(entry.path));
  const problems: string[] = [];

  if (official.map((entry) => entry.path).join('\n') !== document.participants.map((entry) => entry.path).join('\n')) {
    problems.push('the sealed participants are missing, repeated or out of order in the config');
  } else {
    for (const entry of document.participants) {
      if (entry.sha256 !== undefined && sealHash(entry.path, configPath) !== entry.sha256) {
        problems.push(`"${entry.path}" no longer matches the content the build sealed`);
      }
    }
  }

  if (problems.length > 0) {
    throw new BrudConfigError('SEAL_VIOLATION', `The composition does not match its build seal: ${problems.join('; ')}.`, configPath);
  }

  return {
    sealed,
    unsealed: new Set(config.services.filter((entry) => entry.official === true && !sealed.has(entry.path)).map((entry) => entry.path)),
  };
}
