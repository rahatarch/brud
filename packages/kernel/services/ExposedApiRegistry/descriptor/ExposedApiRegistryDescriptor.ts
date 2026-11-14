import type { ServiceTier } from '../../../src/contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../../src/contracts/serviceDescriptor.js';
import type { IExposedApiRegistry } from '../contracts/IExposedApiRegistry.js';
import { ExposedApiRegistryService } from '../orchestrator/index.js';
import { ExposedApiRegistryToken } from './tokens.js';

/** Tier assigned to the Registry descriptor. */
export const EXPOSED_API_REGISTRY_SERVICE_TIER: ServiceTier = 'core';

/** Namespace owned by the registry in the context contract. */
export const EXPOSED_API_REGISTRY_CONTEXT_SCOPE = 'exposedApi';

/** Contract version declared for the Registry interface. */
export const EXPOSED_API_REGISTRY_CONTRACT_VERSION = '1.0.0';

/**
 * Methods declared for the Registry interface.
 *
 * `resolve` is open to every participant. `register` is kernel-only: the
 * kernel calls it during admission, and it is never part of the view a
 * participant receives.
 */
export const EXPOSED_API_REGISTRY_CONTRACT_METHODS = ['register', 'resolve'] as const;

/**
 * Optional context field holding the absolute protected scope-record path.
 *
 * This is the registry's own field, declared in its own namespace. Hosts that
 * need cross-boot scope persistence supply it. When it is absent the registry
 * keeps the scope record in memory for one boot.
 */
export const EXPOSED_API_SCOPE_RECORD_PATH_FIELD = 'exposedApi.scopeRecord.path';

/** Configuration for {@link createExposedApiRegistryDescriptor}. */
export interface ExposedApiRegistryDescriptorOptions {
  /** Absolute scope-record path used instead of the context field. */
  readonly scopeRecordPath?: string;
}

/** Reads an optional non-empty string from the registry's own context field. */
function optionalContextString(
  options: Readonly<Record<string, unknown>>,
  field: string,
): string | undefined {
  const value = options[field];

  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Builds the resolution primitive's descriptor.
 *
 * The descriptor carries no caller list and no access policy of its own:
 * `resolve` is open to every participant, and the projection hands every
 * caller only `resolve`. Registration is reachable only by the kernel, which
 * holds the instance during admission.
 *
 * @param options - Storage override.
 */
export function createExposedApiRegistryDescriptor(
  options?: ExposedApiRegistryDescriptorOptions,
): ServiceDescriptor<IExposedApiRegistry, ExposedApiRegistryService> {
  return {
    token: ExposedApiRegistryToken,
    tier: EXPOSED_API_REGISTRY_SERVICE_TIER,
    dependencies: [],
    contract: {
      version: EXPOSED_API_REGISTRY_CONTRACT_VERSION,
      methods: EXPOSED_API_REGISTRY_CONTRACT_METHODS,
    },
    factory: (context): ExposedApiRegistryService => {
      const scopeRecordPath = options?.scopeRecordPath
        ?? optionalContextString(context.options, EXPOSED_API_SCOPE_RECORD_PATH_FIELD);

      return new ExposedApiRegistryService(
        scopeRecordPath === undefined ? {} : { scopeRecordPath },
      );
    },
    project: (instance): IExposedApiRegistry => instance.publicView,
  };
}

/** Standard Registry descriptor with no overrides. */
export const ExposedApiRegistryDescriptor: ServiceDescriptor<
  IExposedApiRegistry,
  ExposedApiRegistryService
> = createExposedApiRegistryDescriptor();
