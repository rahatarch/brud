import type { KernelServiceModuleContext } from '../../src/bootstrap/bootTypes.js';
import type { IIdentityRegistry } from './contracts/types.js';
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

/**
 * Reads the identity registry instance published during construction.
 *
 * A boot-time issuer calls this from its own descriptor factory or
 * `initialize`, and declares {@link IdentityRegistryToken} as a dependency so
 * the registry has already loaded its storage.
 */
export function requireIdentityRegistry(
  context: KernelServiceModuleContext,
): IIdentityRegistry {
  const registry = context.shared[IDENTITY_REGISTRY_SLOT] as IIdentityRegistry | undefined;

  if (registry === undefined) {
    throw new Error(
      'brud.core.identityRegistry must be constructed before a boot-time identity issuer runs',
    );
  }

  return registry;
}