import type { KernelServiceModuleContext } from '../../src/bootstrap/bootTypes.js';
import {
  EXPOSED_API_REGISTRY_CONTEXT_SCOPE,
  EXPOSED_API_SCOPE_RECORD_PATH_FIELD,
  createExposedApiRegistryDescriptor,
} from './descriptor/ExposedApiRegistryDescriptor.js';

/**
 * Composes the resolution primitive through the standard service-module
 * contract.
 *
 * The module declares only its own namespaced storage field. It publishes no
 * instance: registration is the kernel's, during admission, and every
 * participant reaches `resolve` through the access broker.
 */
export function createService(context: KernelServiceModuleContext) {
  context.declareContextFields(EXPOSED_API_REGISTRY_CONTEXT_SCOPE, [
    {
      name: EXPOSED_API_SCOPE_RECORD_PATH_FIELD,
      type: 'string',
      required: false,
      description: 'Absolute path to the protected exposed API scope record.',
    },
  ]);

  return createExposedApiRegistryDescriptor();
}
