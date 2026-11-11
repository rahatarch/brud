import type { Token } from './container.js';
import type { OperationResult } from './handler.js';

export interface ExecutionContext {
  readonly sessionId: string;
  /**
   * Opaque host-supplied options bag.
   *
   * The kernel stores the bag at boot and attaches it unchanged to every
   * execution context. The core never inspects a key; operations read the
   * options their own domain owns.
   */
  readonly options: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
  readonly callDepth: number;
  readonly metadata?: Record<string, unknown>;
  resolve<T>(token: Token<T>): T;
  invoke<TInput, TOutput>(kind: string, input: TInput): Promise<OperationResult<TOutput>>;
  createChildContext(overrides?: Partial<ExecutionContext>): ExecutionContext;
}