import type {
  KernelCallAuthority,
  KernelCallContext,
} from '../../../src/contracts/callChain.js';
import type { IServiceLifecycle } from '../../../src/contracts/lifecycle.js';
import type { ExposureDeclaration } from '../../../src/contracts/manifest.js';
import {
  ExposedApiDisposedError,
  ExposedApiDuplicateExposureError,
  ExposedApiInvalidNameError,
  ExposedApiInvalidScopeError,
  ExposedApiInvalidVersionError,
  ExposedApiNameCollisionError,
  ExposedApiNotAttachedError,
  ExposedApiOwnerPinError,
  ExposedApiRegistrationClosedError,
  ExposedApiScopeNarrowingError,
  ExposedApiUnavailableError,
} from '../contracts/errors.js';
import type {
  IExposedApiAdmission,
  IExposedApiRegistry,
} from '../contracts/IExposedApiRegistry.js';
import {
  evaluateExposedApiPolicy,
  parseExposedApiPolicy,
  type ExposedApiPolicy,
} from '../contracts/policy.js';
import { isExposureProvider } from '../contracts/registrant.js';
import {
  EXPOSED_API_NAME_PATTERN,
  exposedApiMajor,
  exposedApiScopeRank,
  isExposedApiScope,
  isExposedApiVersion,
  type ExposedApiBinding,
  type ExposedApiCaller,
  type ExposedApiResolveOptions,
  type ExposedApiScope,
} from '../contracts/types.js';
import { ExposedApiRegistryToken } from '../descriptor/tokens.js';
import {
  EXPOSED_API_SCOPE_RECORD_MAX_NAME_LENGTH,
  loadScopeRecord,
  persistScopeRecord,
  protectScopeRecord,
  releaseScopeRecordProtection,
  scopeRecordIdentityKey,
  type ScopeRecordEntry,
} from '../storage/scopeRecord.js';

/** API names accept dotted, kebab, and snake segments. */
export { EXPOSED_API_NAME_PATTERN };

/** Collaborators injected into {@link ExposedApiRegistryService}. */
export interface ExposedApiRegistryDependencies {
  /**
   * Absolute path to the protected per-composition scope record.
   *
   * When omitted, scope is tracked in memory for the lifetime of the service.
   */
  readonly scopeRecordPath?: string;
}

/** One registered exposure. */
interface ExposureEntry {
  readonly name: string;
  readonly major: number;
  readonly scope: ExposedApiScope;
  readonly policy: ExposedApiPolicy;
  readonly owner: string;
}

/** Source name the registry uses on the kernel's observation stream. */
const OBSERVATION_SOURCE = ExposedApiRegistryToken.id;

/** Default projection: the giver's instance itself. */
function identityProjection(service: unknown): unknown {
  return service;
}

/** Builds the caller view a projection receives. */
function callerView(context: KernelCallContext): ExposedApiCaller {
  return Object.freeze({
    identity: context.caller.identity,
    callerClass: context.caller.callerClass,
    official: context.caller.official,
    capabilities: context.caller.capabilities,
    origin: context.origin,
  });
}

/**
 * The resolution primitive.
 *
 * Holds no participant name, no participant token, no caller identifier, no
 * caller list, and no policy of its own. It stores what each participant's
 * manifest declares, keyed by the owner's kernel-issued identity, and
 * evaluates each giver's declared Layer 1 policy against the kernel-provided
 * execution context.
 */
export class ExposedApiRegistryService
implements IExposedApiRegistry, IExposedApiAdmission, IServiceLifecycle {
  readonly #entries = new Map<string, ExposureEntry>();

  readonly #owners = new Map<string, string>();

  readonly #bindings = new Map<string, ExposedApiBinding>();

  readonly #scopes = new Map<string, ScopeRecordEntry>();

  readonly #storagePath: string | undefined;

  #authority: KernelCallAuthority | undefined;

  #pins: Readonly<Record<string, string>> = Object.freeze({});

  #sealed = false;

  #disposed = false;

  #initialized = false;

  #protectedRecord = false;

  #dirty = false;

  /** The only view a participant receives: `resolve`. */
  readonly publicView: IExposedApiRegistry;

  constructor(dependencies: ExposedApiRegistryDependencies = {}) {
    this.#storagePath = dependencies.scopeRecordPath;
    this.publicView = Object.freeze({
      resolve: <T = unknown>(name: string, options?: ExposedApiResolveOptions): T | null =>
        this.resolve<T>(name, options),
    });
  }

  /**
   * Loads and integrity-checks the protected scope record.
   *
   * A missing record is the legitimate first-registration case. A corrupt
   * record refuses boot. An existing record is made read-only for the runtime.
   */
  async initialize(): Promise<void> {
    if (this.#initialized) {
      return;
    }

    this.#initialized = true;

    if (this.#storagePath === undefined) {
      return;
    }

    const loaded = loadScopeRecord(this.#storagePath);

    if (loaded !== undefined) {
      for (const record of loaded) {
        this.#scopes.set(scopeRecordIdentityKey(record.name, record.version), record);
      }

      protectScopeRecord(this.#storagePath);
      this.#protectedRecord = true;
    }
  }

  /** Seals the window and persists the final scope record. */
  async onRunning(): Promise<void> {
    this.seal();

    if (this.#storagePath !== undefined && this.#dirty) {
      this.#persist();
    }
  }

  /** Releases the protected-path claim and forgets every exposure. */
  async dispose(): Promise<void> {
    if (this.#storagePath !== undefined && this.#protectedRecord) {
      releaseScopeRecordProtection(this.#storagePath);
      this.#protectedRecord = false;
    }

    this.#disposed = true;
    this.#sealed = true;
    this.#entries.clear();
    this.#owners.clear();
    this.#bindings.clear();
  }

  /** Whether {@link dispose} has run. */
  get isDisposed(): boolean {
    return this.#disposed;
  }

  /** Whether the registration window is sealed. */
  get isSealed(): boolean {
    return this.#sealed;
  }

  /** Absolute scope-record path, when persistence is configured. */
  get scopeRecordPath(): string | undefined {
    return this.#storagePath;
  }

  /**
   * Attaches the kernel's call authority and the composition's name pins.
   *
   * Called once by the kernel, during admission, before any registration.
   *
   * @param authority - The kernel's call authority.
   * @param ownerPins - Exposure names pinned to an owner identity.
   */
  attachKernel(
    authority: KernelCallAuthority,
    ownerPins: Readonly<Record<string, string>>,
  ): void {
    if (this.#disposed) {
      throw new ExposedApiDisposedError();
    }

    if (this.#sealed || this.#authority !== undefined) {
      throw new ExposedApiRegistrationClosedError('kernel attachment');
    }

    this.#authority = authority;
    this.#pins = Object.freeze({ ...ownerPins });
  }

  register(owner: string, declaration: ExposureDeclaration): void {
    const name = typeof declaration?.name === 'string' ? declaration.name : String(declaration?.name);

    if (this.#disposed) {
      throw new ExposedApiDisposedError();
    }

    if (this.#sealed) {
      throw new ExposedApiRegistrationClosedError(name);
    }

    if (this.#authority === undefined) {
      throw new ExposedApiNotAttachedError();
    }

    if (
      typeof declaration?.name !== 'string'
      || declaration.name.length > EXPOSED_API_SCOPE_RECORD_MAX_NAME_LENGTH
      || !EXPOSED_API_NAME_PATTERN.test(declaration.name)
    ) {
      throw new ExposedApiInvalidNameError(name);
    }

    if (typeof owner !== 'string' || owner.length === 0) {
      throw new ExposedApiNotAttachedError();
    }

    const version = declaration.version ?? 1;

    if (!isExposedApiVersion(version)) {
      throw new ExposedApiInvalidVersionError(version);
    }

    const major = exposedApiMajor(version);
    const requestedScope = declaration.scope ?? 'kernel';

    if (!isExposedApiScope(requestedScope)) {
      throw new ExposedApiInvalidScopeError(requestedScope);
    }

    const policy = parseExposedApiPolicy(declaration.policy);
    const pinned = this.#pins[name];

    if (pinned !== undefined && pinned !== owner) {
      throw new ExposedApiOwnerPinError(name);
    }

    const nameOwner = this.#owners.get(name);

    if (nameOwner !== undefined && nameOwner !== owner) {
      throw new ExposedApiNameCollisionError(name, nameOwner);
    }

    const key = scopeRecordIdentityKey(name, major);

    if (this.#entries.has(key)) {
      throw new ExposedApiDuplicateExposureError(name, major);
    }

    const persisted = this.#scopes.get(key);

    if (
      persisted !== undefined
      && exposedApiScopeRank(requestedScope) < exposedApiScopeRank(persisted.scope)
    ) {
      throw new ExposedApiScopeNarrowingError(
        name,
        String(major),
        persisted.scope,
        requestedScope,
      );
    }

    if (persisted === undefined || persisted.scope !== requestedScope) {
      this.#scopes.set(key, { name, version: major, scope: requestedScope });
      this.#dirty = true;
    }

    this.#entries.set(key, Object.freeze({ name, major, scope: requestedScope, policy, owner }));
    this.#owners.set(name, owner);
  }

  /** Seals the registration window. Idempotent. Kernel-only. */
  seal(): void {
    this.#sealed = true;
  }

  resolve<T = unknown>(name: string, options?: ExposedApiResolveOptions): T | null {
    const authority = this.#authority;
    const context = authority?.current();

    if (authority === undefined || context === undefined || this.#disposed) {
      return this.#refuse(authority, undefined, 'resolve-refused', {
        name: typeof name === 'string' ? name : null,
        reason: 'no kernel call context',
      });
    }

    const expectedOwner = options?.expectedOwner;
    const requestBytes = Buffer.byteLength(String(name), 'utf8')
      + Buffer.byteLength(typeof expectedOwner === 'string' ? expectedOwner : '', 'utf8')
      + Buffer.byteLength(String(options?.version ?? ''), 'utf8');

    if (!authority.admitCall(context.caller, requestBytes)) {
      return this.#refuse(authority, context, 'resolve-refused', {
        name: String(name),
        reason: 'call or size limit exceeded',
      });
    }

    const version = options?.version ?? 1;

    if (typeof name !== 'string' || !isExposedApiVersion(version)) {
      return this.#refuse(authority, context, 'resolve-refused', {
        name: String(name),
        reason: 'malformed request',
      });
    }

    const entry = this.#entries.get(scopeRecordIdentityKey(name, exposedApiMajor(version)));

    if (entry === undefined) {
      return this.#refuse(authority, context, 'resolve-refused', {
        name,
        reason: 'no such exposure',
      });
    }

    if (!authority.isLive(entry.owner)) {
      return this.#refuse(authority, context, 'resolve-refused', {
        name,
        reason: 'owner identity is not live',
      });
    }

    if (expectedOwner !== undefined && expectedOwner !== entry.owner) {
      return this.#refuse(authority, context, 'resolve-refused', {
        name,
        reason: 'owner differs from the expected owner',
      });
    }

    const decision = evaluateExposedApiPolicy(entry.policy, entry.scope, context);

    if (!decision.allowed) {
      return this.#refuse(authority, context, 'resolve-refused', {
        name,
        reason: decision.reason,
      });
    }

    const binding = this.#bind(authority, entry);

    if (binding === undefined) {
      return this.#refuse(authority, context, 'resolve-refused', {
        name,
        reason: 'owner code does not provide the declared exposure',
      });
    }

    const instance = authority.instanceOf(entry.owner);
    const projection = binding.projection ?? identityProjection;
    const value = authority.runAs(entry.owner, () => projection(instance, callerView(context)));

    return this.#handle(authority, entry, value) as T;
  }

  /** Records a refusal on the observation stream and returns the uniform refusal. */
  #refuse(
    authority: KernelCallAuthority | undefined,
    context: KernelCallContext | undefined,
    event: string,
    detail: Readonly<Record<string, unknown>>,
  ): null {
    authority?.observe(OBSERVATION_SOURCE, event, {
      ...detail,
      callerIdentity: context?.caller.identity ?? null,
      callerClass: context?.caller.callerClass ?? null,
      origin: context?.origin ?? null,
    });

    return null;
  }

  /**
   * Binds one declared exposure to its owner's code, on first use.
   *
   * When the owner's code does not provide a declared exposure, the call fails
   * and the mismatch is recorded. Code cannot bind an undeclared exposure,
   * because only declared exposures are ever looked up.
   */
  #bind(authority: KernelCallAuthority, entry: ExposureEntry): ExposedApiBinding | undefined {
    const key = scopeRecordIdentityKey(entry.name, entry.major);
    const cached = this.#bindings.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const instance = authority.instanceOf(entry.owner);
    const binding = isExposureProvider(instance)
      ? authority.runAs(entry.owner, () => instance.provideExposure(entry.name, entry.major))
      : undefined;

    if (
      binding === undefined
      || binding === null
      || typeof binding !== 'object'
      || (binding.projection !== undefined && typeof binding.projection !== 'function')
    ) {
      authority.observe(OBSERVATION_SOURCE, 'exposure-binding-mismatch', {
        name: entry.name,
        major: entry.major,
        owner: entry.owner,
      });

      return undefined;
    }

    const frozen: ExposedApiBinding = Object.freeze({ ...binding });
    this.#bindings.set(key, frozen);

    return frozen;
  }

  /**
   * Wraps a projected value in a handle that is a reference, not a grant.
   *
   * Every use of the handle evaluates Layer 1 again against the root origin of
   * the chain using it, and runs the giver's code as the giver. Primitive
   * values are data, not references, and are returned as they are.
   */
  #handle(authority: KernelCallAuthority, entry: ExposureEntry, value: unknown): unknown {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
      return value;
    }

    const real = value as object;

    const authorize = (): void => {
      const context = authority.current();
      const reason = context === undefined
        ? 'no kernel call context'
        : !authority.admitCall(context.caller, 0)
          ? 'call or size limit exceeded'
          : !authority.isLive(entry.owner)
            ? 'owner identity is not live'
            : ((): string | undefined => {
                const decision = evaluateExposedApiPolicy(entry.policy, entry.scope, context);

                return decision.allowed ? undefined : decision.reason;
              })();

      if (reason !== undefined) {
        authority.observe(OBSERVATION_SOURCE, 'invoke-refused', {
          name: entry.name,
          major: entry.major,
          reason,
          callerIdentity: context?.caller.identity ?? null,
          callerClass: context?.caller.callerClass ?? null,
          origin: context?.origin ?? null,
        });

        throw new ExposedApiUnavailableError();
      }
    };

    const invoke = (fn: (...args: unknown[]) => unknown, thisArg: unknown, args: unknown[]): unknown => {
      authorize();

      return authority.runAs(entry.owner, () => Reflect.apply(fn, thisArg, args));
    };

    // The proxy target is an empty, extensible stand-in so the handle can wrap
    // frozen projections without breaking proxy invariants.
    const target = typeof real === 'function'
      ? ((): void => undefined) as unknown as object
      : {};

    return new Proxy(target, {
      get: (_target, property): unknown => {
        authorize();

        const member = Reflect.get(real, property, real) as unknown;

        return typeof member === 'function'
          ? (...args: unknown[]): unknown =>
              invoke(member as (...args: unknown[]) => unknown, real, args)
          : member;
      },
      apply: (_target, thisArg, args: unknown[]): unknown =>
        invoke(real as (...args: unknown[]) => unknown, thisArg, args),
      has: (_target, property): boolean => {
        authorize();

        return Reflect.has(real, property);
      },
      ownKeys: (): (string | symbol)[] => {
        authorize();

        return Reflect.ownKeys(real);
      },
      getOwnPropertyDescriptor: (_target, property): PropertyDescriptor | undefined => {
        authorize();

        const descriptor = Reflect.getOwnPropertyDescriptor(real, property);

        return descriptor === undefined ? undefined : { ...descriptor, configurable: true };
      },
      getPrototypeOf: (): object | null => Reflect.getPrototypeOf(real),
      set: (): boolean => false,
      defineProperty: (): boolean => false,
      deleteProperty: (): boolean => false,
      setPrototypeOf: (): boolean => false,
      preventExtensions: (): boolean => false,
    });
  }

  /** Persists the exact in-memory scope record and verifies the written file. */
  #persist(): void {
    if (this.#storagePath === undefined) {
      return;
    }

    if (this.#protectedRecord) {
      releaseScopeRecordProtection(this.#storagePath);
      this.#protectedRecord = false;
    }

    try {
      persistScopeRecord(this.#storagePath, [...this.#scopes.values()]);

      // Read the document back so the file trusted on the next boot is the
      // file that was integrity-checked in this one.
      loadScopeRecord(this.#storagePath);

      protectScopeRecord(this.#storagePath);
      this.#protectedRecord = true;
    } finally {
      if (!this.#protectedRecord) {
        protectScopeRecord(this.#storagePath);
        this.#protectedRecord = true;
      }
    }
  }
}
