import type { ServiceTier } from '@brud/kernel';
import type { ServiceDescriptor } from '@brud/kernel';
import { BrudToolsToken } from '../../BrudTools/descriptor/tokens.js';
import { CORE_API_NAME, withExposedApis } from '@brud/kernel';
import { ValidationToken } from '../../ValidationService/descriptor/tokens.js';
import type { IActionManager } from '../contracts/IActionManager.js';
import { ACTION_MANAGER_ALLOWED_CALLERS } from '../contracts/IActionManager.js';
import { ActionManagerService } from '../orchestrator/index.js';
import type { ActionManagerDependencies } from '../orchestrator/index.js';
import { ActionManagerToken } from './tokens.js';

/** Tier assigned to the ActionManager descriptor. */
export const ACTION_MANAGER_SERVICE_TIER: ServiceTier = 'core';

/** Configuration for {@link createActionManagerDescriptor}. */
export interface ActionManagerDescriptorOptions {
  /** Optional diagnostic sink override. */
  readonly logger?: ActionManagerDependencies['logger'];
}

/**
 * Builds the ActionManager service descriptor.
 *
 * Boot position is after validation and BrudTools, and before history and the
 * plugin manager. The declared dependencies are ordering guarantees: the
 * frozen validation gate and the tool registry exist before any action is
 * registered or dispatched.
 *
 * The access policy allowlists only the plugin manager (registration) and the
 * UI daemon (list/execute). No plugin holds the broker, and an arbitrary
 * internal caller is rejected by the broker before projection.
 *
 * @param options - Optional logger override.
 * @returns A core-tier descriptor for `brud.core.actions`.
 */
export function createActionManagerDescriptor(
  options?: ActionManagerDescriptorOptions,
): ServiceDescriptor<IActionManager, ActionManagerService> {
  return {
    token: ActionManagerToken,
    tier: ACTION_MANAGER_SERVICE_TIER,
    dependencies: [ValidationToken, BrudToolsToken],
    accessPolicy: { allowedCallers: ACTION_MANAGER_ALLOWED_CALLERS },
    factory: (): ActionManagerService => {
      const dependencies: ActionManagerDependencies = {
        ...(options?.logger === undefined ? {} : { logger: options.logger }),
      };

      const service = new ActionManagerService(dependencies);

      return withExposedApis(service, (registry) => {
        registry.registerApi(CORE_API_NAME.actionManager, ActionManagerToken, {
          capability: 'actions:register',
          scope: 'runtime',
        });
      });
    },
  };
}

/** Standard ActionManager descriptor with no overrides. */
export const ActionManagerDescriptor: ServiceDescriptor<
  IActionManager,
  ActionManagerService
> = createActionManagerDescriptor();