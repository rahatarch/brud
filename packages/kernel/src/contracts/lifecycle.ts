import type { IKernelAccessBroker } from './accessBroker.js';

/**
 * Privilege tier a service belongs to, ordered from most to least trusted.
 */
export type ServiceTier = 'kernel' | 'core' | 'userland';

/**
 * Minimal diagnostic logger surface a kernel can inject into services.
 *
 * Services treat it as an optional sink: the kernel supplies it during boot,
 * but standalone construction (tests, adapters) may omit it.
 */
export interface KernelLogger {
  /** Emits a structured, non-fatal diagnostic warning. */
  warn(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Ambient context supplied to a service at construction and access time.
 */
export interface ServiceContext {
  /** Identifier of the caller or service this context describes. */
  readonly callerId: string;

  /** Privilege tier of the caller. */
  readonly tier: ServiceTier;

  /** Absolute path of the workspace the kernel is operating in. */
  readonly workspaceRoot: string;

  /** Optional partition namespace isolating service state. */
  readonly partitionPrefix?: string;

  /** Kernel diagnostic sink. Absent in standalone construction. */
  readonly logger?: KernelLogger;
}

/**
 * Optional lifecycle hooks a service may implement.
 */
export interface IServiceLifecycle {
  /**
   * Prepares the service for use. Called once during kernel boot.
   *
   * @param broker - Mediated access broker for resolving dependencies.
   */
  initialize?(broker: IKernelAccessBroker): Promise<void> | void;

  /** Releases resources held by the service. Called once during shutdown. */
  dispose?(): Promise<void> | void;
}
