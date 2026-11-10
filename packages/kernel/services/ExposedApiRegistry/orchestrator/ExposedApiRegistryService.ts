import type { IKernelAccessBroker } from '../../../src/contracts/accessBroker.js';
import {
  isCapabilityToken,
  isPublicApiCapability,
} from '../../../src/contracts/capability.js';
import type { IServiceLifecycle, ServiceContext } from '../../../src/contracts/lifecycle.js';
import type { ServiceToken } from '../../../src/contracts/serviceToken.js';
import {
  ExposedApiDisposedError,
  ExposedApiDuplicateCapabilityError,
  ExposedApiInvalidCapabilityError,
  ExposedApiInvalidNameError,
  ExposedApiNameCollisionError,
  ExposedApiRegistrationClosedError,
  ExposedApiUnknownServiceError,
} from '../contracts/errors.js';
import type { IExposedApiRegistry } from '../contracts/IExposedApiRegistry.js';
import type {
  ExposedApiAccessContext,
  ExposedApiCaller,
  ExposedApiEntry,
  ExposedApiRegistration,
} from '../contracts/types.js';

/** API names accept dotted, kebab, and snake segments. */
export const EXPOSED_API_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;

/** Collaborators injected into {@link ExposedApiRegistryService}. */
export interface ExposedApiRegistryDependencies {
  /** Mediated access used to resolve each registered token. */
  readonly broker: IKernelAccessBroker;

  /** Registry identity used when a caller supplies no access context. */
  readonly callerContext: ServiceContext;
}

/**
 * Dumb store for service-declared exposures.
 *
 * It does not interpret capabilities, projections, or merge semantics beyond
 * invoking what the declaring service supplied. Access authority remains with
 * the access broker and each service's descriptor.
 */
export class ExposedApiRegistryService implements IExposedApiRegistry, IServiceLifecycle {
  private readonly entries = new Map<string, ExposedApiEntry[]>();

  private readonly dependencies: ExposedApiRegistryDependencies;

  private closed = false;

  private disposed = false;

  constructor(dependencies: ExposedApiRegistryDependencies) {
    this.dependencies = dependencies;
  }

  /** Lifecycle no-op: registrations arrive from the boot pinner. */
  async initialize(): Promise<void> {
    return undefined;
  }

  /** Seals the window even when no boot pinner ran. */
  async onRunning(): Promise<void> {
    this.closeRegistration();
  }

  /** Clears every exposure and refuses later registration. */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.closed = true;
    this.entries.clear();
  }

  /** Whether {@link dispose} has run. */
  get isDisposed(): boolean {
    return this.disposed;
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

    const existing = this.entries.get(name);

    if (existing !== undefined) {
      const owner = existing[0];

      if (owner !== undefined && owner.tokenId !== token.id) {
        throw new ExposedApiNameCollisionError(name, owner.tokenId);
      }

      if (existing.some((entry) => entry.capability === registration.capability)) {
        throw new ExposedApiDuplicateCapabilityError(name, registration.capability);
      }
    }

    const entry: ExposedApiEntry = {
      name,
      token: token as ServiceToken<unknown>,
      tokenId: token.id,
      capability: registration.capability,
      projection: registration.projection ?? identity,
      ...(registration.combine === undefined ? {} : { combine: registration.combine }),
    };

    if (existing === undefined) {
      this.entries.set(name, [entry]);
    } else {
      existing.push(entry);
    }
  }

  resolve<T = unknown>(
    name: string,
    callerCapabilities: Iterable<string>,
    access?: ExposedApiAccessContext,
  ): T | null {
    if (this.disposed) {
      return null;
    }

    const entries = this.entries.get(name);

    if (entries === undefined) {
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
          workspaceRoot: access.workspaceRoot,
          ...(access.partitionPrefix === undefined
            ? {}
            : { partitionPrefix: access.partitionPrefix }),
        };

    const caller: ExposedApiCaller = {
      capabilities,
      official: access?.official === true,
      callerId: accessContext.callerId,
      subjectId: access?.subjectId ?? accessContext.callerId,
      workspaceRoot: accessContext.workspaceRoot,
    };

    const projections = matching.map((entry) => {
      const service = this.dependencies.broker.requestAccess(
        accessContext,
        entry.token,
      );

      return entry.projection(service, caller);
    });

    if (projections.length === 1) {
      return projections[0] as T;
    }

    const combine = matching.find(
      (entry) => entry.combine !== undefined,
    )?.combine ?? combineDefault;

    return combine(projections, caller) as T;
  }

  closeRegistration(): void {
    this.closed = true;
  }

  isRegistrationOpen(): boolean {
    return !this.closed && !this.disposed;
  }

  registeredApiNames(): readonly string[] {
    return Object.freeze(Array.from(this.entries.keys()));
  }
}

/** Default projection: the service instance itself. */
function identity(service: unknown): unknown {
  return service;
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
