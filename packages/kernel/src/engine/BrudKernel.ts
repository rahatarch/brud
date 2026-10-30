import type { ExecutionContext } from '../contracts/context.js';
import type { OperationResult, PromptDescriptor } from '../contracts/handler.js';
import type { IExecutionPipeline } from '../contracts/pipeline.js';
import type { IServiceContainer, Token } from '../contracts/container.js';
import type { IOperationRegistry } from '../contracts/registry.js';
import type { ServiceInfo } from '../contracts/accessBroker.js';
import type { KernelBootOptions, IBrudKernel } from '../contracts/kernel.js';
import type { IServiceLifecycle, ServiceContext } from '../contracts/lifecycle.js';
import type { ServiceDescriptor } from '../contracts/serviceDescriptor.js';
import type { ServiceToken } from '../contracts/serviceToken.js';
import { ServiceContainer } from './ServiceContainer.js';
import { OperationRegistry } from './OperationRegistry.js';
import { ExecutionPipeline } from './ExecutionPipeline.js';
import { KernelRegistry } from './KernelRegistry.js';
import { KernelAccessBroker } from './KernelAccessBroker.js';
import { topologicalSort } from './dag.js';
import { LifecycleStateError } from './errors.js';
import type { KernelLifecycleState } from './state.js';

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

interface InitializedService {
  readonly tokenId: string;
  readonly instance: IServiceLifecycle;
}

export class BrudKernel implements IBrudKernel {
  readonly services: IServiceContainer;
  readonly operations: IOperationRegistry;
  readonly pipeline: IExecutionPipeline;
  private readonly maxCallDepth: number;
  private readonly registry: KernelRegistry;
  private readonly accessBroker: KernelAccessBroker;
  private readonly initializedServices: InitializedService[] = [];
  private state: KernelLifecycleState = 'UNINITIALIZED';
  private runningHooksPending = false;
  private readonly bootPinner: ((instances: readonly IServiceLifecycle[]) => Promise<void>) | undefined;

  constructor(options?: { maxCallDepth?: number; bootPinner?: (instances: readonly IServiceLifecycle[]) => Promise<void> }) {
    this.bootPinner = options?.bootPinner;
    this.services = new ServiceContainer();
    this.operations = new OperationRegistry();
    this.pipeline = new ExecutionPipeline(this.services);
    this.maxCallDepth = options?.maxCallDepth ?? 5;
    this.registry = new KernelRegistry();
    this.accessBroker = new KernelAccessBroker(this.registry, () => this.state);
  }

  get lifecycleState(): KernelLifecycleState {
    return this.state;
  }

  register<TService, TInternal extends TService = TService>(
    descriptor: ServiceDescriptor<TService, TInternal>,
  ): void {
    if (this.state !== 'UNINITIALIZED') {
      throw new LifecycleStateError('register', this.state, 'UNINITIALIZED');
    }

    this.registry.register(descriptor);
  }

  async boot(options: KernelBootOptions): Promise<void> {
    if (this.state !== 'UNINITIALIZED') {
      throw new LifecycleStateError('boot', this.state, 'UNINITIALIZED');
    }

    this.state = 'BOOTING';
    this.registry.freeze();

    try {
      const ordered = topologicalSort(this.descriptorMap());
      this.initializedServices.length = 0;

      for (const descriptor of ordered) {
        const context: ServiceContext = {
          callerId: 'kernel',
          tier: descriptor.tier,
          workspaceRoot: options.workspaceRoot,
          ...(options.logger === undefined ? {} : { logger: options.logger }),
        };

        const instance = descriptor.factory(context, this.accessBroker);
        this.registry.setInstance(descriptor.token.id, instance);

        if (typeof instance.initialize === 'function') {
          await instance.initialize(this.accessBroker);
        }

        this.initializedServices.push({ tokenId: descriptor.token.id, instance });
      }

      // Boot snapshot pinning. Services whose policy must be frozen from
      // another service's state (validation) register a pinner; it runs here,
      // while the broker's lifecycle gate is suspended for this one bounded
      // operation, so the frozen policy exists before any caller can resolve
      // the token. The hook is a no-op when no pinner was registered.
      const pinner = this.bootPinner;
      if (pinner !== undefined) {
        await this.accessBroker.withLifecycleGateSuspended(async (): Promise<void> => {
          await pinner(this.initializedServices.map((entry) => entry.instance));
        });
      }

      this.state = 'RUNNING';
    } catch (error: unknown) {
      await this.rollbackInitialized();
      this.state = 'DISPOSED';
      throw error;
    }

    // Post-boot start. The broker now grants access, so services can resolve
    // their dependencies (the plugin manager activates plugins here). Hooks run
    // one at a time in initialization order. Any failure rolls the whole
    // kernel back: the broker stops granting, every initialized service is
    // disposed in reverse order, and boot() rejects with the original error.
    this.runningHooksPending = true;

    try {
      for (const { instance } of this.initializedServices) {
        if (typeof instance.onRunning === 'function') {
          await instance.onRunning(this.accessBroker);
        }
      }
    } catch (error: unknown) {
      this.state = 'SHUTTING_DOWN';
      await this.rollbackInitialized();
      this.state = 'DISPOSED';
      throw error;
    } finally {
      this.runningHooksPending = false;
    }
  }

  async shutdown(): Promise<void> {
    if (this.runningHooksPending) {
      // Disposing services while onRunning hooks are still starting them would
      // tear down dependencies underneath an in-flight activation.
      throw new LifecycleStateError('shutdown while onRunning hooks are pending', this.state);
    }

    if (this.state !== 'RUNNING') {
      throw new LifecycleStateError('shutdown', this.state, 'RUNNING');
    }

    this.state = 'SHUTTING_DOWN';

    let firstError: unknown;
    const pending = this.initializedServices.splice(0).reverse();

    for (const { instance } of pending) {
      try {
        await instance.dispose?.();
      } catch (error: unknown) {
        if (firstError === undefined) {
          firstError = error;
        }
      }
    }

    this.registry.clearInstances();
    this.state = 'DISPOSED';

    if (firstError !== undefined) {
      throw firstError;
    }
  }

  requestAccess<TService>(caller: ServiceContext, token: ServiceToken<TService>): TService {
    return this.accessBroker.requestAccess(caller, token);
  }

  hasService(token: ServiceToken<unknown>): boolean {
    return this.accessBroker.hasService(token);
  }

  listServices(): readonly ServiceInfo[] {
    return this.accessBroker.listServices();
  }

  private descriptorMap(): Map<string, ServiceDescriptor<unknown>> {
    return new Map(
      this.registry.listDescriptors().map((descriptor) => [descriptor.token.id, descriptor]),
    );
  }

  private async rollbackInitialized(): Promise<void> {
    const pending = this.initializedServices.splice(0).reverse();

    for (const { instance } of pending) {
      try {
        await instance.dispose?.();
      } catch {
        continue;
      }
    }

    this.registry.clearInstances();
  }

  async execute<TInput, TOutput>(
    kind: string,
    input: TInput,
    options?: KernelExecuteOptions
  ): Promise<OperationResult<TOutput>> {
    const handler = this.operations.get<TInput, TOutput>(kind);
    if (!handler) {
      return {
        status: "failed",
        error: `Unknown operation kind: "${kind}"`,
        durationMs: 0,
      } as OperationResult<TOutput>;
    }

    const context = this.createExecutionContext(options);
    return this.pipeline.execute<TInput, TOutput>(handler, context, input);
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
      const handler = kernel.operations.get<TInput, TOutput>(kind);
      if (!handler) {
        return {
          status: "failed",
          error: `Unknown operation kind: "${kind}"`,
          durationMs: 0,
        } as OperationResult<TOutput>;
      }
      return kernel.pipeline.execute<TInput, TOutput>(handler, childCtx, input);
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
      invoke: invokeImpl,
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