import type { IKernelAccessBroker } from './accessBroker.js';
import type { KernelHostSession, KernelObservation } from './callChain.js';
import type { ContextSchema } from './contextContract.js';
import type { KernelLogger } from './lifecycle.js';
import type { ServiceDescriptor } from './serviceDescriptor.js';

/**
 * Options controlling a kernel boot sequence.
 */
export interface KernelBootOptions {
  /** Open options bag supplied by the host and forwarded to services. */
  readonly options?: Readonly<Record<string, unknown>>;

  /** Optional diagnostic sink forwarded to every service context. */
  readonly logger?: KernelLogger;
}

/**
 * Root microkernel contract governing service registration and lifecycle.
 */
export interface IBrudKernel extends IKernelAccessBroker {
  /**
   * Registers a service descriptor. Must be called before {@link boot}.
   *
   * @typeParam TService - The public interface exposed by the service.
   * @param descriptor - Self-describing registration record.
   */
  register<TService>(descriptor: ServiceDescriptor<TService>): void;

  /**
   * Initializes every registered service in dependency order.
   *
   * @param options - Boot configuration.
   */
  boot(options: KernelBootOptions): Promise<void>;

  /** Disposes every initialized service in reverse dependency order. */
  shutdown(): Promise<void>;

  /** Returns the dynamically built context schema. */
  getContextSchema(): ContextSchema;

  /**
   * Validates an options bag against the locked context schema.
   *
   * Used by hosts that build a fresh context after boot.
   */
  validateContextOptions(options: Readonly<Record<string, unknown>>): void;

  /**
   * Runs an operation inside a host-origin call chain.
   *
   * This is the only way a chain gets the `host` origin. It is a method of the
   * kernel object, which only the host holds; a participant receives the access
   * broker, never the kernel. The host calls it from its authenticated session.
   *
   * @param session - The host session's declaration.
   * @param operation - Work performed inside the host-origin chain.
   */
  runHostCall<T>(session: KernelHostSession, operation: () => T): T;

  /**
   * Reads the kernel's observation stream.
   *
   * Detailed denial reasons are recorded here, never returned to the refused
   * caller. Only the holder of the kernel object can read the stream.
   */
  readObservations(): readonly KernelObservation[];
}
