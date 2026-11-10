import type { OperationResult } from '../../../src/contracts/handler.js';
import type { IServiceLifecycle, ServiceContext } from '../../../src/contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../../src/contracts/serviceDescriptor.js';
import {
  createServiceToken,
  type ServiceToken,
} from '../../../src/contracts/serviceToken.js';
import type { IBrudPlugin } from '../../../services/PluginManager/contracts/IBrudPlugin.js';
import type { IPluginContext } from '../../../services/PluginManager/contracts/IPluginContext.js';
import type { IRouterRegistrant } from '../../../services/Router/contracts/registrant.js';
import type { IRouterService } from '../../../services/Router/contracts/IRouterService.js';
import { ROUTER_CALLER_ID } from '../../../services/Router/contracts/caller.js';
import { RouterToken } from '../../../services/Router/descriptor/tokens.js';

/** Kind claimed by the synthetic peer service. Clearly non-shipped. */
export const TEST_QUERY_KIND = 'test_query' as const;

/** Plugin id used by the synthetic peer plugin. */
export const TEST_QUERY_PLUGIN_ID = 'acme.test.dynamic-peer-query';

/** Execution context handed to a synthetic query handler. */
export interface TestQueryExecutionContext {
  readonly workspaceRoot: string;
  readonly callerId: string;
  readonly signal?: AbortSignal;
  readonly origin?: string;
}

/** Declarative operation a plugin publishes into the synthetic service. */
export interface TestQueryOperationOptions {
  /** Unique query name. */
  readonly name: string;

  /** Human-readable description. */
  readonly description: string;

  /** Handler invoked after the service resolves the name. */
  readonly execute: (
    input: Record<string, unknown>,
    context: TestQueryExecutionContext,
  ) => Promise<OperationResult>;
}

/** Handler-free projection of a registered query. */
export interface RegisteredTestQuery {
  readonly name: string;
  readonly description: string;
  readonly ownerPluginId: string;
}

/** Disposable returned by {@link ITestQueryService.registerQuery}. */
export interface ITestQueryDisposable {
  dispose(): void;
}

/** Public contract of the synthetic peer service. */
export interface ITestQueryService {
  /**
   * Registers one query on behalf of a plugin.
   *
   * @param pluginId - Owning plugin identifier.
   * @param options - Query definition and handler.
   */
  registerQuery(pluginId: string, options: TestQueryOperationOptions): ITestQueryDisposable;

  /**
   * Executes a registered query.
   *
   * @param name - Query name.
   * @param rawInput - Untrusted payload.
   * @param context - Caller execution context.
   */
  executeQuery(
    name: string,
    rawInput: unknown,
    context: TestQueryExecutionContext,
  ): Promise<OperationResult>;

  /** Resolves a registered query projection. */
  getQuery(name: string): RegisteredTestQuery | undefined;

  /** Lists registered query names in registration order. */
  listQueries(): readonly string[];
}

/** Token for the synthetic peer service. */
export const TestQueryToken = createServiceToken<ITestQueryService>(
  'test.peer.query',
  'Synthetic peer query service used by dynamic-routing tests',
);

/** Shared observation of construction for the plugin closure. */
export interface TestQueryBinding {
  service?: TestQueryService;
}

/** Options for {@link createTestQueryDescriptor}. */
export interface TestQueryDescriptorOptions {
  /** Captures the constructed instance for the plugin under test. */
  readonly binding: TestQueryBinding;

  /** Token to register. Defaults to {@link TestQueryToken}. */
  readonly token?: ServiceToken<ITestQueryService>;

  /** Kind to claim. Defaults to {@link TEST_QUERY_KIND}. */
  readonly kind?: string;
}

interface QueryEntry {
  readonly ownerPluginId: string;
  readonly options: TestQueryOperationOptions;
}

/**
 * Synthetic Level-1 service shaped like ActionManager.
 *
 * It owns an instance-scoped registry, a lifecycle, and a boot-time Router
 * registration. It depends only on the Router for ordering; it never reaches a
 * shipped domain service.
 */
export class TestQueryService implements ITestQueryService, IServiceLifecycle, IRouterRegistrant {
  private readonly entries = new Map<string, QueryEntry>();

  private readonly token: ServiceToken<ITestQueryService>;

  private readonly kind: string;

  private disposed = false;

  constructor(options: {
    readonly token: ServiceToken<ITestQueryService>;
    readonly kind: string;
  }) {
    this.token = options.token;
    this.kind = options.kind;
  }

  /** Lifecycle no-op: bootstrap is synchronous. */
  async initialize(): Promise<void> {
    return undefined;
  }

  /** Clears the registry and refuses later execution. */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.entries.clear();
  }

  /** Whether {@link dispose} has run. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  registerQuery(
    pluginId: string,
    options: TestQueryOperationOptions,
  ): ITestQueryDisposable {
    this.assertLive();

    if (this.entries.has(options.name)) {
      throw new Error(
        `TEST_QUERY_DUPLICATE: query "${options.name}" is already registered`,
      );
    }

    const entry: QueryEntry = { ownerPluginId: pluginId, options };

    this.entries.set(options.name, entry);

    return {
      dispose: (): void => {
        if (this.entries.get(options.name) === entry) {
          this.entries.delete(options.name);
        }
      },
    };
  }

  async executeQuery(
    name: string,
    rawInput: unknown,
    context: TestQueryExecutionContext,
  ): Promise<OperationResult> {
    if (this.disposed) {
      return { status: 'failed', error: 'TEST_QUERY_DISPOSED: service has been disposed' };
    }

    const entry = this.entries.get(name);

    if (entry === undefined) {
      return {
        status: 'failed',
        error: `TEST_QUERY_NOT_FOUND: query "${name}" is not registered`,
      };
    }

    try {
      return await entry.options.execute(normalizeInput(rawInput), context);
    } catch (error: unknown) {
      return {
        status: 'failed',
        error: `TEST_QUERY_HANDLER_ERROR: ${describe(error)}`,
      };
    }
  }

  getQuery(name: string): RegisteredTestQuery | undefined {
    const entry = this.entries.get(name);

    if (entry === undefined) {
      return undefined;
    }

    return Object.freeze({
      name: entry.options.name,
      description: entry.options.description,
      ownerPluginId: entry.ownerPluginId,
    });
  }

  listQueries(): readonly string[] {
    return Object.freeze(Array.from(this.entries.keys()));
  }

  /** Claims the configured kind during the boot registration window. */
  registerWithRouter(router: IRouterService): void {
    this.claim(router, this.kind);
  }

  /**
   * Test hook: attempts to claim another kind through this initialized service.
   *
   * @param router - Router under test.
   * @param kind - Additional kind to claim.
   */
  registerAdditionalKind(router: IRouterService, kind: string): void {
    this.claim(router, kind);
  }

  private claim(router: IRouterService, kind: string): void {
    router.register<ITestQueryService>({
      kind,
      token: this.token,
      dispatch: (service, operation, context) => service.executeQuery(
        operation.name,
        { ...operation.parameters },
        {
          workspaceRoot: context.workspaceRoot,
          callerId: context.callerId,
          ...(context.signal === undefined ? {} : { signal: context.signal }),
          ...(context.origin === undefined ? {} : { origin: context.origin }),
        },
      ),
    });
  }

  private assertLive(): void {
    if (this.disposed) {
      throw new Error('TEST_QUERY_DISPOSED: service has been disposed');
    }
  }
}

/**
 * Builds the synthetic service descriptor.
 *
 * The descriptor declares the Router as an ordering dependency so it is
 * constructed after the Router exists, and it registers during the standard
 * kernel's boot pinner.
 *
 * @param options - Binding, token, and kind overrides.
 */
export function createTestQueryDescriptor(
  options: TestQueryDescriptorOptions,
): ServiceDescriptor<ITestQueryService, TestQueryService> {
  const token = options.token ?? TestQueryToken;
  const kind = options.kind ?? TEST_QUERY_KIND;

  return {
    token,
    tier: 'core',
    dependencies: [RouterToken],
    accessPolicy: { allowedCallers: ['kernel', ROUTER_CALLER_ID] },
    factory: (context: ServiceContext): TestQueryService => {
      void context;

      const service = new TestQueryService({ token, kind });

      options.binding.service = service;

      return service;
    },
  };
}

/** Observation recorded by the synthetic plugin. */
export interface DynamicRoutingProbe {
  /** Handler invocations in execution order. */
  readonly calls: string[];

  /** Query names registered with the synthetic service. */
  readonly registered: string[];
}

/**
 * Builds a real plugin that registers a tool, an action, and three synthetic
 * queries (echo, explicit failure, and throw).
 *
 * @param binding - Captured synthetic service instance.
 * @param probe - Observation sink.
 */
export function createDynamicRoutingPlugin(
  binding: TestQueryBinding,
  probe: DynamicRoutingProbe,
): IBrudPlugin {
  return {
    manifest: {
      id: TEST_QUERY_PLUGIN_ID,
      name: 'Dynamic Peer Query Probe',
      version: '1.0.0',
      permissions: ['tools:register', 'actions:register'],
    },
    activate(context: IPluginContext): void {
      const service = binding.service;

      if (service === undefined) {
        throw new Error(
          'TestQueryService was not constructed before plugin activation',
        );
      }

      context.registerTool({
        name: 'peer_tool_echo',
        description: 'Echoes a tool payload from the synthetic peer plugin.',
        parametersSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false,
        },
        execute: async (input): Promise<OperationResult> => {
          probe.calls.push('tool:peer_tool_echo');

          return {
            status: 'success',
            data: {
              route: 'tool',
              text: input.text,
              pluginId: context.pluginId,
            },
          };
        },
      });

      context.registerAction({
        name: 'peer_action_echo',
        description: 'Echoes an action payload from the synthetic peer plugin.',
        parametersSchema: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
          additionalProperties: false,
        },
        execute: async (input, executionContext): Promise<OperationResult> => {
          probe.calls.push('action:peer_action_echo');

          return {
            status: 'success',
            data: {
              route: 'action',
              message: input.message,
              pluginId: context.pluginId,
              callerId: executionContext.callerId,
            },
          };
        },
      });

      const registerQuery = (
        name: string,
        execute: TestQueryOperationOptions['execute'],
      ): void => {
        service.registerQuery(context.pluginId, {
          name,
          description: `${name} synthetic query`,
          execute,
        });
        probe.registered.push(name);
      };

      registerQuery('peer_query_echo', async (input, executionContext) => {
        probe.calls.push('test_query:peer_query_echo');

        return {
          status: 'success',
          data: {
            route: 'test_query',
            text: input.text,
            pluginId: context.pluginId,
            callerId: executionContext.callerId,
          },
        };
      });

      registerQuery('peer_query_fail', async () => {
        probe.calls.push('test_query:peer_query_fail');

        return {
          status: 'failed',
          error: 'TEST_QUERY_EXPECTED_FAILURE',
        };
      });

      registerQuery('peer_query_throw', async () => {
        probe.calls.push('test_query:peer_query_throw');

        throw new Error('query handler boom');
      });
    },
  };
}

/** Normalizes an untrusted payload to a handler object. */
function normalizeInput(rawInput: unknown): Record<string, unknown> {
  if (rawInput !== null && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    return rawInput as Record<string, unknown>;
  }

  return {};
}

/** Renders an unknown thrown value. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}