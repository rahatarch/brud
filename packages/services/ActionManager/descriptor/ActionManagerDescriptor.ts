import type { ServiceTier } from '@brud/kernel';
import type { ServiceDescriptor } from '@brud/kernel';
import { defineParticipant } from '@brud/sdk/participant';
import { ACTION_MANAGER_DISPATCH_EXPOSURE, ACTION_MANAGER_EXPOSURE, ACTIONS_REGISTER_CAPABILITY } from '../contracts/exposure.js';
import type { BrudDispatchContext } from '@brud/kernel/services/Router/contracts/types.js';
import type { BrudOperation } from '@brud/kernel/services/Parser/contracts/types.js';
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
  const base = defineParticipant<ActionManagerService>({
    id: ActionManagerToken.id,
    description: ActionManagerToken.description,
    tier: ACTION_MANAGER_SERVICE_TIER,
    exposes: {
      [ACTION_MANAGER_EXPOSURE]: {
        version: 1,
        scope: 'runtime',
        policy: { policyVersion: 2, capabilities: [ACTIONS_REGISTER_CAPABILITY] },
        handle: (_caller, ctx) => ctx.instance,
      },
      // Official callers only (the Router is one): it trusts the caller view in
      // its context, which non-official (caged) code can never supply.
      [ACTION_MANAGER_DISPATCH_EXPOSURE]: {
        version: 1,
        scope: 'any',
        policy: { policyVersion: 2, official: true },
        handle: (_caller, ctx) => ({ dispatch: (operation: BrudOperation, context: BrudDispatchContext) => ctx.instance.dispatchRouted(operation, context) }),
      },
    },
    create: () => new ActionManagerService({
      ...(options?.logger === undefined ? {} : { logger: options.logger }),
    }),
  })();

  return {
    ...base,
    token: ActionManagerToken,
    accessPolicy: { allowedCallers: ACTION_MANAGER_ALLOWED_CALLERS },
  } as unknown as ServiceDescriptor<IActionManager, ActionManagerService>;
}

export const ActionManagerDescriptor: ServiceDescriptor<
  IActionManager,
  ActionManagerService
> = createActionManagerDescriptor();