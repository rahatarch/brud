import { PUBLIC_API_CAPABILITY } from '@brud/kernel';
import type { ServiceTier } from '@brud/kernel';
import type { ServiceDescriptor } from '@brud/kernel';
import { CORE_API_NAME, withExposedApis } from '@brud/kernel';
import type { IUtilityService } from '../contracts/IUtilityService.js';
import { UtilityService } from '../orchestrator/UtilityService.js';
import { UtilityToken } from './tokens.js';

/** Tier assigned to the Utility service descriptor. */
export const UTILITY_SERVICE_TIER: ServiceTier = 'core';

/**
 * Builds the `brud.core.utils` service descriptor.
 *
 * The descriptor declares no dependencies, and the factory receives neither a
 * broker nor any other service token. That is deliberate: D-20 requires a
 * utility to depend only on its own code, other utilities, and native language
 * features. The service therefore boots as a standalone, extractable unit.
 *
 * Boot position is before the plugin manager. The manager declares this token
 * as a dependency, so the service is RUNNING before any plugin activates and
 * can call `context.getUtilities()`.
 *
 * @returns A core-tier descriptor for `brud.core.utils`.
 */
export function createUtilityDescriptor(): ServiceDescriptor<IUtilityService, UtilityService> {
  return {
    token: UtilityToken,
    tier: UTILITY_SERVICE_TIER,
    dependencies: [],
    factory: (): UtilityService => withExposedApis(
      new UtilityService(),
      (registry) => {
        registry.registerApi(CORE_API_NAME.utilities, UtilityToken, {
          capability: PUBLIC_API_CAPABILITY,
          scope: 'runtime',
        });
      },
    ),
  };
}

/** Standard utility descriptor with no configuration. */
export const UtilityDescriptor: ServiceDescriptor<IUtilityService, UtilityService> =
  createUtilityDescriptor();