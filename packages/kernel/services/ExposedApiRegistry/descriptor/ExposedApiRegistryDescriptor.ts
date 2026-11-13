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

/** Methods declared for the Registry interface. */
export const EXPOSED_API_REGISTRY_CONTRACT_METHODS = [
  'registerApi',
  'resolve',
  'resolveWithMetadata',
  'scopeOf',
  'closeRegistration',
  'isRegistrationOpen',
  'registeredApiNames',
  'registeredApiIdentities',
] as const;

/**
 * Optional context field holding the absolute protected scope-record path.
 *
 * Hosts that need cross-boot scope persistence supply this path. When it is
 * absent the registry keeps the scope record in memory for one boot.
 */
export const EXPOSED_API_SCOPE_RECORD_PATH_FIELD = 'exposedApi.scopeRecord.path';

/** Configuration for {@link createExposedApiRegistryDescriptor}. */
export interface ExposedApiRegistryDescriptorOptions {
  /** Absolute scope-record path used instead of the context field. */
  readonly scopeRecordPath?: string;

  /** Observation hook used by the standard composition. */
  readonly onConstruct?: (service: ExposedApiRegistryService) => void;
}

/** Reads an optional non-empty string from the context bag. */
function optionalContextString(
  options: Readonly<Record<string, unknown>>,
  field: string,
): string | undefined {
  const value = options[field];

  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Builds the `brud.core.exposedApiRegistry` descriptor.
 *
 * The Registry has no service dependencies. Every service declares its
 * exposures during the standard kernel's boot pinner, while the broker gate is
 * suspended and before `RUNNING`.
 *
 * @param options - Construction observation hook and storage override.
 */
export function createExposedApiRegistryDescriptor(
  options?: ExposedApiRegistryDescriptorOptions,
): ServiceDescriptor<IExposedApiRegistry, ExposedApiRegistryService> {
  return {
    token: ExposedApiRegistryToken,
    tier: EXPOSED_API_REGISTRY_SERVICE_TIER,
    dependencies: [],
    accessPolicy: {
      allowedCallers: ['kernel', 'PluginManager', 'brud.host.daemon'],
    },
    contract: {
      version: EXPOSED_API_REGISTRY_CONTRACT_VERSION,
      methods: EXPOSED_API_REGISTRY_CONTRACT_METHODS,
    },
    factory: (context, broker): ExposedApiRegistryService => {
      const scopeRecordPath = options?.scopeRecordPath
        ?? optionalContextString(context.options, EXPOSED_API_SCOPE_RECORD_PATH_FIELD);
      const service = new ExposedApiRegistryService({
        broker,
        callerContext: {
          callerId: ExposedApiRegistryToken.id,
          tier: 'core',
          options: context.options,
        },
        ...(scopeRecordPath === undefined ? {} : { scopeRecordPath }),
      });

      options?.onConstruct?.(service);

      return service;
    },
  };
}

/** Standard Registry descriptor with no overrides. */
export const ExposedApiRegistryDescriptor: ServiceDescriptor<
  IExposedApiRegistry,
  ExposedApiRegistryService
> = createExposedApiRegistryDescriptor();