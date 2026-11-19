import type { KernelServiceModuleContext } from '../../src/bootstrap/bootTypes.js';
import { createWasmCageDescriptor } from './src/descriptor.js';

// The native loader and its pinned digest table are part of the cage's package
// graph, so the hardcore content pins cover the digests the loader trusts.
export { nativePlatformKey } from './src/native.js';

/**
 * Composes the WASM cage through the standard service-module contract.
 *
 * The module has no context fields of its own at this step: the cage's
 * configuration (resource profile, the loader capability) lands in a later
 * plan step. The module returns the descriptor the compiled hardcore list
 * verifies and the kernel registers.
 */
export function createService(_context: KernelServiceModuleContext) {
  return createWasmCageDescriptor();
}
