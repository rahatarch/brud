import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ServiceContainer, OperationRegistry, ExecutionPipeline, BrudKernel } from '../engine/index.js';
import { createToken } from '../contracts/container.js';
import type { ExecutionContext } from '../contracts/context.js';
import type { OperationHandler, OperationResult } from '../contracts/handler.js';
import type { Token } from '../contracts/container.js';

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