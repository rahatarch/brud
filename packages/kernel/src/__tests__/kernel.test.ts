import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  ServiceContainer,
  OperationRegistry,
  ExecutionPipeline,
  BrudKernel,
  LifecycleStateError,
  MissingDependencyError,
  ServiceNotFoundError,
} from '../engine/index.js';
import { createToken } from '../contracts/container.js';
import { createServiceToken } from '../contracts/serviceToken.js';
import type { ExecutionContext } from '../contracts/context.js';
import type { OperationHandler, OperationResult } from '../contracts/handler.js';
import type { Token } from '../contracts/container.js';
import type { IKernelAccessBroker } from '../contracts/accessBroker.js';
import type { ServiceContext } from '../contracts/lifecycle.js';
import type { ServiceDescriptor } from '../contracts/serviceDescriptor.js';
import type { ServiceToken } from '../contracts/serviceToken.js';

const SAMPLE_TOKEN = createToken<string>('sample.config');
const CAP_TOKEN = createToken<string>('required.capability');

function createMinimalContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    sessionId: 'test-session',
    workspaceRoot: '/tmp',
    callDepth: 0,
    resolve: <T>(_token: Token<T>) => { throw new Error('unresolved'); },
    invoke: async <T1, T2>(_kind: string, _input: T1) => ({ status: 'skipped' as const }),
    createChildContext: (o?: Partial<ExecutionContext>) => createMinimalContext({ ...overrides, ...o }),
    ...overrides,
  };
}

// ── Container Tests ─────────────────────────────────────────────

describe('ServiceContainer', () => {
  let container: ServiceContainer;

  beforeEach(() => {
    container = new ServiceContainer();
  });

  it('resolves a directly registered instance', () => {
    container.register(SAMPLE_TOKEN, 'hello');
    assert.strictEqual(container.resolve(SAMPLE_TOKEN), 'hello');
  });

  it('invokes a lazy factory and caches the result', () => {
    let callCount = 0;
    container.register(SAMPLE_TOKEN, () => {
      callCount++;
      return `value-${callCount}`;
    });
    assert.strictEqual(container.resolve(SAMPLE_TOKEN), 'value-1');
    assert.strictEqual(container.resolve(SAMPLE_TOKEN), 'value-1');
    assert.strictEqual(callCount, 1);
  });

  it('reports has() correctly', () => {
    assert.strictEqual(container.has(SAMPLE_TOKEN), false);
    container.register(SAMPLE_TOKEN, 'x');
    assert.strictEqual(container.has(SAMPLE_TOKEN), true);
  });

  it('throws on unresolved token', () => {
    assert.throws(() => container.resolve(SAMPLE_TOKEN), /Unresolved token/);
  });

  it('child scope inherits parent registrations', () => {
    container.register(SAMPLE_TOKEN, 'parent');
    const child = container.createChildScope();
    assert.strictEqual(child.resolve(SAMPLE_TOKEN), 'parent');
  });

  it('child scope overrides parent registrations', () => {
    container.register(SAMPLE_TOKEN, 'parent');
    const child = container.createChildScope();
    child.register(SAMPLE_TOKEN, 'child');
    assert.strictEqual(child.resolve(SAMPLE_TOKEN), 'child');
    assert.strictEqual(container.resolve(SAMPLE_TOKEN), 'parent');
  });

  it('grandchild inherits from grandparent when intermediate has no registration', () => {
    container.register(SAMPLE_TOKEN, 'grandparent');
    const child = container.createChildScope();
    const grandchild = child.createChildScope();
    assert.strictEqual(grandchild.resolve(SAMPLE_TOKEN), 'grandparent');
  });

  it('grandchild overrides ancestor', () => {
    container.register(SAMPLE_TOKEN, 'gp');
    const child = container.createChildScope();
    const grandchild = child.createChildScope();
    grandchild.register(SAMPLE_TOKEN, 'gc');
    assert.strictEqual(grandchild.resolve(SAMPLE_TOKEN), 'gc');
    assert.strictEqual(child.resolve(SAMPLE_TOKEN), 'gp');
  });

  it('freeze() sets isFrozen to true', () => {
    assert.strictEqual(container.isFrozen, false);
    container.freeze();
    assert.strictEqual(container.isFrozen, true);
  });

  it('register() throws SecurityFault on frozen container', () => {
    container.freeze();
    assert.throws(
      () => container.register(SAMPLE_TOKEN, 'should-fail'),
      /SecurityFault/,
    );
  });

  it('child scope inherits frozen state from parent', () => {
    container.freeze();
    const child = container.createChildScope();
    assert.strictEqual(child.isFrozen, true);
    assert.throws(
      () => child.register(SAMPLE_TOKEN, 'child-fail'),
      /SecurityFault/,
    );
  });
});

// ── Registry Tests ──────────────────────────────────────────────

describe('OperationRegistry', () => {
  let registry: OperationRegistry;
  const dummyHandler: OperationHandler = {
    kind: 'test_op',
    execute: async () => ({ status: 'success', data: 'ok' }),
  };

  beforeEach(() => {
    registry = new OperationRegistry();
  });

  it('registers and retrieves a handler', () => {
    registry.register(dummyHandler);
    assert.strictEqual(registry.get('test_op'), dummyHandler);
  });

  it('has() returns correct values', () => {
    assert.strictEqual(registry.has('test_op'), false);
    registry.register(dummyHandler);
    assert.strictEqual(registry.has('test_op'), true);
  });

  it('list() returns all registered handlers', () => {
    const a: OperationHandler = { kind: 'a', execute: async () => ({ status: 'success' }) };
    const b: OperationHandler = { kind: 'b', execute: async () => ({ status: 'success' }) };
    registry.register(a);
    registry.register(b);
    assert.strictEqual(registry.list().length, 2);
  });

  it('throws on duplicate registration', () => {
    registry.register(dummyHandler);
    assert.throws(() => registry.register(dummyHandler), /already registered/);
  });

  it('returns undefined for unknown kind', () => {
    assert.strictEqual(registry.get('nonexistent'), undefined);
  });
});

// ── Pipeline & Capability Tests ─────────────────────────────────

describe('ExecutionPipeline', () => {
  let container: ServiceContainer;
  let pipeline: ExecutionPipeline;

  beforeEach(() => {
    container = new ServiceContainer();
    pipeline = new ExecutionPipeline(container);
  });

  it('executes a handler successfully', async () => {
    const handler: OperationHandler<string, string> = {
      kind: 'echo',
      execute: async (_ctx, input) => ({ status: 'success', data: input }),
    };
    const ctx = createMinimalContext();
    const result = await pipeline.execute(handler, ctx, 'hello');
    assert.strictEqual(result.status, 'success');
    assert.strictEqual(result.data, 'hello');
  });

  it('reports durationMs', async () => {
    const handler: OperationHandler = {
      kind: 'slow',
      execute: async () => ({ status: 'success', data: 'done' }),
    };
    const ctx = createMinimalContext();
    const result = await pipeline.execute(handler, ctx, {});
    assert.ok(result.durationMs !== undefined);
    assert.ok(result.durationMs >= 0);
  });

  it('fails when required capability token is missing', async () => {
    const handler: OperationHandler = {
      kind: 'needy',
      requiredCapabilities: [CAP_TOKEN],
      execute: async () => ({ status: 'success' }),
    };
    const ctx = createMinimalContext();
    const result = await pipeline.execute(handler, ctx, {});
    assert.strictEqual(result.status, 'failed');
    assert.match(result.error as string, /Missing required capability/);
  });

  it('succeeds when required capability token exists', async () => {
    container.register(CAP_TOKEN, 'present');
    const handler: OperationHandler = {
      kind: 'needy',
      requiredCapabilities: [CAP_TOKEN],
      execute: async () => ({ status: 'success', data: 'cap-ok' }),
    };
    const ctx = createMinimalContext();
    const result = await pipeline.execute(handler, ctx, {});
    assert.strictEqual(result.status, 'success');
    assert.strictEqual(result.data, 'cap-ok');
  });

  it('catches synchronous throw from handler', async () => {
    const handler: OperationHandler = {
      kind: 'throws',
      execute: async () => { throw new Error('boom'); },
    };
    const ctx = createMinimalContext();
    const result = await pipeline.execute(handler, ctx, {});
    assert.strictEqual(result.status, 'failed');
    const errMsg = result.error instanceof Error ? result.error.message : String(result.error);
    assert.match(errMsg, /boom/);
  });

  it('catches rejected promise from handler', async () => {
    const handler: OperationHandler = {
      kind: 'rejects',
      execute: async () => Promise.reject(new Error('nope')),
    };
    const ctx = createMinimalContext();
    const result = await pipeline.execute(handler, ctx, {});
    assert.strictEqual(result.status, 'failed');
    const errMsg = result.error instanceof Error ? result.error.message : String(result.error);
    assert.match(errMsg, /nope/);
  });

  it('executes middleware in onion order', async () => {
    const order: string[] = [];
    const handler: OperationHandler<string, string> = {
      kind: 'onion',
      execute: async (_ctx, input) => {
        order.push('handler');
        return { status: 'success', data: input };
      },
    };

    pipeline.use(async (_ctx, _input, next) => {
      order.push('mw1-before');
      const res = await next();
      order.push('mw1-after');
      return res;
    });

    pipeline.use(async (_ctx, _input, next) => {
      order.push('mw2-before');
      const res = await next();
      order.push('mw2-after');
      return res;
    });

    const ctx = createMinimalContext();
    await pipeline.execute(handler, ctx, 'x');
    assert.deepStrictEqual(order, ['mw1-before', 'mw2-before', 'handler', 'mw2-after', 'mw1-after']);
  });
});

// ── Syscall & Recursion Tests ───────────────────────────────────

describe('BrudKernel recursion & invoke', () => {
  let kernel: BrudKernel;

  beforeEach(() => {
    kernel = new BrudKernel({ maxCallDepth: 3 });
  });

  it('invokes a sibling operation via context.invoke()', async () => {
    const inner: OperationHandler<void, string> = {
      kind: 'inner',
      execute: async () => ({ status: 'success', data: 'from-inner' }),
    };

    const outer: OperationHandler<string, string> = {
      kind: 'outer',
      execute: async (ctx, input) => {
        const innerRes = await ctx.invoke<void, string>('inner', undefined);
        if (innerRes.status === 'success') {
          return { status: 'success', data: `${input}-${innerRes.data}` };
        }
        return innerRes as OperationResult<string>;
      },
    };

    kernel.operations.register(inner);
    kernel.operations.register(outer);

    const result = await kernel.execute<string, string>('outer', 'wrap');
    assert.strictEqual(result.status, 'success');
    assert.strictEqual(result.data, 'wrap-from-inner');
  });

  it('halts when exceeding max recursion depth', async () => {
    let depth = 0;
    const recursive: OperationHandler<void, string> = {
      kind: 'recurse',
      execute: async (ctx) => {
        depth++;
        return ctx.invoke<void, string>('recurse', undefined);
      },
    };

    kernel.operations.register(recursive);

    const result = await kernel.execute<void, string>('recurse', undefined);
    assert.strictEqual(result.status, 'failed');
    const errMsg = result.error instanceof Error ? result.error.message : String(result.error);
    assert.match(errMsg, /Maximum call depth/);
  });
});

// ── Workspace Root Propagation Tests ────────────────────────────

describe('BrudKernel workspaceRoot', () => {
  let kernel: BrudKernel;

  beforeEach(() => {
    kernel = new BrudKernel();
  });

  it('passes workspaceRoot from options to context', async () => {
    const customRoot = '/custom/workspace/path';
    const handler: OperationHandler<void, string> = {
      kind: 'test_workspace',
      execute: async (ctx) => {
        return { status: 'success', data: ctx.workspaceRoot };
      },
    };
    kernel.operations.register(handler);
    const result = await kernel.execute<void, string>('test_workspace', undefined, { workspaceRoot: customRoot });
    assert.strictEqual(result.status, 'success');
    assert.strictEqual(result.data, customRoot);
  });

  it('child context inherits workspaceRoot from parent via invoke', async () => {
    const customRoot = '/custom/workspace/path';
    const inner: OperationHandler<void, string> = {
      kind: 'inner_workspace',
      execute: async (ctx) => {
        return { status: 'success', data: ctx.workspaceRoot };
      },
    };
    const outer: OperationHandler<void, string> = {
      kind: 'outer_workspace',
      execute: async (ctx) => {
        const innerRes = await ctx.invoke<void, string>('inner_workspace', undefined);
        if (innerRes.status === 'success') {
          return { status: 'success', data: innerRes.data };
        }
        return innerRes as OperationResult<string>;
      },
    };
    kernel.operations.register(inner);
    kernel.operations.register(outer);
    const result = await kernel.execute<void, string>('outer_workspace', undefined, { workspaceRoot: customRoot });
    assert.strictEqual(result.status, 'success');
    assert.strictEqual(result.data, customRoot);
  });
});

// ── Dynamic Prompt Tests ────────────────────────────────────────

describe('BrudKernel prompt manifest', () => {
  it('aggregates promptDescriptor from registered operations', () => {
    const kernel = new BrudKernel();

    kernel.operations.register({
      kind: 'read_file',
      promptDescriptor: {
        description: 'Read a file from disk',
        syntaxGuide: 'read_file <path>',
        examples: ['Read the contents of src/index.ts'],
      },
      execute: async () => ({ status: 'success' }),
    });

    kernel.operations.register({
      kind: 'write_file',
      promptDescriptor: {
        description: 'Write content to a file',
      },
      execute: async () => ({ status: 'success' }),
    });

    kernel.operations.register({
      kind: 'no_desc',
      execute: async () => ({ status: 'success' }),
    });

    const manifest = kernel.generatePromptManifest();
    assert.strictEqual(manifest.operations.length, 2);
    assert.strictEqual(manifest.operations[0].kind, 'read_file');
    assert.strictEqual(manifest.operations[1].kind, 'write_file');
    assert.strictEqual(manifest.operations[0].promptDescriptor.description, 'Read a file from disk');
  });

  it('returns empty manifest when no descriptors are provided', () => {
    const kernel = new BrudKernel();
    kernel.operations.register({
      kind: 'silent',
      execute: async () => ({ status: 'success' }),
    });
    const manifest = kernel.generatePromptManifest();
    assert.strictEqual(manifest.operations.length, 0);
  });
});
// ── Microkernel Lifecycle Orchestration ─────────────────────────

interface ProbeService {
  readonly id: string;
}

interface ProbeOptions {
  readonly token: ServiceToken<ProbeService>;
  readonly dependencies?: readonly ServiceToken<unknown>[];
  readonly onFactory?: (context: ServiceContext) => void;
  readonly onInitialize?: () => void;
  readonly onDispose?: () => void;
  readonly failInitialize?: boolean;
}

function probeToken(id: string): ServiceToken<ProbeService> {
  return createServiceToken<ProbeService>(id, `${id} probe`);
}

function probeDescriptor(options: ProbeOptions): ServiceDescriptor<ProbeService> {
  return {
    token: options.token,
    tier: 'core',
    dependencies: options.dependencies ?? [],
    factory: (context) => {
      options.onFactory?.(context);
      return {
        id: options.token.id,
        initialize: async () => {
          options.onInitialize?.();
          if (options.failInitialize) {
            throw new Error(`init failed: ${options.token.id}`);
          }
        },
        dispose: async () => {
          options.onDispose?.();
        },
      };
    },
  };
}

function isLifecycleError(code: string): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.ok(error instanceof LifecycleStateError);
    assert.strictEqual(error.code, code);
    return true;
  };
}

describe('BrudKernel lifecycle orchestrator', () => {
  const workspaceRoot = '/tmp/brud-kernel-lifecycle';
  const callerContext: ServiceContext = {
    callerId: 'test-suite',
    tier: 'userland',
    workspaceRoot,
  };

  it('boots services, resolves them, and shuts down cleanly', async () => {
    const kernel = new BrudKernel();
    const alpha = probeToken('alpha');
    const events: string[] = [];

    kernel.register(probeDescriptor({
      token: alpha,
      onFactory: (context) => {
        assert.strictEqual(context.callerId, 'kernel');
        assert.strictEqual(context.tier, 'core');
        assert.strictEqual(context.workspaceRoot, workspaceRoot);
        events.push('factory:alpha');
      },
      onInitialize: () => events.push('init:alpha'),
      onDispose: () => events.push('dispose:alpha'),
    }));

    assert.strictEqual(kernel.lifecycleState, 'UNINITIALIZED');
    assert.throws(
      () => kernel.requestAccess(callerContext, alpha),
      isLifecycleError('INVALID_LIFECYCLE_STATE'),
    );

    await kernel.boot({ workspaceRoot });

    assert.strictEqual(kernel.lifecycleState, 'RUNNING');
    assert.strictEqual(kernel.hasService(alpha), true);
    assert.strictEqual(kernel.requestAccess(callerContext, alpha).id, 'alpha');
    assert.deepStrictEqual(
      kernel.listServices().map((service) => ({
        id: service.id,
        tier: service.tier,
        initialized: service.initialized,
      })),
      [{ id: 'alpha', tier: 'core', initialized: true }],
    );

    await kernel.shutdown();

    assert.strictEqual(kernel.lifecycleState, 'DISPOSED');
    assert.deepStrictEqual(events, ['factory:alpha', 'init:alpha', 'dispose:alpha']);
    assert.throws(
      () => kernel.requestAccess(callerContext, alpha),
      isLifecycleError('INVALID_LIFECYCLE_STATE'),
    );
  });

  it('starts services in dependency order regardless of registration order', async () => {
    const kernel = new BrudKernel();
    const a = probeToken('a');
    const b = probeToken('b');
    const c = probeToken('c');
    const events: string[] = [];

    kernel.register(probeDescriptor({
      token: c,
      dependencies: [b],
      onFactory: () => events.push('factory:c'),
      onInitialize: () => events.push('init:c'),
    }));
    kernel.register(probeDescriptor({
      token: b,
      dependencies: [a],
      onFactory: () => events.push('factory:b'),
      onInitialize: () => events.push('init:b'),
    }));
    kernel.register(probeDescriptor({
      token: a,
      onFactory: () => events.push('factory:a'),
      onInitialize: () => events.push('init:a'),
    }));

    await kernel.boot({ workspaceRoot });

    assert.deepStrictEqual(events, [
      'factory:a',
      'init:a',
      'factory:b',
      'init:b',
      'factory:c',
      'init:c',
    ]);
  });

  it('disposes services in reverse dependency order', async () => {
    const kernel = new BrudKernel();
    const a = probeToken('a');
    const b = probeToken('b');
    const c = probeToken('c');
    const disposed: string[] = [];

    kernel.register(probeDescriptor({ token: a, onDispose: () => disposed.push('a') }));
    kernel.register(probeDescriptor({ token: b, dependencies: [a], onDispose: () => disposed.push('b') }));
    kernel.register(probeDescriptor({ token: c, dependencies: [b], onDispose: () => disposed.push('c') }));

    await kernel.boot({ workspaceRoot });
    await kernel.shutdown();

    assert.deepStrictEqual(disposed, ['c', 'b', 'a']);
  });

  it('rolls back initialized services when a later initialization fails', async () => {
    const kernel = new BrudKernel();
    const stable = probeToken('stable');
    const broken = probeToken('broken');
    const downstream = probeToken('downstream');
    const events: string[] = [];

    kernel.register(probeDescriptor({
      token: downstream,
      dependencies: [broken],
      onInitialize: () => events.push('init:downstream'),
    }));
    kernel.register(probeDescriptor({
      token: broken,
      dependencies: [stable],
      failInitialize: true,
    }));
    kernel.register(probeDescriptor({
      token: stable,
      onInitialize: () => events.push('init:stable'),
      onDispose: () => events.push('dispose:stable'),
    }));

    await assert.rejects(
      () => kernel.boot({ workspaceRoot }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /init failed: broken/);
        return true;
      },
    );

    assert.deepStrictEqual(events, ['init:stable', 'dispose:stable']);
    assert.strictEqual(kernel.lifecycleState, 'DISPOSED');
    assert.throws(
      () => kernel.register(probeDescriptor({ token: probeToken('late') })),
      isLifecycleError('INVALID_LIFECYCLE_STATE'),
    );
    assert.throws(
      () => kernel.requestAccess(callerContext, stable),
      isLifecycleError('INVALID_LIFECYCLE_STATE'),
    );
  });

  it('rejects registration after the registry is frozen by boot', async () => {
    const kernel = new BrudKernel();
    kernel.register(probeDescriptor({ token: probeToken('first') }));

    await kernel.boot({ workspaceRoot });

    assert.throws(
      () => kernel.register(probeDescriptor({ token: probeToken('second') })),
      isLifecycleError('INVALID_LIFECYCLE_STATE'),
    );
  });

  it('rejects a second boot after shutdown', async () => {
    const kernel = new BrudKernel();
    kernel.register(probeDescriptor({ token: probeToken('single') }));

    await kernel.boot({ workspaceRoot });
    await kernel.shutdown();

    await assert.rejects(
      () => kernel.boot({ workspaceRoot }),
      isLifecycleError('INVALID_LIFECYCLE_STATE'),
    );
  });

  it('rejects booting twice without shutting down first', async () => {
    const kernel = new BrudKernel();

    await kernel.boot({ workspaceRoot });

    await assert.rejects(
      () => kernel.boot({ workspaceRoot }),
      isLifecycleError('INVALID_LIFECYCLE_STATE'),
    );
  });

  it('rejects shutdown before boot', async () => {
    const kernel = new BrudKernel();

    await assert.rejects(
      () => kernel.shutdown(),
      isLifecycleError('INVALID_LIFECYCLE_STATE'),
    );
  });

  it('disposes the kernel when the dependency graph is invalid', async () => {
    const kernel = new BrudKernel();
    kernel.register(probeDescriptor({
      token: probeToken('root'),
      dependencies: [probeToken('ghost')],
    }));

    await assert.rejects(
      () => kernel.boot({ workspaceRoot }),
      (error: unknown) => {
        assert.ok(error instanceof MissingDependencyError);
        assert.strictEqual(error.missingTokenId, 'ghost');
        assert.strictEqual(error.dependentTokenId, 'root');
        return true;
      },
    );

    assert.strictEqual(kernel.lifecycleState, 'DISPOSED');
  });

  it('throws ServiceNotFoundError for unknown services after boot', async () => {
    const kernel = new BrudKernel();

    await kernel.boot({ workspaceRoot });

    assert.throws(
      () => kernel.requestAccess(callerContext, probeToken('absent')),
      (error: unknown) => {
        assert.ok(error instanceof ServiceNotFoundError);
        assert.strictEqual(error.tokenId, 'absent');
        return true;
      },
    );
  });

  it('continues disposing remaining services after one dispose rejects', async () => {
    const kernel = new BrudKernel();
    const a = probeToken('a');
    const b = probeToken('b');
    const disposed: string[] = [];

    kernel.register(probeDescriptor({
      token: a,
      onDispose: () => disposed.push('a'),
    }));
    kernel.register({
      token: b,
      tier: 'core',
      dependencies: [a],
      factory: () => ({
        id: 'b',
        async initialize() { return; },
        async dispose() { throw new Error('dispose failed: b'); },
      }),
    });

    await kernel.boot({ workspaceRoot });

    await assert.rejects(() => kernel.shutdown(), /dispose failed: b/);

    assert.deepStrictEqual(disposed, ['a']);
    assert.strictEqual(kernel.lifecycleState, 'DISPOSED');
  });
});

// ── onRunning lifecycle hook (Phase 5 C-1, G-9) ─────────────────

interface RunningProbeOptions {
  readonly token: ServiceToken<ProbeService>;
  readonly dependencies?: readonly ServiceToken<unknown>[];
  readonly events: string[];
  readonly onRunning?: (broker: IKernelAccessBroker) => Promise<void> | void;
}

function runningProbeDescriptor(options: RunningProbeOptions): ServiceDescriptor<ProbeService> {
  const id = options.token.id;

  return {
    token: options.token,
    tier: 'core',
    dependencies: options.dependencies ?? [],
    factory: () => ({
      id,
      initialize: () => {
        options.events.push(`init:${id}`);
      },
      onRunning: async (broker: IKernelAccessBroker) => {
        options.events.push(`running:${id}`);
        await options.onRunning?.(broker);
      },
      dispose: () => {
        options.events.push(`dispose:${id}`);
      },
    }),
  };
}

describe('BrudKernel onRunning hook', () => {
  const workspaceRoot = '/tmp/brud-kernel-running';
  const hookCaller: ServiceContext = { callerId: 'hook', tier: 'core', workspaceRoot };

  it('runs once per service, in dependency order, after every initialize, while RUNNING with broker access', async () => {
    const kernel = new BrudKernel();
    const a = probeToken('a');
    const b = probeToken('b');
    const events: string[] = [];
    const observedStates: string[] = [];
    let resolvedDependency: string | undefined;

    kernel.register(runningProbeDescriptor({
      token: b,
      dependencies: [a],
      events,
      onRunning: (broker) => {
        observedStates.push(kernel.lifecycleState);
        resolvedDependency = broker.requestAccess(hookCaller, a).id;
      },
    }));
    kernel.register(runningProbeDescriptor({
      token: a,
      events,
      onRunning: () => {
        observedStates.push(kernel.lifecycleState);
      },
    }));

    await kernel.boot({ workspaceRoot });

    assert.deepStrictEqual(events, ['init:a', 'init:b', 'running:a', 'running:b']);
    assert.deepStrictEqual(observedStates, ['RUNNING', 'RUNNING']);
    assert.strictEqual(resolvedDependency, 'a');
    assert.strictEqual(kernel.lifecycleState, 'RUNNING');

    await kernel.shutdown();

    assert.deepStrictEqual(events, [
      'init:a', 'init:b', 'running:a', 'running:b', 'dispose:b', 'dispose:a',
    ]);
  });

  it('rolls back to DISPOSED, disposing in reverse order, when an onRunning hook throws', async () => {
    const kernel = new BrudKernel();
    const a = probeToken('a');
    const b = probeToken('b');
    const c = probeToken('c');
    const events: string[] = [];

    kernel.register(runningProbeDescriptor({ token: a, events }));
    kernel.register(runningProbeDescriptor({
      token: b,
      dependencies: [a],
      events,
      onRunning: () => {
        throw new Error('running failed: b');
      },
    }));
    kernel.register(runningProbeDescriptor({ token: c, dependencies: [b], events }));

    await assert.rejects(
      () => kernel.boot({ workspaceRoot }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.strictEqual(error.message, 'running failed: b');
        return true;
      },
    );

    assert.deepStrictEqual(events, [
      'init:a', 'init:b', 'init:c',
      'running:a', 'running:b',
      'dispose:c', 'dispose:b', 'dispose:a',
    ]);
    assert.strictEqual(kernel.lifecycleState, 'DISPOSED');
    assert.throws(
      () => kernel.requestAccess(hookCaller, a),
      isLifecycleError('INVALID_LIFECYCLE_STATE'),
    );
    await assert.rejects(
      () => kernel.shutdown(),
      isLifecycleError('INVALID_LIFECYCLE_STATE'),
    );
  });

  it('rejects shutdown while an onRunning hook is still pending', async () => {
    const kernel = new BrudKernel();
    const a = probeToken('a');
    const events: string[] = [];
    let release: () => void = () => undefined;
    let hookEntered: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { hookEntered = resolve; });

    kernel.register(runningProbeDescriptor({
      token: a,
      events,
      onRunning: async () => {
        hookEntered();
        await gate;
      },
    }));

    const booting = kernel.boot({ workspaceRoot });
    await entered;

    await assert.rejects(
      () => kernel.shutdown(),
      isLifecycleError('INVALID_LIFECYCLE_STATE'),
    );
    assert.deepStrictEqual(events, ['init:a', 'running:a']);

    release();
    await booting;

    assert.strictEqual(kernel.lifecycleState, 'RUNNING');
    await kernel.shutdown();
    assert.deepStrictEqual(events, ['init:a', 'running:a', 'dispose:a']);
    assert.strictEqual(kernel.lifecycleState, 'DISPOSED');
  });
});
