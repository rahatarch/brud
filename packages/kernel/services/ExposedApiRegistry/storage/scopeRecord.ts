import { readFileSync } from 'node:fs';
import {
  ExposedApiScopeRecordCorruptError,
  ExposedApiScopeRecordPathError,
  ExposedApiScopeRecordWriteError,
} from '../contracts/errors.js';
import {
  EXPOSED_API_NAME_PATTERN,
  isExposedApiScope,
  isExposedApiVersion,
  type ExposedApiScope,
  type ExposedApiVersion,
} from '../contracts/types.js';
import { isPlainRecord } from '../../shared/canonicalJson.js';
import {
  assertExactKeys,
  canonicalDigest,
  digestsEqual,
  resolveAbsoluteStoragePath,
  writeAtomically,
} from '../../shared/documentStore.js';

/** Stable format marker for the protected scope record. */
export const EXPOSED_API_SCOPE_RECORD_FORMAT = 'brud.exposed-api-scope-record';

/** Format version the service understands. */
export const EXPOSED_API_SCOPE_RECORD_VERSION = 1;

/** Maximum accepted API name length in a scope record. */
export const EXPOSED_API_SCOPE_RECORD_MAX_NAME_LENGTH = 1_024;

const DIGEST_ALGORITHM = 'sha256';
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const ROOT_KEYS = new Set(['format', 'version', 'records', 'integrity']);
const INTEGRITY_KEYS = new Set(['algorithm', 'digest']);
const RECORD_KEYS = new Set(['name', 'version', 'scope']);

/** One persisted scope entry. */
export interface ScopeRecordEntry {
  readonly name: string;
  readonly version: ExposedApiVersion;
  readonly scope: ExposedApiScope;
}

interface ScopeRecordBody {
  readonly format: string;
  readonly version: number;
  readonly records: readonly ScopeRecordEntry[];
}

export {
  isScopeRecordProtected,
  protectScopeRecord,
  releaseScopeRecordProtection,
} from './protection.js';

/** Builds the deterministic key for one `(name, version)` identity. */
export function scopeRecordIdentityKey(
  name: string,
  version: ExposedApiVersion,
): string {
  const kind = typeof version === 'number' ? 'major' : 'semver';

  return `${name}\u0000${kind}\u0000${String(version)}`;
}

/** Raises a corrupt-storage failure. */
function corrupt(storagePath: string, reason: string): never {
  throw new ExposedApiScopeRecordCorruptError(storagePath, reason);
}

/** Rejects a storage path that is not an absolute file path. */
export function assertScopeRecordPath(storagePath: string): string {
  return resolveAbsoluteStoragePath(
    storagePath,
    (path) => {
      throw new ExposedApiScopeRecordPathError(path);
    },
  );
}

/** Validates one record and returns a frozen copy. */
function parseRecord(
  value: unknown,
  index: number,
  storagePath: string,
): ScopeRecordEntry {
  if (!isPlainRecord(value)) {
    corrupt(storagePath, `records[${String(index)}] is not an object`);
  }

  assertExactKeys(value, RECORD_KEYS, storagePath, `records[${String(index)}]`, corrupt);

  const name = value.name;

  if (
    typeof name !== 'string'
    || name.length === 0
    || name.length > EXPOSED_API_SCOPE_RECORD_MAX_NAME_LENGTH
    || !EXPOSED_API_NAME_PATTERN.test(name)
  ) {
    corrupt(storagePath, `records[${String(index)}].name is invalid`);
  }

  const version = value.version;

  if (!isExposedApiVersion(version)) {
    corrupt(storagePath, `records[${String(index)}].version is invalid`);
  }

  const scope = value.scope;

  if (!isExposedApiScope(scope)) {
    corrupt(storagePath, `records[${String(index)}].scope is invalid`);
  }

  return Object.freeze({ name, version, scope });
}

/**
 * Parses and integrity-checks a scope record document.
 *
 * @param raw - Exact file contents.
 * @param storagePath - Absolute path used in diagnostics.
 */
export function parseScopeRecordDocument(
  raw: string,
  storagePath: string,
): readonly ScopeRecordEntry[] {
  let document: unknown;

  try {
    document = JSON.parse(raw);
  } catch {
    corrupt(storagePath, 'document is not valid JSON');
  }

  if (!isPlainRecord(document)) {
    corrupt(storagePath, 'document root is not an object');
  }

  assertExactKeys(document, ROOT_KEYS, storagePath, 'document', corrupt);

  if (document.format !== EXPOSED_API_SCOPE_RECORD_FORMAT) {
    corrupt(storagePath, 'document format marker is not supported');
  }

  if (document.version !== EXPOSED_API_SCOPE_RECORD_VERSION) {
    corrupt(storagePath, 'document version is not supported');
  }

  if (!Array.isArray(document.records)) {
    corrupt(storagePath, 'records is not an array');
  }

  const records: ScopeRecordEntry[] = [];
  const identities = new Set<string>();

  for (let index = 0; index < document.records.length; index += 1) {
    const record = parseRecord(document.records[index], index, storagePath);
    const key = scopeRecordIdentityKey(record.name, record.version);

    if (identities.has(key)) {
      corrupt(storagePath, `duplicate identity at records[${String(index)}]`);
    }

    identities.add(key);
    records.push(record);
  }

  const integrity = document.integrity;

  if (!isPlainRecord(integrity)) {
    corrupt(storagePath, 'integrity is not an object');
  }

  assertExactKeys(integrity, INTEGRITY_KEYS, storagePath, 'integrity', corrupt);

  if (integrity.algorithm !== DIGEST_ALGORITHM) {
    corrupt(storagePath, 'integrity algorithm is not supported');
  }

  const digest = integrity.digest;

  if (typeof digest !== 'string' || !DIGEST_PATTERN.test(digest)) {
    corrupt(storagePath, 'integrity digest is invalid');
  }

  const body: ScopeRecordBody = {
    format: EXPOSED_API_SCOPE_RECORD_FORMAT,
    version: EXPOSED_API_SCOPE_RECORD_VERSION,
    records,
  };

  if (!digestsEqual(canonicalDigest(body), digest)) {
    corrupt(storagePath, 'integrity digest mismatch');
  }

  return Object.freeze(records);
}

/**
 * Serializes a scope record document with a fresh integrity digest.
 *
 * @param records - Current records.
 */
export function serializeScopeRecordDocument(
  records: readonly ScopeRecordEntry[],
): string {
  const ordered = [...records].sort((left, right) => {
    const byName = left.name.localeCompare(right.name);

    if (byName !== 0) {
      return byName;
    }

    return String(left.version).localeCompare(String(right.version));
  });
  const body: ScopeRecordBody = {
    format: EXPOSED_API_SCOPE_RECORD_FORMAT,
    version: EXPOSED_API_SCOPE_RECORD_VERSION,
    records: ordered,
  };
  const document = {
    ...body,
    integrity: {
      algorithm: DIGEST_ALGORITHM,
      digest: canonicalDigest(body),
    },
  };

  return `${JSON.stringify(document, null, 2)}\n`;
}

/** Writes a scope record through the shared atomic writer. */
function writeScopeRecordAtomically(storagePath: string, raw: string): void {
  writeAtomically(
    storagePath,
    raw,
    (path, reason) => new ExposedApiScopeRecordWriteError(path, reason),
  );
}

/**
 * Loads and validates a scope record file.
 *
 * @param storagePath - Absolute scope record file path.
 * @returns The records, or `undefined` when the file does not exist yet.
 */
export function loadScopeRecord(
  storagePath: string,
): readonly ScopeRecordEntry[] | undefined {
  const resolvedPath = assertScopeRecordPath(storagePath);

  let raw: string;

  try {
    raw = readFileSync(resolvedPath, 'utf8');
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === 'ENOENT') {
      return undefined;
    }

    throw new ExposedApiScopeRecordCorruptError(
      resolvedPath,
      `storage cannot be read${code === undefined ? '' : ` (${code})`}`,
    );
  }

  return parseScopeRecordDocument(raw, resolvedPath);
}

/**
 * Persists a scope record file atomically.
 *
 * @param storagePath - Absolute scope record file path.
 * @param records - Current records.
 */
export function persistScopeRecord(
  storagePath: string,
  records: readonly ScopeRecordEntry[],
): void {
  const resolvedPath = assertScopeRecordPath(storagePath);
  const raw = serializeScopeRecordDocument(records);

  writeScopeRecordAtomically(resolvedPath, raw);
}

