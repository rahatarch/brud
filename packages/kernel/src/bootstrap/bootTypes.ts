import type {
  ContextFieldDeclaration,
  ContextSchema,
  ContextScopeDeclaration,
} from '../contracts/contextContract.js';
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
 * bag and coordinate through owner-namespaced entries in the shared bag.
 */
export interface KernelServiceModuleContext {
  /** Generic options bag from the host. */
  readonly options: Record<string, unknown>;

  /** Kernel diagnostic sink. */
  readonly logger?: KernelLogger;

  /**
   * Per-kernel owner-namespaced coordination bag.
   *
   * A module may publish an instance under a key inside its own namespace; the
   * core treats the bag as opaque and never reads named slots. A service that
   * needs another participant's API resolves it through the broker or the
   * exposed-API registry, never through another owner's slot.
   */
  readonly shared: Record<string, unknown>;

  /**
   * Declares the context fields this service requires from the options bag.
   *
   * A service may only declare fields inside its own dot-separated namespace.
   * Declarations are accepted during `createService` and `pinBootPolicies`, and
   * are rejected once the kernel reaches `RUNNING`.
   *
   * @param scope - Namespace owned by the declaring service.
   * @param fields - Fields to require or accept inside that namespace.
   */
  declareContextFields(
    scope: string,
    fields: readonly ContextFieldDeclaration[],
  ): void;

  /** Declares fields through a single scope-declaration record. */
  declareContextFields(declaration: ContextScopeDeclaration): void;

  /** Returns the schema collected so far, including fields from other services. */
  getContextSchema(): ContextSchema;
}

/**
 * Shape a config-selected service module exports.
 *
 * `createService` returns one descriptor, or an ordered list of descriptors
 * when the module exposes more than one API. Each descriptor is registered as
 * its own service; the descriptor shape itself does not change. The return is
 * typed as `unknown` at this boundary because descriptors are invariant in
 * their service type; the loader validates the runtime shape and narrows it.
 *
 * The optional hooks are generic coordination points available to every
 * participant. The loader invokes them without knowing which service
 * implements them:
 * - `pinBootPolicies` ingests a boot snapshot while the broker gate is open.
 * - `registerBootRegistrants` claims kinds and exposes APIs before `RUNNING`.
 */
export interface ServiceModule {
  /** Builds and returns this service's descriptor or descriptors. */
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