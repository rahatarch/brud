import type { KernelServiceModuleContext } from '../../bootstrap/bootTypes.js';
import { createServiceToken } from '../../contracts/serviceToken.js';
import type { IServiceLifecycle } from '../../contracts/lifecycle.js';
import type {
  IdentityRecord,
  IIdentityRegistry,
} from '../../../services/IdentityRegistry/contracts/types.js';
import { IdentityRegistryToken } from '../../../services/IdentityRegistry/descriptor/tokens.js';
import { IDENTITY_REGISTRY_SLOT } from '../../../services/IdentityRegistry/serviceModule.js';

/** One binding a boot issuer asks the registry to record. */
export interface IdentityBootIssueSpec {
  /** Test-local key used to look up the resulting token. */
  readonly key: string;

  /** Opaque publisher supplied to `issue`. */
  readonly publisher: string;

  /** Opaque content hash supplied to `issue`. */
  readonly contentHash: string;

  /** Opaque metadata supplied to `issue`. */
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** Script the boot issuer runs during `initialize`. */
export interface IdentityBootIssuerScript {
  /** Bindings to issue, in order. */
  readonly issue?: readonly IdentityBootIssueSpec[];

  /** Keys from `issue` to retire after issuing. */
  readonly retireKeys?: readonly string[];

  /** Keys from `issue` to revoke after issuing. */
  readonly revokeKeys?: readonly string[];

  /** Token values persisted by a previous boot to retire. */
  readonly retireTokens?: readonly string[];

  /** Token values persisted by a previous boot to revoke. */
  readonly revokeTokens?: readonly string[];
}

/** One operation outcome recorded by the fixture. */
export interface IdentityBootOutcome {
  readonly operation: 'issue' | 'retire' | 'revoke';
  readonly key?: string;
  readonly token?: string;
  readonly record?: IdentityRecord;
  readonly errorName?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

/** Read-only surface the test resolves after boot. */
export interface IIdentityBootIssuerProbe {
  /** Key-to-token map for successful issues. */
  tokens(): Readonly<Record<string, string>>;

  /** Every operation outcome in execution order. */
  outcomes(): readonly IdentityBootOutcome[];
}

/** Service token for the test-only boot issuer. */
export const IDENTITY_BOOT_ISSUER_TOKEN = createServiceToken<IIdentityBootIssuerProbe>(
  'test.identity.bootIssuer',
  'Boot-time identity registry issuer fixture',
);

/** Shared slot used only when a test wants to inspect the fixture instance. */
export const IDENTITY_BOOT_ISSUER_SLOT = 'test.identity.bootIssuer.instance';

/** Records the error shape without leaking a stack trace. */
function describeError(error: unknown): {
  readonly errorName: string;
  readonly errorCode?: string;
  readonly errorMessage: string;
} {
  if (error instanceof Error) {
    const code = (error as Error & { readonly code?: unknown }).code;

    return {
      errorName: error.name,
      ...(typeof code === 'string' ? { errorCode: code } : {}),
      errorMessage: error.message,
    };
  }

  return {
    errorName: 'UnknownError',
    errorMessage: String(error),
  };
}

/** Boot-time issuer over the real registry instance. */
class IdentityBootIssuer implements IIdentityBootIssuerProbe, IServiceLifecycle {
  readonly #registry: IIdentityRegistry;
  readonly #script: IdentityBootIssuerScript;
  readonly #tokens = new Map<string, string>();
  readonly #outcomes: IdentityBootOutcome[] = [];

  constructor(registry: IIdentityRegistry, script: IdentityBootIssuerScript) {
    this.#registry = registry;
    this.#script = script;
  }

  public initialize(): void {
    for (const spec of this.#script.issue ?? []) {
      this.#issue(spec);
    }

    for (const key of this.#script.retireKeys ?? []) {
      this.#retire(key, this.#tokens.get(key));
    }

    for (const key of this.#script.revokeKeys ?? []) {
      this.#revoke(key, this.#tokens.get(key));
    }

    for (const token of this.#script.retireTokens ?? []) {
      this.#retire(undefined, token);
    }

    for (const token of this.#script.revokeTokens ?? []) {
      this.#revoke(undefined, token);
    }
  }

  public dispose(): void {
    // Nothing to release: the registry owns the storage lifecycle.
  }

  public tokens(): Readonly<Record<string, string>> {
    return Object.fromEntries(this.#tokens);
  }

  public outcomes(): readonly IdentityBootOutcome[] {
    return this.#outcomes.map((outcome) => Object.freeze({ ...outcome }));
  }

  #issue(spec: IdentityBootIssueSpec): void {
    try {
      const record = this.#registry.issue({
        publisher: spec.publisher,
        contentHash: spec.contentHash,
        metadata: spec.metadata,
      });

      this.#tokens.set(spec.key, record.token);
      this.#outcomes.push(Object.freeze({
        operation: 'issue',
        key: spec.key,
        token: record.token,
        record,
      }));
    } catch (error: unknown) {
      this.#outcomes.push(Object.freeze({
        operation: 'issue',
        key: spec.key,
        ...describeError(error),
      }));
    }
  }

  #retire(key: string | undefined, token: string | undefined): void {
    if (token === undefined) {
      this.#outcomes.push(Object.freeze({
        operation: 'retire',
        ...(key === undefined ? {} : { key }),
        errorName: 'MissingToken',
        errorMessage: 'No token was captured for this retire operation',
      }));

      return;
    }

    try {
      const record = this.#registry.retire(token);

      this.#outcomes.push(Object.freeze({
        operation: 'retire',
        ...(key === undefined ? {} : { key }),
        token,
        record,
      }));
    } catch (error: unknown) {
      this.#outcomes.push(Object.freeze({
        operation: 'retire',
        ...(key === undefined ? {} : { key }),
        token,
        ...describeError(error),
      }));
    }
  }

  #revoke(key: string | undefined, token: string | undefined): void {
    if (token === undefined) {
      this.#outcomes.push(Object.freeze({
        operation: 'revoke',
        ...(key === undefined ? {} : { key }),
        errorName: 'MissingToken',
        errorMessage: 'No token was captured for this revoke operation',
      }));

      return;
    }

    try {
      const record = this.#registry.revoke(token);

      this.#outcomes.push(Object.freeze({
        operation: 'revoke',
        ...(key === undefined ? {} : { key }),
        token,
        record,
      }));
    } catch (error: unknown) {
      this.#outcomes.push(Object.freeze({
        operation: 'revoke',
        ...(key === undefined ? {} : { key }),
        token,
        ...describeError(error),
      }));
    }
  }
}

/**
 * Composes the real boot issuer through the standard config mechanism.
 *
 * The module depends on the real identity registry token, reads the registry
 * from the shared bag in its factory, and runs the scripted operations during
 * `initialize`, which is the kernel's boot window.
 */
export function createService(context: KernelServiceModuleContext) {
  return {
    token: IDENTITY_BOOT_ISSUER_TOKEN,
    tier: 'core' as const,
    dependencies: [IdentityRegistryToken],
    factory: () => {
      const registry = context.shared[IDENTITY_REGISTRY_SLOT] as
        | IIdentityRegistry
        | undefined;

      if (registry === undefined) {
        throw new Error(
          'The identity registry must be constructed before the boot issuer',
        );
      }

      const script = (context.options['identity.fixture'] ?? {}) as IdentityBootIssuerScript;
      const issuer = new IdentityBootIssuer(registry, script);
      context.shared[IDENTITY_BOOT_ISSUER_SLOT] = issuer;

      return issuer;
    },
  };
}