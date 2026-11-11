import type { IKernelAccessBroker } from './accessBroker.js';
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
   * Used by hosts that build a fresh context after boot, such as a daemon
   * attaching a client session.
   */
  validateContextOptions(options: Readonly<Record<string, unknown>>): void;
}
