import type { ServiceDescriptor, ServiceTier } from '@brud/kernel';
import { defineParticipant } from '@brud/sdk/participant';
import type { IUtilityService } from '../contracts/IUtilityService.js';
import { UTILITY_EXPOSURE, type IUtilityApi } from '../contracts/exposure.js';
import { UtilityService } from '../orchestrator/UtilityService.js';
import { UtilityToken } from './tokens.js';

/** Tier assigned to the Utility service descriptor. */
export const UTILITY_SERVICE_TIER: ServiceTier = 'core';

/**
 * Builds the `brud.core.utils` descriptor with the BrudOS SDK: one public,
 * zero-authority exposure, `brud.utilities@1`.
 *
 * The participant requests no capabilities and resolves nothing (D-20: a
 * utility depends only on its own code and native language features), so it
 * boots as a standalone, extractable unit.
 *
 * @returns A core-tier descriptor for `brud.core.utils`.
 */
export function createUtilityDescriptor(): ServiceDescriptor<IUtilityService, UtilityService> {
  return defineParticipant<UtilityService>({
    id: UtilityToken.id,
    description: UtilityToken.description,
    tier: UTILITY_SERVICE_TIER,
    exposes: {
      [UTILITY_EXPOSURE]: {
        version: 1,
        scope: 'runtime',
        handle: (_caller, ctx): IUtilityApi => ctx.instance,
      },
    },
    create: () => new UtilityService(),
  })() as unknown as ServiceDescriptor<IUtilityService, UtilityService>;
}

/** Standard utility descriptor with no configuration. */
export const UtilityDescriptor: ServiceDescriptor<IUtilityService, UtilityService> =
  createUtilityDescriptor();
