import type { ServiceDescriptor, ServiceTier } from '../../../src/contracts/index.js';
import { createServiceToken } from '../../../src/contracts/index.js';

/** Tier assigned to the cage's descriptor. */
export const WASM_CAGE_SERVICE_TIER: ServiceTier = 'core';

/** Contract version declared for the cage's interface. */
export const WASM_CAGE_CONTRACT_VERSION = '1.0.0';

/**
 * Methods declared for the cage's interface.
 *
 * The cage's only participant-facing surface is the exposed-API registry's
 * `resolve` (design record W-02, W-09). The cage is not a second giver; it is
 * the mechanism that carries a caged participant's call to the registry.
 */
export const WASM_CAGE_CONTRACT_METHODS = ['resolve'] as const;

/** Public interface the cage promises to the kernel. */
export interface IWasmCage {
  /**
   * Runs one caged participant's `resolve` against the exposed-API registry.
   *
   * The cage starts a `runtime`-origin chain (W-06), scopes the caged
   * participant's identity under the cage's, and carries the parent relation
   * on the caller frame (W-07). The implementation lands in a later step.
   *
   * @param name - The exposure to resolve.
   * @returns The resolved handle, or `null`.
   */
  resolve<T = unknown>(name: string): T | null;
}

/** Token identifying the cage. */
export const WasmCageToken = createServiceToken<IWasmCage>(
  'brud.core.wasmCage',
  'WASM isolation primitive: runs a caged participant\'s calls through the exposed-API registry',
);

/**
 * Builds the cage's descriptor.
 *
 * The descriptor is the universal participant shape (R-02). It declares the
 * cage's token, tier, empty dependencies, its contract, and a factory that
 * returns the cage's instance. The factory's body is a minimal stand-in at
 * this step: the cage's `resolve` path lands in a later plan step, and the
 * descriptor shape is what the hardcore list and the kernel's registration
 * require now.
 */
export function createWasmCageDescriptor(): ServiceDescriptor<IWasmCage> {
  return {
    token: WasmCageToken,
    tier: WASM_CAGE_SERVICE_TIER,
    dependencies: [],
    contract: {
      version: WASM_CAGE_CONTRACT_VERSION,
      methods: WASM_CAGE_CONTRACT_METHODS,
    },
    factory: (): IWasmCage => ({
      resolve<T = unknown>(_name: string): T | null {
        return null;
      },
    }),
  };
}