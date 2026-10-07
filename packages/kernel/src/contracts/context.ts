import type { Token } from './container.js';
import type { OperationResult } from './handler.js';

export interface ExecutionContext {
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly signal?: AbortSignal;
  readonly callDepth: number;
  readonly metadata?: Record<string, unknown>;
  resolve<T>(token: Token<T>): T;
  invoke<TInput, TOutput>(kind: string, input: TInput): Promise<OperationResult<TOutput>>;
  createChildContext(overrides?: Partial<ExecutionContext>): ExecutionContext;
}