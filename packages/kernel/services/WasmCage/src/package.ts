import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { ParticipantManifest, ServiceDescriptor } from '../../../src/contracts/index.js';
import { createCagedParticipant, type CagedParticipantLimits } from './caged.js';

/**
 * Participant packages: how a participant that is not declared official reaches
 * the kernel (W-01). The package is declarative data plus a WASM module; no
 * author JavaScript is loaded. `brud.participant.json`:
 *
 * ```json
 * { "format": 1, "id": "acme.notes", "manifest": { … },
 *   "cage": { "module": "participant.wasm", "sha256": "<hex>", "limits": { "fuel": …, "maxMemoryBytes": …, "deadlineMs": … } },
 *   "native": "native/index.js" }
 * ```
 *
 * `native` is optional and used only when the composition declares the entry
 * official; the kernel's loader reads it, never this module. `requires` is
 * optional too: `{ "official": true, "powers": [...] }` makes the kernel refuse
 * the entry unless the composition declares it official. The kernel's loader
 * enforces it; this module only accepts the key.
 */
export const PARTICIPANT_PACKAGE_FORMAT = 1;

/** A participant package is malformed or its module failed its digest check. */
export class ParticipantPackageError extends Error {
  public readonly code: 'PARTICIPANT_PACKAGE_INVALID' | 'PARTICIPANT_PACKAGE_TAMPERED';

  constructor(code: 'PARTICIPANT_PACKAGE_INVALID' | 'PARTICIPANT_PACKAGE_TAMPERED', message: string) {
    super(message);
    this.name = 'ParticipantPackageError';
    this.code = code;
  }
}

const PACKAGE_KEYS = new Set(['format', 'id', 'manifest', 'cage', 'native', 'requires']);
const CAGE_KEYS = new Set(['module', 'sha256', 'limits']);
const LIMIT_KEYS = new Set(['fuel', 'maxMemoryBytes', 'deadlineMs']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function invalid(path: string, reason: string): ParticipantPackageError {
  return new ParticipantPackageError('PARTICIPANT_PACKAGE_INVALID', `participant package "${path}": ${reason}`);
}

function onlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string, where: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));

  if (unknown.length > 0) {
    throw invalid(path, `unknown ${where} key(s) ${unknown.join(', ')}`);
  }
}

function limitsOf(value: unknown, path: string): CagedParticipantLimits | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw invalid(path, 'cage.limits must be an object');
  }

  onlyKeys(value, LIMIT_KEYS, path, 'cage.limits');

  for (const key of Object.keys(value)) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || (value[key] as number) <= 0) {
      throw invalid(path, `cage.limits.${key} must be a positive number`);
    }
  }

  if (value.fuel === undefined || value.maxMemoryBytes === undefined) {
    throw invalid(path, 'cage.limits needs fuel and maxMemoryBytes');
  }

  return value as unknown as CagedParticipantLimits;
}

/**
 * Loads a participant package into the cage: validates the package, checks
 * the module's SHA-256 against the package, and returns a service module whose
 * descriptor runs the participant caged.
 *
 * @param manifestPath - Absolute path of `brud.participant.json`.
 * @returns A service module (`createService`).
 * @throws {ParticipantPackageError} For a malformed package or a digest mismatch.
 */
export async function loadParticipantPackage(
  manifestPath: string,
): Promise<{ createService(): ServiceDescriptor<object> }> {
  let pkg: unknown;

  try {
    pkg = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
  } catch (error) {
    throw invalid(manifestPath, `unreadable (${(error as Error).message})`);
  }

  if (!isRecord(pkg)) {
    throw invalid(manifestPath, 'must be a JSON object');
  }

  onlyKeys(pkg, PACKAGE_KEYS, manifestPath, 'package');

  if (pkg.format !== PARTICIPANT_PACKAGE_FORMAT) {
    throw invalid(manifestPath, `format must be ${String(PARTICIPANT_PACKAGE_FORMAT)}`);
  }

  if (typeof pkg.id !== 'string' || pkg.id.length === 0) {
    throw invalid(manifestPath, 'id must be a non-empty string');
  }

  if (!isRecord(pkg.manifest)) {
    throw invalid(manifestPath, 'manifest must be an object');
  }

  if (!isRecord(pkg.cage)) {
    throw invalid(manifestPath, 'cage must be an object (a package not declared official runs caged)');
  }

  onlyKeys(pkg.cage, CAGE_KEYS, manifestPath, 'cage');

  if (typeof pkg.cage.module !== 'string' || typeof pkg.cage.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(pkg.cage.sha256)) {
    throw invalid(manifestPath, 'cage needs a module path and a lower-case hex sha256');
  }

  const root = dirname(manifestPath);
  const modulePath = resolve(root, pkg.cage.module);
  const inside = relative(root, modulePath);

  if (inside.startsWith('..') || isAbsolute(inside)) {
    throw invalid(manifestPath, 'cage.module must stay inside the package');
  }

  let bytes: Buffer;

  try {
    bytes = readFileSync(modulePath);
  } catch (error) {
    throw invalid(manifestPath, `cage.module unreadable (${(error as Error).message})`);
  }

  if (createHash('sha256').update(bytes).digest('hex') !== pkg.cage.sha256) {
    throw new ParticipantPackageError('PARTICIPANT_PACKAGE_TAMPERED', `participant package "${manifestPath}": cage.module failed its digest check`);
  }

  const id = pkg.id;
  const manifest = pkg.manifest as ParticipantManifest;
  const limits = limitsOf(pkg.cage.limits, manifestPath);

  return {
    createService: () => createCagedParticipant({ token: id, manifest, wasm: new Uint8Array(bytes), ...(limits === undefined ? {} : { limits }) }),
  };
}
