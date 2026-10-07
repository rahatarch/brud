import type { ExecutionContext } from './context.js';
import type { OperationHandler, OperationResult } from './handler.js';

export type MiddlewareNext = () => Promise<OperationResult>;

export type Middleware = (
  context: ExecutionContext,
  input: unknown,
  next: MiddlewareNext
) => Promise<OperationResult>;

export interface IExecutionPipeline {
  use(middleware: Middleware): void;
  execute<TInput, TOutput>(
    handler: OperationHandler<TInput, TOutput>,
    context: ExecutionContext,
    input: TInput
  ): Promise<OperationResult<TOutput>>;
}