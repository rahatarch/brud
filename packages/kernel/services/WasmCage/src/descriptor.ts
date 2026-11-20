import type {
  IKernelAccessBroker,
  KernelCallAuthority,
  ServiceContext,
  ServiceDescriptor,
  ServiceTier,
} from '../../../src/contracts/index.js';
import { createServiceToken } from '../../../src/contracts/index.js';
import { ExposedApiRegistryToken } from '../../ExposedApiRegistry/index.js';

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
   * Binds the kernel's call authority.
   *
   * Called once from the cage's hardcore boot hook, with the authority the
   * kernel hands that hook. Before it is called, `resolve` returns `null`
   * rather than running without a chain.
   *
   * @param value - The kernel's call authority.
   */
  bindAuthority(value: KernelCallAuthority): void;

  /**
   * Runs one caged participant's `resolve` against the exposed-API registry.
   *
   * The cage starts a `runtime`-origin chain with the caged participant's
   * recorded caller (W-06), so the frame carries the participant's
   * kernel-issued identity and its parent relation (W-07). The cage does not
   * decide policy: the registry evaluates the giver's Layer 1 policy. The cage
   * is the door, and `resolve` is the only method on its surface (W-02, W-09).
   *
   * @param participantIdentity - The caged participant's kernel-issued token.
   * @param name - The exposure to resolve.
   * @param options - Version and expected owner identity.
   * @returns The resolved handle, or `null`.
   */
  resolve<T = unknown>(
    participantIdentity: string,
    name: string,
    options?: { readonly version?: number | string; readonly expectedOwner?: string },
  ): T | null;
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
/**
 * The registry's resolve, as the cage calls it.
 *
 * The cage reaches the registry through the broker; it never imports the
 * registry package. The shape is the one `IExposedApiRegistry.resolve`
 * declares, narrowed to what the cage forwards.
 */
interface RegistryResolveSurface {
  resolve<T = unknown>(
    name: string,
    options?: { readonly version?: number | string; readonly expectedOwner?: string },
  ): T | null;
}

export function createWasmCageDescriptor(): ServiceDescriptor<IWasmCage> {
  return {
    token: WasmCageToken,
    tier: WASM_CAGE_SERVICE_TIER,
    dependencies: [],
    contract: {
      version: WASM_CAGE_CONTRACT_VERSION,
      methods: WASM_CAGE_CONTRACT_METHODS,
    },
    factory: (context: ServiceContext, broker: IKernelAccessBroker): IWasmCage => {
      // The cage starts a runtime-origin chain per caged call. The chain-start
      // member needs the kernel's call authority, which the factory does not
      // receive. The cage captures it in `bindAuthority`, called from its boot
      // hook (a later step). Until then a caged call is refused rather than
      // run without a chain.
      let authority: KernelCallAuthority | undefined;

      const registryFor = (caller: ServiceContext): RegistryResolveSurface => broker.requestAccess(
        caller,
        ExposedApiRegistryToken as unknown as Parameters<IKernelAccessBroker['requestAccess']>[1],
      ) as RegistryResolveSurface;

      const instance: IWasmCage & { bindAuthority(value: KernelCallAuthority): void } = {
        bindAuthority(value: KernelCallAuthority): void {
          authority = value;
        },
        resolve<T = unknown>(
          participantIdentity: string,
          name: string,
          options?: { readonly version?: number | string; readonly expectedOwner?: string },
        ): T | null {
          const callAuthority = authority;

          if (callAuthority === undefined) {
            return null;
          }

          const caller: ServiceContext = {
            callerId: participantIdentity,
            tier: context.tier,
            options: context.options,
          };
          // Registry access and the resolve both happen inside the caged
          // participant's own frame, so the broker binds the request to it.
          return callAuthority.runAsOrigin(
            'runtime',
            participantIdentity,
            () => registryFor(caller).resolve<T>(name, options),
          );
        },
      };

      return instance;
    },
  };
}