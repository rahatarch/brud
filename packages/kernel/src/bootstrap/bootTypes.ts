import type { IServiceLifecycle, KernelLogger } from '../contracts/lifecycle.js';

/**
 * Opaque plugin value supplied by a host or loaded from a config entry.
 *
 * The core never inspects a plugin beyond the structural manifest/activate
 * check it needs to accept the value. The plugin manager owns the real
 * contract.
 */
export type KernelPlugin = object;

/**
 * Generic options accepted by {@link bootKernel}.
 *
 * The core names exactly two fields: an open options bag and a logger. Every
 * service-specific option (workspace root, storage driver, history, settings,
 * plugins, ...) lives inside {@link BootKernelOptions.options} and is
 * interpreted by the service module that owns it. The core never sees those
 * names or types.
 */
export interface BootKernelOptions {
  /** Open options bag built by the host before boot. */
  readonly options?: Readonly<Record<string, unknown>>;

  /** Kernel diagnostic sink. Defaults to a console-backed sink. */
  readonly logger?: KernelLogger;
}

/** Options accepted by {@link createDeferredKernel} and {@link createStandardKernel}. */
export interface ComposeKernelOptions {
  /** Open options bag built by the host before boot. */
  readonly options?: Readonly<Record<string, unknown>>;

  /** Kernel diagnostic sink. Defaults to a console-backed sink. */
  readonly logger?: KernelLogger;
}

/**
 * Context handed to a config-selected service module.
 *
 * The module owns its descriptor; the loader owns ordering and official flags.
 * The context deliberately contains no concrete service instances and no
 * service option types: services read their own keys from the generic options
 * bag and coordinate through the untyped shared bag.
 */
export interface KernelServiceModuleContext {
  /** Generic options bag from the host. */
  readonly options: Record<string, unknown>;

  /** Kernel diagnostic sink. */
  readonly logger?: KernelLogger;

  /**
   * Per-kernel untyped coordination bag.
   *
   * Service modules use it to publish instances one another needs during
   * construction. The core treats it as opaque and never reads named slots.
   */
  readonly shared: Record<string, unknown>;
}

/**
 * Shape a config-selected service module exports.
 *
 * `createService` must return a `ServiceDescriptor`. It is typed as `unknown`
 * at this boundary because descriptors are invariant in their service type;
 * the loader validates the runtime shape and narrows it.
 *
 * The optional hooks are generic coordination points. The loader invokes them
 * without knowing which service implements them:
 * - `pinBootPolicies` ingests boot-time policy while the broker gate is open.
 * - `registerBootRegistrants` claims kinds and exposes APIs before `RUNNING`.
 */
export interface ServiceModule {
  /** Builds and returns this service's descriptor. */
  createService(context: KernelServiceModuleContext): unknown;

  /** Ingests frozen boot policy after construction. */
  pinBootPolicies?(
    context: KernelServiceModuleContext,
    instances: readonly IServiceLifecycle[],
  ): void | Promise<void>;

  /** Registers boot-time claims against this service's instance. */
  registerBootRegistrants?(
    context: KernelServiceModuleContext,
    instances: readonly IServiceLifecycle[],
  ): void;
}