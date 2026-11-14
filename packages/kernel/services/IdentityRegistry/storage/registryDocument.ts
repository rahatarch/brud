import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
  IdentityRegistryCorruptError,
  IdentityRegistryMissingError,
  IdentityRegistryPathError,
  IdentityRegistryStorageExistsError,
  IdentityRegistryWriteError,
} from '../contracts/errors.js';
import {
  isIdentityState,
  type IdentityRecord,
  type IdentityState,
} from '../contracts/types.js';
import {
  JsonValueError,
  canonicalJson,
  cloneJsonRecord,
  isPlainRecord,
} from '../../shared/canonicalJson.js';
import {
  assertExactKeys,
  canonicalDigest,
  digestsEqual,
  resolveAbsoluteStoragePath,
  writeAtomically,
} from '../../shared/documentStore.js';

/** Stable format marker for the registry document. */
export const IDENTITY_REGISTRY_FORMAT = 'brud.identity-registry';

/** Format version the service understands. */
export const IDENTITY_REGISTRY_VERSION = 1;

/** Maximum accepted length for an opaque publisher or content hash. */
export const IDENTITY_REGISTRY_MAX_OPAQUE_LENGTH = 8_192;

/** Maximum accepted canonical metadata size in bytes. */
export const IDENTITY_REGISTRY_MAX_METADATA_BYTES = 65_536;

const DIGEST_ALGORITHM = 'sha256';
const TOKEN_PATTERN = /^idt_[A-Za-z0-9_-]{43}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const ROOT_KEYS = new Set(['format', 'version', 'registryId', 'records', 'integrity']);
const INTEGRITY_KEYS = new Set(['algorithm', 'digest']);
const RECORD_KEYS = new Set(['token', 'publisher', 'contentHash', 'metadata', 'state']);

interface RegistryBody {
  readonly format: string;
  readonly version: number;
  readonly registryId: string;
  readonly records: readonly IdentityRecord[];
}

/** Result of loading and validating a registry document. */
export interface LoadedIdentityRegistry {
  /** Registry instance identifier recorded at provisioning. */
  readonly registryId: string;

  /** Validated records in document order. */
  readonly records: readonly IdentityRecord[];
}

/** Reports whether a value is a non-empty string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Raises a corrupt-storage failure. */
function corrupt(storagePath: string, reason: string): never {
  throw new IdentityRegistryCorruptError(storagePath, reason);
}

/** Rejects a storage path that is not an absolute file path. */
export function assertIdentityRegistryStoragePath(storagePath: string): string {
  return resolveAbsoluteStoragePath(
    storagePath,
    (path) => {
      throw new IdentityRegistryPathError(path);
    },
  );
}

/** Builds the deterministic lookup key for one binding. */
export function identityBindingKey(publisher: string, contentHash: string): string {
  return canonicalJson([publisher, contentHash]);
}

/** Validates one record and returns a frozen copy. */
function parseRecord(
  value: unknown,
  index: number,
  storagePath: string,
): IdentityRecord {
  if (!isPlainRecord(value)) {
    corrupt(storagePath, `records[${String(index)}] is not an object`);
  }

  assertExactKeys(value, RECORD_KEYS, storagePath, `records[${String(index)}]`, corrupt);

  const token = value.token;

  if (!isNonEmptyString(token) || !TOKEN_PATTERN.test(token)) {
    corrupt(storagePath, `records[${String(index)}].token is not a registry token`);
  }

  const publisher = value.publisher;

  if (
    !isNonEmptyString(publisher)
    || publisher.length > IDENTITY_REGISTRY_MAX_OPAQUE_LENGTH
  ) {
    corrupt(storagePath, `records[${String(index)}].publisher is invalid`);
  }

  const contentHash = value.contentHash;

  if (
    !isNonEmptyString(contentHash)
    || contentHash.length > IDENTITY_REGISTRY_MAX_OPAQUE_LENGTH
  ) {
    corrupt(storagePath, `records[${String(index)}].contentHash is invalid`);
  }

  const state = value.state;

  if (!isIdentityState(state)) {
    corrupt(storagePath, `records[${String(index)}].state is not a supported state`);
  }

  let metadata: Readonly<Record<string, unknown>>;

  try {
    metadata = cloneJsonRecord(value.metadata);

    if (Buffer.byteLength(canonicalJson(metadata), 'utf8') > IDENTITY_REGISTRY_MAX_METADATA_BYTES) {
      corrupt(storagePath, `records[${String(index)}].metadata exceeds the size limit`);
    }
  } catch (error: unknown) {
    if (error instanceof IdentityRegistryCorruptError) {
      throw error;
    }

    const reason = error instanceof JsonValueError
      ? error.message
      : 'metadata is not JSON';

    corrupt(storagePath, `records[${String(index)}].metadata is invalid: ${reason}`);
  }

  return Object.freeze({
    token,
    publisher,
    contentHash,
    metadata,
    state: state as IdentityState,
  });
}

/**
 * Parses and integrity-checks a registry document.
 *
 * @param raw - Exact file contents.
 * @param storagePath - Absolute path used in diagnostics.
 */
export function parseIdentityRegistryDocument(
  raw: string,
  storagePath: string,
): LoadedIdentityRegistry {
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

  if (document.format !== IDENTITY_REGISTRY_FORMAT) {
    corrupt(storagePath, 'document format marker is not supported');
  }

  if (document.version !== IDENTITY_REGISTRY_VERSION) {
    corrupt(storagePath, 'document version is not supported');
  }

  const registryId = document.registryId;

  if (!isNonEmptyString(registryId)) {
    corrupt(storagePath, 'registryId is invalid');
  }

  if (!Array.isArray(document.records)) {
    corrupt(storagePath, 'records is not an array');
  }

  const records: IdentityRecord[] = [];
  const tokens = new Set<string>();
  const bindings = new Set<string>();

  for (let index = 0; index < document.records.length; index += 1) {
    const record = parseRecord(document.records[index], index, storagePath);

    if (tokens.has(record.token)) {
      corrupt(storagePath, `duplicate token at records[${String(index)}]`);
    }

    const bindingKey = identityBindingKey(record.publisher, record.contentHash);

    if (bindings.has(bindingKey)) {
      corrupt(storagePath, `duplicate binding at records[${String(index)}]`);
    }

    tokens.add(record.token);
    bindings.add(bindingKey);
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

  if (!isNonEmptyString(digest) || !DIGEST_PATTERN.test(digest)) {
    corrupt(storagePath, 'integrity digest is invalid');
  }

  const body: RegistryBody = {
    format: IDENTITY_REGISTRY_FORMAT,
    version: IDENTITY_REGISTRY_VERSION,
    registryId,
    records,
  };

  if (!digestsEqual(canonicalDigest(body), digest)) {
    corrupt(storagePath, 'integrity digest mismatch');
  }

  return Object.freeze({
    registryId,
    records: Object.freeze(records),
  });
}

/**
 * Serializes a registry document with a fresh integrity digest.
 *
 * @param registryId - Registry instance identifier.
 * @param records - Current records.
 */
export function serializeIdentityRegistryDocument(
  registryId: string,
  records: readonly IdentityRecord[],
): string {
  const ordered = [...records].sort((left, right) => left.token.localeCompare(right.token));
  const body: RegistryBody = {
    format: IDENTITY_REGISTRY_FORMAT,
    version: IDENTITY_REGISTRY_VERSION,
    registryId,
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

/** Writes a registry document through the shared atomic writer. */
function writeRegistryAtomically(storagePath: string, raw: string): void {
  writeAtomically(
    storagePath,
    raw,
    (path, reason) => new IdentityRegistryWriteError(path, reason),
  );
}

/**
 * Loads and validates a registry file.
 *
 * @param storagePath - Absolute registry file path.
 */
export function loadIdentityRegistryStorage(
  storagePath: string,
): LoadedIdentityRegistry {
  const resolvedPath = assertIdentityRegistryStoragePath(storagePath);

  let raw: string;

  try {
    raw = readFileSync(resolvedPath, 'utf8');
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === 'ENOENT') {
      throw new IdentityRegistryMissingError(resolvedPath);
    }

    throw new IdentityRegistryCorruptError(
      resolvedPath,
      `storage cannot be read${code === undefined ? '' : ` (${code})`}`,
    );
  }

  return parseIdentityRegistryDocument(raw, resolvedPath);
}

/**
 * Persists a registry file atomically.
 *
 * @param storagePath - Absolute registry file path.
 * @param registryId - Registry instance identifier.
 * @param records - Current records.
 */
export function persistIdentityRegistryStorage(
  storagePath: string,
  registryId: string,
  records: readonly IdentityRecord[],
): void {
  const resolvedPath = assertIdentityRegistryStoragePath(storagePath);
  const raw = serializeIdentityRegistryDocument(registryId, records);

  writeRegistryAtomically(resolvedPath, raw);
}

/**
 * Operator provisioning: creates a valid empty registry while the kernel is
 * stopped. Refuses to overwrite an existing registry.
 *
 * @param storagePath - Absolute registry file path.
 */
export function provisionIdentityRegistryStorage(storagePath: string): void {
  const resolvedPath = assertIdentityRegistryStoragePath(storagePath);

  if (existsSync(resolvedPath)) {
    throw new IdentityRegistryStorageExistsError(resolvedPath);
  }

  const raw = serializeIdentityRegistryDocument(randomUUID(), []);
  writeRegistryAtomically(resolvedPath, raw);

  // Read the file back so a provisioning write that produced an unreadable
  // document fails here, while the operator is still present.
  loadIdentityRegistryStorage(resolvedPath);
}