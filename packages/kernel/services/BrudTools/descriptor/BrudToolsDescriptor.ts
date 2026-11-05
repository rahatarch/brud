import type { ServiceTier } from '../../../src/contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../../src/contracts/serviceDescriptor.js';
import type { IPluginLogger } from '../../PluginManager/contracts/IPluginContext.js';
import type { IBrudToolsService } from '../contracts/IBrudToolsService.js';
import {
  BrudToolsService,
  type BrudToolsDependencies,
} from '../orchestrator/index.js';
import { BrudToolsToken } from './tokens.js';

/** Tier assigned to the BrudTools descriptor. */
export const BRUD_TOOLS_SERVICE_TIER: ServiceTier = 'core';

/** Configuration for {@link createBrudToolsDescriptor}. */
export interface BrudToolsDescriptorOptions {
  /** Optional diagnostic sink override. */
  readonly logger?: IPluginLogger;
}

/**
 * Builds the BrudTools service descriptor.
 *
 * The service validates every payload against the target tool's registered
 * `parametersSchema` through the kernel's zero-dependency JSON Schema
 * compiler. It therefore declares no validation-service dependency: the
 * compiler is a pure module, and no legacy operation-kind gate is involved.
 *
 * Boot position is before the plugin manager (rollout plan §2.3.4): the
 * routing table must exist before any plugin activates, so a plugin's tools
 * become routable the moment its `activate()` returns.
 *
 * @param options - Optional logger override.
 * @returns A core-tier descriptor for `brud.core.tools`.
 */
export function createBrudToolsDescriptor(
  options?: BrudToolsDescriptorOptions,
): ServiceDescriptor<IBrudToolsService, BrudToolsService> {
  return {
    token: BrudToolsToken,
    tier: BRUD_TOOLS_SERVICE_TIER,
    dependencies: [],
    accessPolicy: { deniedCallers: [] },
    factory: (): BrudToolsService => {
      const dependencies: BrudToolsDependencies = {
        ...(options?.logger === undefined ? {} : { logger: options.logger }),
      };

      return new BrudToolsService(dependencies);
    },
  };
}
