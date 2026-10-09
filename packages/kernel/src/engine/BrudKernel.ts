import type { ExecutionContext } from '../contracts/context.js';
import type { OperationResult, PromptDescriptor } from '../contracts/handler.js';
import type { IExecutionPipeline } from '../contracts/pipeline.js';
import type { IServiceContainer, Token } from '../contracts/container.js';
import type { IOperationRegistry } from '../contracts/registry.js';
import { ServiceContainer } from './ServiceContainer.js';
import { OperationRegistry } from './OperationRegistry.js';
import { ExecutionPipeline } from './ExecutionPipeline.js';

export interface KernelExecuteOptions {
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
  maxCallDepth?: number;
  workspaceRoot?: string;
}

export interface PromptManifestEntry {
  kind: string;
  promptDescriptor: PromptDescriptor;
}

export interface PromptManifest {
  operations: PromptManifestEntry[];
}

export class BrudKernel {
  readonly services: IServiceContainer;
  readonly operations: IOperationRegistry;
  readonly pipeline: IExecutionPipeline;
  private readonly maxCallDepth: number;

  constructor(options?: { maxCallDepth?: number }) {
    this.services = new ServiceContainer();
    this.operations = new OperationRegistry();
    this.pipeline = new ExecutionPipeline(this.services);
    this.maxCallDepth = options?.maxCallDepth ?? 5;
  }

  async execute<TInput, TOutput>(
    kind: string,
    input: TInput,
    options?: KernelExecuteOptions
  ): Promise<OperationResult<TOutput>> {
    const handler = this.operations.get(kind);
    if (!handler) {
      return {
        status: "failed",
        error: `Unknown operation kind: "${kind}"`,
        durationMs: 0,
      } as OperationResult<TOutput>;
    }

    const context = this.createExecutionContext(options);
    return this.pipeline.execute<TInput, TOutput>(handler as any, context, input);
  }

  private createExecutionContext(options?: KernelExecuteOptions): ExecutionContext {
    const kernel = this;
    const effectiveMaxDepth = options?.maxCallDepth ?? this.maxCallDepth;
    const sessionId = crypto.randomUUID();
    const workspaceRoot =
      options?.workspaceRoot ??
      (typeof options?.metadata?.workspaceRoot === 'string' ? options.metadata.workspaceRoot : undefined) ??
      process.cwd();

    async function invokeImpl<TInput, TOutput>(
      this: ExecutionContext,
      kind: string,
      input: TInput
    ): Promise<OperationResult<TOutput>> {
      const nextDepth = this.callDepth + 1;
      if (nextDepth > effectiveMaxDepth) {
        return {
          status: "failed",
          error: `Maximum call depth (${effectiveMaxDepth}) exceeded`,
        } as OperationResult<TOutput>;
      }
      const childCtx = this.createChildContext({ callDepth: nextDepth });
      const handler = kernel.operations.get(kind);
      if (!handler) {
        return {
          status: "failed",
          error: `Unknown operation kind: "${kind}"`,
          durationMs: 0,
        } as OperationResult<TOutput>;
      }
      return kernel.pipeline.execute<TInput, TOutput>(handler as any, childCtx, input as any) as Promise<OperationResult<TOutput>>;
    }

    function createChildContextImpl(this: ExecutionContext, overrides?: Partial<ExecutionContext>): ExecutionContext {
      return {
        sessionId: overrides?.sessionId ?? this.sessionId,
        workspaceRoot: overrides?.workspaceRoot ?? this.workspaceRoot,
        signal: overrides?.signal ?? this.signal,
        callDepth: overrides?.callDepth ?? this.callDepth,
        metadata: overrides?.metadata ?? this.metadata,
        resolve: overrides?.resolve ?? this.resolve,
        invoke: overrides?.invoke ?? this.invoke,
        createChildContext: overrides?.createChildContext ?? this.createChildContext,
      };
    }

    const ctx: ExecutionContext = {
      sessionId,
      workspaceRoot,
      signal: options?.signal,
      callDepth: 0,
      metadata: options?.metadata,
      resolve: <T>(token: Token<T>): T => kernel.services.resolve(token),
      invoke: invokeImpl as unknown as ExecutionContext['invoke'],
      createChildContext: createChildContextImpl,
    };

    return ctx;
  }

  generatePromptManifest(): PromptManifest {
    const operations = this.operations
      .list()
      .filter(
        (h): h is typeof h & { promptDescriptor: PromptDescriptor } =>
          h.promptDescriptor !== undefined
      )
      .map((h) => ({
        kind: h.kind,
        promptDescriptor: h.promptDescriptor!,
      }));

    return { operations };
  }
}