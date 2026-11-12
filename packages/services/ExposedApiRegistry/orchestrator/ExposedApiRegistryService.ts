import type { IKernelAccessBroker } from '@brud/kernel';
import {
  isCapabilityToken,
  isPublicApiCapability,
} from '@brud/kernel';
import type { IServiceLifecycle, ServiceContext } from '@brud/kernel';
import type { ServiceToken } from '@brud/kernel';
import {
  ExposedApiDisposedError,
  ExposedApiDuplicateCapabilityError,
  ExposedApiInvalidCapabilityError,
  ExposedApiInvalidNameError,
  ExposedApiInvalidPolicyError,
  ExposedApiInvalidScopeError,
  ExposedApiInvalidVersionError,
  ExposedApiNameCollisionError,
  ExposedApiRegistrationClosedError,
  ExposedApiScopeNarrowingError,
  ExposedApiUnknownServiceError,
} from '../contracts/errors.js';
import type { IExposedApiRegistry } from '../contracts/IExposedApiRegistry.js';
import {
  EXPOSED_API_NAME_PATTERN,
  exposedApiScopeAllowsOrigin,
  exposedApiScopeRank,
  isExposedApiOrigin,
  isExposedApiScope,
  isExposedApiVersion,
  type ExposedApiAccessContext,
  type ExposedApiCaller,
  type ExposedApiEntry,
  type ExposedApiIdentity,
  type ExposedApiOrigin,
  type ExposedApiPolicy,
  type ExposedApiRegistration,
  type ExposedApiResolved,
  type ExposedApiScope,
  type ExposedApiVersion,
} from '../contracts/types.js';
import {
  JsonValueError,
  canonicalJson,
  cloneJsonRecord,
} from '../storage/json.js';
import {
  loadScopeRecord,
  persistScopeRecord,
  protectScopeRecord,
  releaseScopeRecordProtection,
  scopeRecordIdentityKey,
  type ScopeRecordEntry,
} from '../storage/scopeRecord.js';

/** API names accept dotted, kebab, and snake segments. */
export { EXPOSED_API_NAME_PATTERN };

/** Maximum accepted canonical policy size in bytes. */
export const EXPOSED_API_MAX_POLICY_BYTES = 65_536;

/** Collaborators injected into {@link ExposedApiRegistryService}. */
export interface ExposedApiRegistryDependencies {
  /** Mediated access used to resolve each registered token. */
  readonly broker: IKernelAccessBroker;

  /** Registry identity used when a caller supplies no access context. */
  readonly callerContext: ServiceContext;

  /**
   * Absolute path to the protected per-product scope record.
   *
   * When omitted, scope is tracked in memory for the lifetime of the service.
   * Hosts that require cross-boot persistence supply an absolute path.
   */
  readonly scopeRecordPath?: string;
}

/** Validates and freezes a policy declaration. */
function normalizePolicy(value: unknown): ExposedApiPolicy {
  try {
    const policy = cloneJsonRecord(value);

    if (Buffer.byteLength(canonicalJson(policy), 'utf8') > EXPOSED_API_MAX_POLICY_BYTES) {
      throw new ExposedApiInvalidPolicyError(
        `must be at most ${String(EXPOSED_API_MAX_POLICY_BYTES)} canonical bytes`,
      );
    }

    return policy;
  } catch (error: unknown) {
    if (error instanceof ExposedApiInvalidPolicyError) {
      throw error;
    }

    const reason = error instanceof JsonValueError
      ? error.message
      : 'must be a JSON object';

    throw new ExposedApiInvalidPolicyError(reason);
  }
}

/**
 * Derives the root origin of a call chain from an access context.
 *
 * An explicit origin always wins. The fallbacks cover the existing callers
 * that predate origin propagation: plugin resolution supplies a plugin subject
 * and is a runtime-origin chain; daemon and embedded host callers are host
 * origin; direct kernel-side access is kernel origin.
 *
 * @param access - Broker access context.
 * @returns The root origin, or `null` when an explicit origin is invalid.
 */
export function deriveExposedApiOrigin(
  access: ExposedApiAccessContext | undefined,
): ExposedApiOrigin | null {
  if (access === undefined) {
    return 'kernel';
  }

  if (access.origin !== undefined) {
    return isExposedApiOrigin(access.origin) ? access.origin : null;
  }

  if (
    typeof access.subjectId === 'string'
    && access.subjectId.length > 0
    && access.subjectId !== access.callerId
  ) {
    return 'runtime';
  }

  if (access.callerId === 'brud.host.daemon' || access.callerId === 'brud.daemon') {
    return 'host';
  }

  if (access.tier === 'userland') {
    return 'runtime';
  }

  return 'kernel';
}

/**
 * Dumb store for service-declared exposures.
 *
 * It does not interpret capabilities, projections, or merge semantics beyond
 * invoking what the declaring service supplied. It enforces the declared scope
 * against the root origin and records the scope for the next boot. Access
 * authority remains with the access broker and each service's descriptor.
 * Policy declarations are stored and returned, never evaluated.
 */
export class ExposedApiRegistryService implements IExposedApiRegistry, IServiceLifecycle {
  private readonly entries = new Map<string, ExposedApiEntry[]>();

  private readonly scopes = new Map<string, ScopeRecordEntry>();

  private readonly dependencies: ExposedApiRegistryDependencies;

  private readonly storagePath: string | undefined;

  private closed = false;

  private disposed = false;

  private initialized = false;

  private protectedRecord = false;

  private dirty = false;

  constructor(dependencies: ExposedApiRegistryDependencies) {
    this.dependencies = dependencies;
    this.storagePath = dependencies.scopeRecordPath;
  }

  /**
   * Loads and integrity-checks the protected scope record.
   *
   * A missing record is the legitimate first-registration case. A corrupt
   * record refuses boot. An existing record is made read-only for the runtime.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initialized = true;

    if (this.storagePath === undefined) {
      return;
    }

    const loaded = loadScopeRecord(this.storagePath);

    if (loaded !== undefined) {
      for (const record of loaded) {
        this.scopes.set(
          scopeRecordIdentityKey(record.name, record.version),
          record,
        );
      }

      protectScopeRecord(this.storagePath);
      this.protectedRecord = true;
    }
  }

  /** Seals the window and persists the final scope record. */
  async onRunning(): Promise<void> {
    this.closeRegistration();

    if (this.storagePath !== undefined && this.dirty) {
      this.#persist();
    }
  }

  /** Releases the protected-path claim and clears every exposure. */
  async dispose(): Promise<void> {
    if (this.storagePath !== undefined && this.protectedRecord) {
      releaseScopeRecordProtection(this.storagePath);
      this.protectedRecord = false;
    }

    this.disposed = true;
    this.closed = true;
    this.entries.clear();
  }

  /** Whether {@link dispose} has run. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Absolute scope-record path, when persistence is configured. */
  get scopeRecordPath(): string | undefined {
    return this.storagePath;
  }

  registerApi<TService>(
    name: string,
    token: ServiceToken<TService>,
    registration: ExposedApiRegistration,
  ): void {
    if (this.disposed) {
      throw new ExposedApiDisposedError();
    }

    if (this.closed) {
      throw new ExposedApiRegistrationClosedError(name);
    }

    if (!EXPOSED_API_NAME_PATTERN.test(name)) {
      throw new ExposedApiInvalidNameError(name);
    }

    if (
      !isPublicApiCapability(registration.capability)
      && !isCapabilityToken(registration.capability)
    ) {
      throw new ExposedApiInvalidCapabilityError(registration.capability);
    }

    if (!this.dependencies.broker.hasService(token)) {
      throw new ExposedApiUnknownServiceError(token.id);
    }

    const version = registration.version === undefined ? 1 : registration.version;

    if (!isExposedApiVersion(version)) {
      throw new ExposedApiInvalidVersionError(version);
    }

    const requestedScope = registration.scope === undefined
      ? 'kernel'
      : registration.scope;

    if (!isExposedApiScope(requestedScope)) {
      throw new ExposedApiInvalidScopeError(requestedScope);
    }

    const policy = normalizePolicy(
      registration.policy === undefined ? {} : registration.policy,
    );

    const identityKey = scopeRecordIdentityKey(name, version);
    const existing = this.entries.get(identityKey);
    const persisted = this.scopes.get(identityKey);

    if (existing !== undefined) {
      const owner = existing[0];

      if (owner !== undefined && owner.tokenId !== token.id) {
        throw new ExposedApiNameCollisionError(name, owner.tokenId);
      }

      if (existing.some((entry) => entry.capability === registration.capability)) {
        throw new ExposedApiDuplicateCapabilityError(name, registration.capability);
      }
    }

    if (
      persisted !== undefined
      && exposedApiScopeRank(requestedScope) < exposedApiScopeRank(persisted.scope)
    ) {
      throw new ExposedApiScopeNarrowingError(
        name,
        String(version),
        persisted.scope,
        requestedScope,
      );
    }

    const effectiveScope = persisted !== undefined
      && exposedApiScopeRank(persisted.scope) > exposedApiScopeRank(requestedScope)
      ? persisted.scope
      : requestedScope;

    if (persisted === undefined || persisted.scope !== effectiveScope) {
      this.scopes.set(identityKey, { name, version, scope: effectiveScope });
      this.dirty = true;
    }

    if (existing !== undefined) {
      for (let index = 0; index < existing.length; index += 1) {
        const entry = existing[index] as ExposedApiEntry;

        if (entry.scope !== effectiveScope) {
          existing[index] = Object.freeze({ ...entry, scope: effectiveScope });
        }
      }
    }

    const entry: ExposedApiEntry = Object.freeze({
      name,
      version,
      scope: effectiveScope,
      policy,
      token: token as ServiceToken<unknown>,
      tokenId: token.id,
      capability: registration.capability,
      projection: registration.projection ?? identity,
      ...(registration.combine === undefined ? {} : { combine: registration.combine }),
    });

    if (existing === undefined) {
      this.entries.set(identityKey, [entry]);
    } else {
      existing.push(entry);
    }
  }

  resolve<T = unknown>(
    name: string,
    callerCapabilities: Iterable<string>,
    access?: ExposedApiAccessContext,
    version?: ExposedApiVersion,
  ): T | null {
    return this.resolveWithMetadata<T>(name, callerCapabilities, access, version)
      ?.handle ?? null;
  }

  resolveWithMetadata<T = unknown>(
    name: string,
    callerCapabilities: Iterable<string>,
    access?: ExposedApiAccessContext,
    version: ExposedApiVersion = 1,
  ): ExposedApiResolved<T> | null {
    if (this.disposed || !isExposedApiVersion(version)) {
      return null;
    }

    const identityKey = scopeRecordIdentityKey(name, version);
    const entries = this.entries.get(identityKey);

    if (entries === undefined) {
      return null;
    }

    const origin = deriveExposedApiOrigin(access);

    if (origin === null) {
      return null;
    }

    const declaredScope = this.scopes.get(identityKey)?.scope ?? entries[0]?.scope;

    if (declaredScope === undefined || !exposedApiScopeAllowsOrigin(declaredScope, origin)) {
      return null;
    }

    const capabilities = new Set(callerCapabilities);
    const matching = entries.filter(
      (entry) => entry.capability === '*' || capabilities.has(entry.capability),
    );

    if (matching.length === 0) {
      return null;
    }

    const accessContext: ServiceContext = access === undefined
      ? this.dependencies.callerContext
      : {
          callerId: access.callerId,
          tier: access.tier,
          options: { 'workspace.root': access.workspaceRoot },
          ...(access.partitionPrefix === undefined
            ? {}
            : { partitionPrefix: access.partitionPrefix }),
        };
    const callerWorkspaceRoot = accessContext.options['workspace.root'];

    const caller: ExposedApiCaller = {
      capabilities,
      official: access?.official === true,
      callerId: accessContext.callerId,
      subjectId: access?.subjectId ?? accessContext.callerId,
      workspaceRoot: typeof callerWorkspaceRoot === 'string' ? callerWorkspaceRoot : '',
    };

    const projections = matching.map((entry) => {
      const service = this.dependencies.broker.requestAccess(
        accessContext,
        entry.token,
      );

      return entry.projection(service, caller);
    });

    const handle = projections.length === 1
      ? projections[0]
      : combineMatching(matching, projections, caller);

    return Object.freeze({
      name,
      version,
      scope: declaredScope,
      policy: matching[0]?.policy ?? Object.freeze({}),
      policies: Object.freeze(matching.map((entry) => entry.policy)),
      handle: handle as T,
    });
  }

  scopeOf(name: string, version: ExposedApiVersion = 1): ExposedApiScope | null {
    if (!isExposedApiVersion(version)) {
      return null;
    }

    return this.scopes.get(scopeRecordIdentityKey(name, version))?.scope ?? null;
  }

  closeRegistration(): void {
    this.closed = true;
  }

  isRegistrationOpen(): boolean {
    return !this.closed && !this.disposed;
  }

  registeredApiNames(): readonly string[] {
    const names: string[] = [];

    for (const entries of this.entries.values()) {
      const name = entries[0]?.name;

      if (name !== undefined && !names.includes(name)) {
        names.push(name);
      }
    }

    return Object.freeze(names);
  }

  registeredApiIdentities(): readonly ExposedApiIdentity[] {
    const identities: ExposedApiIdentity[] = [];

    for (const entries of this.entries.values()) {
      const entry = entries[0];

      if (entry !== undefined) {
        identities.push(Object.freeze({ name: entry.name, version: entry.version }));
      }
    }

    return Object.freeze(identities);
  }

  /** Persists the exact in-memory scope record and verifies the written file. */
  #persist(): void {
    if (this.storagePath === undefined) {
      return;
    }

    if (this.protectedRecord) {
      releaseScopeRecordProtection(this.storagePath);
      this.protectedRecord = false;
    }

    try {
      persistScopeRecord(this.storagePath, [...this.scopes.values()]);

      // Read the document back so the file trusted on the next boot is the
      // file that was integrity-checked in this one.
      loadScopeRecord(this.storagePath);

      protectScopeRecord(this.storagePath);
      this.protectedRecord = true;
    } finally {
      if (!this.protectedRecord) {
        protectScopeRecord(this.storagePath);
        this.protectedRecord = true;
      }
    }
  }
}

/** Default projection: the service instance itself. */
function identity(service: unknown): unknown {
  return service;
}

/** Combines matching projections using the first supplied combiner. */
function combineMatching(
  matching: readonly ExposedApiEntry[],
  projections: readonly unknown[],
  caller: ExposedApiCaller,
): unknown {
  const combine = matching.find(
    (entry) => entry.combine !== undefined,
  )?.combine ?? combineDefault;

  return combine(projections, caller);
}

/**
 * Default combiner.
 *
 * Plain records merge shallowly. Anything else falls back to the last
 * matching projection so class instances keep their prototypes.
 */
function combineDefault(
  projections: readonly unknown[],
): unknown {
  if (projections.length === 0) {
    return null;
  }

  if (projections.every(isPlainRecord)) {
    return Object.freeze(Object.assign({}, ...projections));
  }

  return projections[projections.length - 1];
}

/** Whether a value is a plain object record. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}