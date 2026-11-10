import type { KernelServiceModuleContext } from '../../src/bootstrap/bootTypes.js';
import { createRouterDescriptor } from './descriptor/RouterDescriptor.js';
import type { IRouterService } from './contracts/IRouterService.js';
import { isRouterRegistrant } from './contracts/registrant.js';

const ROUTER_SLOT = 'brud.core.router.instance';

export function createService(context: KernelServiceModuleContext) {
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