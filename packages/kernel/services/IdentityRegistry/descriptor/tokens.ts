import { createServiceToken } from '../../../src/contracts/serviceToken.js';
import type { IIdentityRegistry } from '../contracts/types.js';

/**
 * Kernel service token for the identity registry.
 *
 * The identifier is stable and namespaced under the kernel's core tier. It is
 * not an identity token; it resolves the registry service itself.
 */
export const IdentityRegistryToken = createServiceToken<IIdentityRegistry>(
  'brud.core.identityRegistry',
  'Kernel-owned registry of issued participant identity tokens',
);