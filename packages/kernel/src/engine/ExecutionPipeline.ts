import type { ExecutionContext } from '../contracts/context.js';
import type { OperationHandler, OperationResult } from '../contracts/handler.js';
import type { Middleware, MiddlewareNext, IExecutionPipeline } from '../contracts/pipeline.js';
import type { IServiceContainer } from '../contracts/container.js';

export class ExecutionPipeline implements IExecutionPipeline {
  private readonly middlewares: Middleware[] = [];
  private readonly serviceContainer: IServiceContainer;

  constructor(serviceContainer: IServiceContainer) {
    this.serviceContainer = serviceContainer;
  }

  use(middleware: Middleware): void {
    this.middlewares.push(middleware);
  }

  async execute<TInput, TOutput>(
    handler: OperationHandler<TInput, TOutput>,
    context: ExecutionContext,
    input: TInput
  ): Promise<OperationResult<TOutput>> {
    const start = performance.now();

    const missing = this.verifyCapabilities(handler);
    if (missing) {
      return {
        status: "failed",
        error: `Missing required capability: ${missing.description ?? String(missing)}`,
        durationMs: 0,
      } as OperationResult<TOutput>;
    }

    try {
      const composed = this.compose(handler);
      const result = await composed(context, input);
      result.durationMs = performance.now() - start;
      return result;
    } catch (err: unknown) {
      return {
        status: "failed",
        error: err instanceof Error ? err : String(err),
        durationMs: performance.now() - start,
      } as OperationResult<TOutput>;
    }
  }

  private verifyCapabilities(handler: OperationHandler): symbol | null {
    if (!handler.requiredCapabilities) return null;
    for (const token of handler.requiredCapabilities) {
      if (!this.serviceContainer.has(token)) {
        return token;
      }
    }
    return null;
  }

  private compose<TInput, TOutput>(
    handler: OperationHandler<TInput, TOutput>
  ): (context: ExecutionContext, input: TInput) => Promise<OperationResult<TOutput>> {
    let runner: (context: ExecutionContext, input: TInput) => Promise<OperationResult<TOutput>> = (ctx, inp) =>
      handler.execute(ctx, inp);

    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      const mw = this.middlewares[i];
      const next = runner;
      runner = async (context: ExecutionContext, input: TInput): Promise<OperationResult<TOutput>> => {
        const nextWrapper: MiddlewareNext = () => next(context, input) as Promise<OperationResult>;
        const mwResult = await mw(context, input, nextWrapper);
        return mwResult as OperationResult<TOutput>;
      };
    }

    return runner;
  }
}