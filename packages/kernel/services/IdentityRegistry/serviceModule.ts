import type { KernelServiceModuleContext } from '../../src/bootstrap/bootTypes.js';
import {
  IDENTITY_REGISTRY_CONTEXT_SCOPE,
  IDENTITY_REGISTRY_PATH_CONTEXT_FIELD,
  createIdentityRegistryDescriptor,
} from './descriptor/descriptor.js';

/** Shared-bag slot where the identity registry publishes its instance. */
export const IDENTITY_REGISTRY_SLOT = 'brud.core.identityRegistry.instance';

/**
 * Composes the identity registry through the standard service-module contract.
 *
 * The module declares its own namespaced storage field and publishes the
 * instance for boot-time issuers. It does not read the kernel config.
 */
export function createService(context: KernelServiceModuleContext) {
  context.declareContextFields(IDENTITY_REGISTRY_CONTEXT_SCOPE, [
    {
      name: IDENTITY_REGISTRY_PATH_CONTEXT_FIELD,
      type: 'string',
      required: true,
      description: 'Absolute path to the operator-provisioned identity registry file.',
    },
  ]);

  return createIdentityRegistryDescriptor({
    onConstruct: (service) => {
      context.shared[IDENTITY_REGISTRY_SLOT] = service;
    },
  });
}

