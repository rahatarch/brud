import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createStandardKernel } from '../../src/bootstrap/index.js';
import type { ServiceContext } from '../../src/contracts/lifecycle.js';
import { createServiceToken } from '../../src/contracts/serviceToken.js';
import type { BrudKernel } from '../../src/engine/BrudKernel.js';
import type { IActionManager } from '../../services/ActionManager/contracts/IActionManager.js';
import { ActionManagerToken } from '../../services/ActionManager/descriptor/tokens.js';
import type { IBrudToolsService } from '../../services/BrudTools/contracts/IBrudToolsService.js';
import { BrudToolsToken } from '../../services/BrudTools/descriptor/tokens.js';
import type { IBrudParserService } from '../../services/Parser/contracts/IParserService.js';
import { ParserToken } from '../../services/Parser/descriptor/tokens.js';
import type { IRouterService } from '../../services/Router/contracts/IRouterService.js';
import { RouterKindCollisionError, RouterRegistrationClosedError } from '../../services/Router/contracts/errors.js';
import { RouterToken } from '../../services/Router/descriptor/tokens.js';
import {
  TEST_QUERY_KIND,
  TEST_QUERY_PLUGIN_ID,
  TestQueryToken,
  createDynamicRoutingPlugin,
  createTestQueryDescriptor,
  type DynamicRoutingProbe,
  type ITestQueryService,
  type TestQueryBinding,
} from './support/testQueryService.js';
import { workspaceContextOptions } from './support/workspaceContext.js';

const ROGUE_QUERY_TOKEN = createServiceToken<ITestQueryService>(
  'test.peer.query.rogue',
  'Second synthetic service that contests the test_query kind',
);

const PEER_DOCUMENT = brud(
  call('test_query', 'peer_query_echo', 'text: hello peer'),
);

interface PrepareOptions {
  readonly withService?: boolean;
  readonly withPlugin?: boolean;
  readonly rogue?: boolean;
}

interface PreparedKernel {
  readonly kernel: BrudKernel;
  readonly root: string;
  readonly binding: TestQueryBinding;
  readonly rogueBinding: TestQueryBinding;
  readonly probe: DynamicRoutingProbe;
}

function caller(root: string): ServiceContext {
  return { callerId: 'kernel', tier: 'core', options: {...workspaceContextOptions(root)} };
}

function brud(...blocks: readonly string[]): string {
  return ['[BRUD]', ...blocks, '[/BRUD]'].join('\n');
}

function call(kind: string, name: string, ...body: readonly string[]): string {
  return [`[CALL ${kind} ${name}]`, ...body, '[END]'].join('\n');
}

async function prepare(
  t: TestContext,
  options: PrepareOptions,
): Promise<PreparedKernel> {
  const root = await mkdtemp(join(tmpdir(), 'brud-dynamic-routing-'));
  const binding: TestQueryBinding = {};
  const rogueBinding: TestQueryBinding = {};
  const probe: DynamicRoutingProbe = { calls: [], registered: [] };
  const initialPlugins = options.withPlugin === true
    ? [createDynamicRoutingPlugin(binding, probe)]
    : [];
  const kernel = createStandardKernel({
    history: { inMemory: true },
    initialPlugins,
  });

  if (options.withService !== false) {
    kernel.register(createTestQueryDescriptor({ binding }));
  }

  if (options.rogue === true) {
    kernel.register(createTestQueryDescriptor({
      binding: rogueBinding,
      token: ROGUE_QUERY_TOKEN,
      kind: TEST_QUERY_KIND,
    }));
  }

  t.after(async () => {
    if (kernel.lifecycleState === 'RUNNING') {
      await kernel.shutdown().catch(() => undefined);
    }

    await rm(root, { recursive: true, force: true });
  });

  return { kernel, root, binding, rogueBinding, probe };
}

async function compose(
  t: TestContext,
  options: PrepareOptions,
): Promise<PreparedKernel> {
  const prepared = await prepare(t, options);

  await prepared.kernel.boot({ options: {...workspaceContextOptions(prepared.root)} });

  return prepared;
}

describe('Dynamic routing with a synthetic peer service and plugin', () => {
  it('Parser emits kind: test_query for [CALL test_query <operation>]', async (t) => {
    const { kernel, root } = await compose(t, { withPlugin: true });
    const parser = kernel.requestAccess<IBrudParserService>(caller(root), ParserToken);

    const parsed = parser.parse(PEER_DOCUMENT);

    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }

    assert.equal(parsed.operations.length, 1);
    assert.deepEqual(parsed.operations[0], {
      index: '1',
      kind: TEST_QUERY_KIND,
      name: 'peer_query_echo',
      parameters: { text: 'hello peer' },
    });
  });

  it('Router dispatches test_query to TestQueryService and invokes the plugin handler', async (t) => {
    const { kernel, root, binding, probe } = await compose(t, { withPlugin: true });
    const router = kernel.requestAccess<IRouterService>(caller(root), RouterToken);
    const parser = kernel.requestAccess<IBrudParserService>(caller(root), ParserToken);
    const tools = kernel.requestAccess<IBrudToolsService>(caller(root), BrudToolsToken);
    const actions = kernel.requestAccess<IActionManager>(caller(root), ActionManagerToken);
    const service = kernel.requestAccess<ITestQueryService>(caller(root), TestQueryToken);

    assert.ok(router.registeredKinds().includes(TEST_QUERY_KIND));
    assert.deepEqual(
      [...router.registeredKinds()].sort(),
      ['action', 'test_query', 'tool'],
    );
    assert.equal(router.isRegistrationOpen(), false);

    const parsed = parser.parse(PEER_DOCUMENT);
    assert.equal(parsed.ok, true);

    // The operation name exists only in the synthetic registry.
    assert.equal(tools.getTool('peer_query_echo'), undefined);
    assert.equal(actions.getAction('peer_query_echo'), undefined);
    assert.equal(binding.service?.getQuery('peer_query_echo')?.name, 'peer_query_echo');
    assert.deepEqual(service.listQueries(), [
      'peer_query_echo',
      'peer_query_fail',
      'peer_query_throw',
    ]);
    assert.deepEqual(probe.registered, [
      'peer_query_echo',
      'peer_query_fail',
      'peer_query_throw',
    ]);

    const result = await router.route(PEER_DOCUMENT, {
      callerId: 'route.client',
      workspaceRoot: root,
    });

    assert.equal(result.status, 'success');
    assert.equal(result.dispatched, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.operations[0]?.kind, TEST_QUERY_KIND);
    assert.equal(result.operations[0]?.name, 'peer_query_echo');
    assert.equal(result.operations[0]?.status, 'success');
    assert.deepEqual(result.operations[0]?.result?.data, {
      route: 'test_query',
      text: 'hello peer',
      pluginId: TEST_QUERY_PLUGIN_ID,
      callerId: 'route.client',
    });
    assert.deepEqual(probe.calls, ['test_query:peer_query_echo']);
  });

  it('a second service claiming test_query fails boot and leaves the kernel DISPOSED', async (t) => {
    const { kernel, root } = await prepare(t, { withService: true, rogue: true });

    await assert.rejects(
      kernel.boot({ options: {...workspaceContextOptions(root)} }),
      (error: unknown) => {
        assert.ok(error instanceof RouterKindCollisionError);
        assert.equal(error.code, 'ROUTER_KIND_COLLISION');
        assert.equal(error.kind, TEST_QUERY_KIND);
        assert.equal(error.existingTokenId, TestQueryToken.id);
        return true;
      },
    );

    assert.equal(kernel.lifecycleState, 'DISPOSED');
  });

  it('late kind registration is rejected with ROUTER_REGISTRATION_CLOSED', async (t) => {
    const { kernel, root, binding } = await compose(t, { withPlugin: true });
    const router = kernel.requestAccess<IRouterService>(caller(root), RouterToken);
    const service = binding.service;

    assert.ok(service);
    assert.equal(router.isRegistrationOpen(), false);

    assert.throws(
      () => service.registerAdditionalKind(router, 'late_test_query'),
      (error: unknown) => {
        assert.ok(error instanceof RouterRegistrationClosedError);
        assert.equal(error.code, 'ROUTER_REGISTRATION_CLOSED');
        assert.equal(error.kind, 'late_test_query');
        return true;
      },
    );
  });

  it('an unregistered kind parses but routes as kind_not_registered', async (t) => {
    const { kernel, root } = await compose(t, {
      withService: false,
      withPlugin: false,
    });
    const parser = kernel.requestAccess<IBrudParserService>(caller(root), ParserToken);
    const router = kernel.requestAccess<IRouterService>(caller(root), RouterToken);

    const parsed = parser.parse(PEER_DOCUMENT);

    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    assert.equal(parsed.operations[0]?.kind, TEST_QUERY_KIND);
    assert.equal(router.registeredKinds().includes(TEST_QUERY_KIND), false);

    const result = await router.route(PEER_DOCUMENT, {
      callerId: 'route.client',
      workspaceRoot: root,
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.dispatched, 0);
    assert.equal(result.failed, 1);
    assert.equal(result.operations[0]?.status, 'kind_not_registered');
    assert.match(
      String(result.operations[0]?.error),
      /^KIND_NOT_REGISTERED: kind "test_query"/,
    );
  });

  it('a throwing plugin handler returns a stable failure through the chain', async (t) => {
    const { kernel, root, probe } = await compose(t, { withPlugin: true });
    const router = kernel.requestAccess<IRouterService>(caller(root), RouterToken);
    const document = brud(call('test_query', 'peer_query_throw'));

    const result = await router.route(document, {
      callerId: 'route.client',
      workspaceRoot: root,
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.dispatched, 1);
    assert.equal(result.failed, 1);

    const outcome = result.operations[0];

    assert.equal(outcome?.kind, TEST_QUERY_KIND);
    assert.equal(outcome?.status, 'failed');
    assert.equal(outcome?.error, undefined);
    assert.equal(outcome?.result?.status, 'failed');
    assert.match(
      String(outcome?.result?.error),
      /^TEST_QUERY_HANDLER_ERROR: query handler boom$/,
    );
    assert.equal(/\n\s+at /.test(String(outcome?.result?.error)), false);
    assert.deepEqual(probe.calls, ['test_query:peer_query_throw']);
  });

  it('routes tool, action, and test_query together in document order', async (t) => {
    const { kernel, root, probe } = await compose(t, { withPlugin: true });
    const router = kernel.requestAccess<IRouterService>(caller(root), RouterToken);
    const document = brud(
      call('tool', 'peer_tool_echo', 'text: tool payload'),
      call('action', 'peer_action_echo', 'message: action payload'),
      call('test_query', 'peer_query_echo', 'text: query payload'),
    );

    const result = await router.route(document, {
      callerId: 'mixed.client',
      workspaceRoot: root,
    });

    assert.equal(result.status, 'success');
    assert.equal(result.dispatched, 3);
    assert.equal(result.failed, 0);
    assert.deepEqual(
      result.operations.map((operation) => [
        operation.sequence,
        operation.kind,
        operation.name,
        operation.status,
      ]),
      [
        [0, 'tool', 'peer_tool_echo', 'success'],
        [1, 'action', 'peer_action_echo', 'success'],
        [2, 'test_query', 'peer_query_echo', 'success'],
      ],
    );
    assert.deepEqual(
      result.operations.map((operation) => operation.result?.data),
      [
        { route: 'tool', text: 'tool payload', pluginId: TEST_QUERY_PLUGIN_ID },
        {
          route: 'action',
          message: 'action payload',
          pluginId: TEST_QUERY_PLUGIN_ID,
          callerId: 'mixed.client',
        },
        {
          route: 'test_query',
          text: 'query payload',
          pluginId: TEST_QUERY_PLUGIN_ID,
          callerId: 'mixed.client',
        },
      ],
    );
    assert.deepEqual(probe.calls, [
      'tool:peer_tool_echo',
      'action:peer_action_echo',
      'test_query:peer_query_echo',
    ]);
  });

  it('a failing test_query alongside a successful tool yields a partial result', async (t) => {
    const { kernel, root, probe } = await compose(t, { withPlugin: true });
    const router = kernel.requestAccess<IRouterService>(caller(root), RouterToken);
    const document = brud(
      call('tool', 'peer_tool_echo', 'text: must succeed'),
      call('test_query', 'peer_query_fail', 'reason: must fail'),
    );

    const result = await router.route(document, {
      callerId: 'partial.client',
      workspaceRoot: root,
    });

    assert.equal(result.status, 'partial');
    assert.equal(result.dispatched, 2);
    assert.equal(result.failed, 1);
    assert.equal(result.operations[0]?.kind, 'tool');
    assert.equal(result.operations[0]?.status, 'success');
    assert.equal(result.operations[0]?.result?.status, 'success');
    assert.equal(result.operations[1]?.kind, TEST_QUERY_KIND);
    assert.equal(result.operations[1]?.status, 'failed');
    assert.equal(result.operations[1]?.result?.status, 'failed');
    assert.match(
      String(result.operations[1]?.result?.error),
      /^TEST_QUERY_EXPECTED_FAILURE$/,
    );
    assert.deepEqual(probe.calls, [
      'tool:peer_tool_echo',
      'test_query:peer_query_fail',
    ]);
  });
});
