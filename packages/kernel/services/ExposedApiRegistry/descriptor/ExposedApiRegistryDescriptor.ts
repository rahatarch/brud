import type { ServiceTier } from '../../../src/contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../../src/contracts/serviceDescriptor.js';
import type { IExposedApiRegistry } from '../contracts/IExposedApiRegistry.js';
import { ExposedApiRegistryService } from '../orchestrator/index.js';
import { ExposedApiRegistryToken } from './tokens.js';

/** Tier assigned to the Registry descriptor. */
export const EXPOSED_API_REGISTRY_SERVICE_TIER: ServiceTier = 'core';

/** Configuration for {@link createExposedApiRegistryDescriptor}. */
export interface ExposedApiRegistryDescriptorOptions {
  /** Observation hook used by the standard composition. */
  readonly onConstruct?: (service: ExposedApiRegistryService) => void;
}

/**
 * Builds the `brud.core.exposedApiRegistry` descriptor.
 *
 * The Registry has no service dependencies. Every service declares its
 * exposures during the standard kernel's boot pinner, while the broker gate is
 * suspended and before `RUNNING`.
 *
 * @param options - Construction observation hook.
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
    factory: (context, broker): ExposedApiRegistryService => {
      const service = new ExposedApiRegistryService({
        broker,
        callerContext: {
          callerId: ExposedApiRegistryToken.id,
          tier: 'core',
          workspaceRoot: context.workspaceRoot,
        },
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