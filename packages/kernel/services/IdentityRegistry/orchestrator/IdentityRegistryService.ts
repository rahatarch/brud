import { randomBytes } from 'node:crypto';
import { resolve as resolvePath } from 'node:path';
import {
  protectConfigFile,
  releaseConfigProtection,
} from '../../../src/bootstrap/config/integrity.js';
import type { IServiceLifecycle } from '../../../src/contracts/lifecycle.js';
import {
  IdentityRegistryFrozenError,
  IdentityRegistryInputError,
  IdentityRegistryNotReadyError,
  IdentityRegistryRevokedError,
  IdentityRegistryUnknownTokenError,
} from '../contracts/errors.js';
import type {
  IdentityBinding,
  IdentityRecord,
  IdentityState,
  IdentityToken,
  IIdentityRegistry,
} from '../contracts/types.js';
import {
  JsonValueError,
  canonicalJson,
  cloneJsonRecord,
  isPlainRecord,
} from '../../shared/canonicalJson.js';
import {
  IDENTITY_REGISTRY_MAX_METADATA_BYTES,
  IDENTITY_REGISTRY_MAX_OPAQUE_LENGTH,
  identityBindingKey,
  loadIdentityRegistryStorage,
  persistIdentityRegistryStorage,
} from '../storage/registryDocument.js';

/** Construction options for {@link IdentityRegistryService}. */
export interface IdentityRegistryServiceOptions {
  /** Absolute path to the operator-provisioned registry file. */
  readonly storagePath: string;
}

/** Mutable in-memory form of a persisted record. */
interface MutableIdentityRecord {
  token: string;
  publisher: string;
  contentHash: string;
  metadata: Readonly<Record<string, unknown>>;
  state: IdentityState;
}

/** Validates an opaque string without interpreting it. */
function requireOpaqueString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new IdentityRegistryInputError(field, 'must be a non-empty string');
  }

  if (value.length > IDENTITY_REGISTRY_MAX_OPAQUE_LENGTH) {
    throw new IdentityRegistryInputError(
      field,
      `must be at most ${String(IDENTITY_REGISTRY_MAX_OPAQUE_LENGTH)} characters`,
    );
  }

  return value;
}

/** Validates and clones opaque JSON metadata. */
function requireMetadata(value: unknown): Readonly<Record<string, unknown>> {
  try {
    const metadata = cloneJsonRecord(value);

    if (
      Buffer.byteLength(canonicalJson(metadata), 'utf8')
      > IDENTITY_REGISTRY_MAX_METADATA_BYTES
    ) {
      throw new IdentityRegistryInputError(
        'metadata',
        `must be at most ${String(IDENTITY_REGISTRY_MAX_METADATA_BYTES)} canonical bytes`,
      );
    }

    return metadata;
  } catch (error: unknown) {
    if (error instanceof IdentityRegistryInputError) {
      throw error;
    }

    const reason = error instanceof JsonValueError
      ? error.message
      : 'must be a JSON object';

    throw new IdentityRegistryInputError('metadata', reason);
  }
}

/** Returns an immutable copy of one record. */
function snapshot(record: MutableIdentityRecord): IdentityRecord {
  return Object.freeze({
    token: record.token,
    publisher: record.publisher,
    contentHash: record.contentHash,
    metadata: record.metadata,
    state: record.state,
  });
}

/**
 * Kernel-owned identity registry service.
 *
 * The registry records opaque bindings, issues one stable token per binding,
 * and is writable only during boot. `initialize` loads and integrity-checks
 * the operator-provisioned document and protects it with the same guard class
 * as the root config. `onRunning` freezes the service first, then persists the
 * final document atomically and re-protects it.
 */
export class IdentityRegistryService implements IIdentityRegistry, IServiceLifecycle {
  readonly #storagePath: string;
  readonly #byToken = new Map<string, MutableIdentityRecord>();
  readonly #byBinding = new Map<string, MutableIdentityRecord>();
  #registryId = '';
  #initialized = false;
  #frozen = false;
  #dirty = false;
  #protected = false;

  constructor(options: IdentityRegistryServiceOptions) {
    this.#storagePath = resolvePath(options.storagePath);
  }

  /**
   * Loads and integrity-checks the registry, then protects the file.
   *
   * A missing or corrupt document fails here; the registry never regenerates
   * an existing storage location.
   */
  public initialize(): void {
    if (this.#initialized) {
      return;
    }

    const loaded = loadIdentityRegistryStorage(this.#storagePath);

    for (const record of loaded.records) {
      const mutable: MutableIdentityRecord = {
        token: record.token,
        publisher: record.publisher,
        contentHash: record.contentHash,
        metadata: record.metadata,
        state: record.state,
      };

      this.#byToken.set(record.token, mutable);
      this.#byBinding.set(identityBindingKey(record.publisher, record.contentHash), mutable);
    }

    this.#registryId = loaded.registryId;
    protectConfigFile(this.#storagePath);
    this.#protected = true;
    this.#initialized = true;
  }

  /** {@inheritDoc IIdentityRegistry.issue} */
  public issue(binding: IdentityBinding): IdentityRecord {
    this.#assertMutable('issue');

    const candidate: unknown = binding;

    if (!isPlainRecord(candidate)) {
      throw new IdentityRegistryInputError('binding', 'must be an object');
    }

    const publisher = requireOpaqueString(candidate.publisher, 'publisher');
    const contentHash = requireOpaqueString(candidate.contentHash, 'contentHash');
    const metadata = requireMetadata(candidate.metadata);
    const key = identityBindingKey(publisher, contentHash);
    const existing = this.#byBinding.get(key);

    if (existing !== undefined) {
      if (existing.state === 'revoked') {
        throw new IdentityRegistryRevokedError(existing.token);
      }

      existing.metadata = metadata;
      existing.state = 'active';
      this.#dirty = true;

      return snapshot(existing);
    }

    const record = this.#createRecord(publisher, contentHash, metadata);
    this.#byToken.set(record.token, record);
    this.#byBinding.set(key, record);
    this.#dirty = true;

    return snapshot(record);
  }

  /** {@inheritDoc IIdentityRegistry.resolve} */
  public resolve(token: IdentityToken): IdentityRecord | null {
    if (typeof token !== 'string') {
      return null;
    }

    const record = this.#byToken.get(token);

    return record === undefined ? null : snapshot(record);
  }

  /** {@inheritDoc IIdentityRegistry.retire} */
  public retire(token: IdentityToken): IdentityRecord {
    this.#assertMutable('retire');

    const record = this.#requireRecord(token);

    if (record.state === 'revoked') {
      throw new IdentityRegistryRevokedError(token);
    }

    if (record.state === 'retired') {
      return snapshot(record);
    }

    record.state = 'retired';
    this.#dirty = true;

    return snapshot(record);
  }

  /** {@inheritDoc IIdentityRegistry.revoke} */
  public revoke(token: IdentityToken): IdentityRecord {
    this.#assertMutable('revoke');

    const record = this.#requireRecord(token);

    if (record.state === 'revoked') {
      return snapshot(record);
    }

    record.state = 'revoked';
    this.#dirty = true;

    return snapshot(record);
  }

  /**
   * Freezes the registry and persists the final document.
   *
   * Freezing happens first so no mutation can occur while the write is in
   * flight. The write releases the protected-path guard only for a synchronous
   * atomic write/verify/re-protect block.
   */
  public onRunning(): void {
    if (!this.#initialized) {
      throw new IdentityRegistryNotReadyError('freeze');
    }

    this.#frozen = true;

    if (!this.#dirty) {
      return;
    }

    this.#persist();
    this.#dirty = false;
  }

  /** Releases the protected-path claim held for this kernel. */
  public dispose(): void {
    if (this.#protected) {
      releaseConfigProtection(this.#storagePath);
      this.#protected = false;
    }
  }

  /** Returns the protected storage path. */
  public get storagePath(): string {
    return this.#storagePath;
  }

  /** Creates a new opaque token that is not already recorded. */
  #createRecord(
    publisher: string,
    contentHash: string,
    metadata: Readonly<Record<string, unknown>>,
  ): MutableIdentityRecord {
    for (;;) {
      const token = `idt_${randomBytes(32).toString('base64url')}`;

      if (!this.#byToken.has(token)) {
        return {
          token,
          publisher,
          contentHash,
          metadata,
          state: 'active',
        };
      }
    }
  }

  /** Persists the exact in-memory state and verifies the written file. */
  #persist(): void {
    const records = [...this.#byToken.values()].map(snapshot);
    const wasProtected = this.#protected;

    if (wasProtected) {
      releaseConfigProtection(this.#storagePath);
      this.#protected = false;
    }

    try {
      persistIdentityRegistryStorage(this.#storagePath, this.#registryId, records);

      // Read the document back so the file that will be trusted on the next
      // boot is the file that was integrity-checked in this one.
      loadIdentityRegistryStorage(this.#storagePath);
    } finally {
      if (wasProtected) {
        protectConfigFile(this.#storagePath);
        this.#protected = true;
      }
    }
  }

  /** Refuses mutation before load and after freeze. */
  #assertMutable(operation: string): void {
    if (!this.#initialized) {
      throw new IdentityRegistryNotReadyError(operation);
    }

    if (this.#frozen) {
      throw new IdentityRegistryFrozenError(operation);
    }
  }

  /** Resolves a required record for a mutating operation. */
  #requireRecord(token: IdentityToken): MutableIdentityRecord {
    if (typeof token !== 'string' || token.length === 0) {
      throw new IdentityRegistryUnknownTokenError(String(token));
    }

    const record = this.#byToken.get(token);

    if (record === undefined) {
      throw new IdentityRegistryUnknownTokenError(token);
    }

    return record;
  }
}

