import type { KernelServiceModuleContext } from '../../src/bootstrap/bootTypes.js';
import { ROUTER_CONTEXT_SCOPE, ROUTER_ROOT_CONTEXT_FIELD } from './bootOptions.js';
import { createRouterDescriptor } from './descriptor/RouterDescriptor.js';
import type { IRouterService } from './contracts/IRouterService.js';
import { isRouterRegistrant } from './contracts/registrant.js';

const ROUTER_SLOT = 'brud.core.router.instance';

export function createService(context: KernelServiceModuleContext) {
  context.declareContextFields(ROUTER_CONTEXT_SCOPE, [
    {
      name: ROUTER_ROOT_CONTEXT_FIELD,
      type: 'string',
      required: true,
      description: 'Absolute workspace root used when a dispatch omits one.',
    },
  ]);

  return createRouterDescriptor({
    onConstruct: (service) => {
      context.shared[ROUTER_SLOT] = service;
    },
  });
}

export function registerBootRegistrants(
  context: KernelServiceModuleContext,
  instances: readonly object[],
): void {
  const router = context.shared[ROUTER_SLOT] as IRouterService | undefined;

  if (router === undefined) {
    return;
  }

  for (const instance of instances) {
    if (isRouterRegistrant(instance)) {
      instance.registerWithRouter(router);
    }
  }

  router.closeRegistration();
}
