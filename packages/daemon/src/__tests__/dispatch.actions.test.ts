import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as Protocol from '@brud/protocol';
import type { DaemonCallerTier, RpcRequest, RpcResponse } from '@brud/protocol';
import type {
  BrudKernel,
  IActionDisposable,
  IActionExecutionContext,
  IActionManager,
  IBrudToolsService,
  OperationResult,
  RegisteredActionInfo,
  RegisteredToolInfo,
  ServiceContext,
  ServiceToken,
} from '@brud/kernel' with { 'resolution-mode': 'import' };
import type { DispatchSession, RequestDispatcher } from '../server/dispatch.js';
import { WorkspaceRegistry } from '../workspaceRegistry.js';

const TOKEN = 'dispatch-actions-token-0123456789abcdef';
const PRIMARY_ROOT = join(tmpdir(), 'brud-dispatch-actions-primary');

interface ExecutedActionCall {
  readonly name: string;
  readonly input: unknown;
  readonly context: IActionExecutionContext;
}

class FakeActionsService implements IActionManager {
  readonly calls: ExecutedActionCall[] = [];

  constructor(private readonly actionName: string) {}

  registerAction(): IActionDisposable {
    throw new Error('not used');
  }

  getAction(): RegisteredActionInfo | undefined {
    return undefined;
  }

  listActions(): readonly RegisteredActionInfo[] {
    return [
      {
        name: this.actionName,
        description: `Action from ${this.actionName}`,
        parametersSchema: { type: 'object' },
        ownerPluginId: `owner.${this.actionName}`,
      },
    ];
  }

  validateAction(_name: string, _rawInput: unknown): OperationResult {
    return { status: 'success' };
  }

  async executeAction(
    name: string,
    rawInput: unknown,
    callerContext: IActionExecutionContext,
  ): Promise<OperationResult> {
    this.calls.push({ name, input: rawInput, context: callerContext });

    return {
      status: 'success',
      data: {
        workspaceRoot: callerContext.workspaceRoot,
        name,
        input: rawInput,
        origin: callerContext.origin,
      },
    };
  }
}

class FakeToolsService implements IBrudToolsService {
  registerTool(): never {
    throw new Error('not used');
  }

  getTool(): RegisteredToolInfo | undefined {
    return undefined;
  }

  listTools(): readonly RegisteredToolInfo[] {
    return [];
  }

  validateTool(): OperationResult {
    return { status: 'success' };
  }

  async executeTool(): Promise<OperationResult> {
    return { status: 'success' };
  }
}

class FakeKernel {
  public readonly actions: FakeActionsService;

  public readonly tools = new FakeToolsService();

  public lifecycleState: 'UNINITIALIZED' | 'RUNNING' | 'DISPOSED' = 'UNINITIALIZED';

  constructor(private readonly root: string) {
    this.actions = new FakeActionsService(`action:${root}`);
  }

  async boot(): Promise<void> {
    this.lifecycleState = 'RUNNING';
  }

  async shutdown(): Promise<void> {
    this.lifecycleState = 'DISPOSED';
  }

  requestAccess<TService>(_caller: ServiceContext, token: ServiceToken<TService>): TService {
    if (token.id === 'brud.core.actions') {
      return this.actions as unknown as TService;
    }

    return this.tools as unknown as TService;
  }
}

class TestSession implements DispatchSession {
  public workspaceRoot: string | undefined;

  public handshaken = false;

  public tier: DaemonCallerTier | undefined;

  constructor(public readonly connectionId: string) {}

  markHandshaken(): void {
    this.handshaken = true;
  }
}

let dispatcher: RequestDispatcher;
let registry: WorkspaceRegistry;

function connectRequest(root: string, id: number, tier: DaemonCallerTier): RpcRequest {
  return {
    jsonrpc: '2.0',
    id,
    method: Protocol.DAEMON_CONNECT,
    params: {
      protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
      token: TOKEN,
      workspaceRoot: root,
      tier,
    },
  };
}

function request(method: string, params: unknown, id: number): RpcRequest {
  return { jsonrpc: '2.0', id, method, params };
}

async function connect(
  session: TestSession,
  root: string,
  id: number,
  tier: DaemonCallerTier,
): Promise<void> {
  const response = await dispatcher.dispatch(connectRequest(root, id, tier), session);
  assert.ok(Protocol.isRpcSuccessResponse(response), JSON.stringify(response));
}

function expectSuccess(response: RpcResponse): unknown {
  assert.ok(Protocol.isRpcSuccessResponse(response), JSON.stringify(response));

  return response.result;
}

before(async () => {
  const kernelModule = await import('@brud/kernel');
  const { RequestDispatcher } = await import('../server/dispatch.js');

  registry = new WorkspaceRegistry({
    kernelFactory: async ({ workspaceRoot }) =>
      new FakeKernel(workspaceRoot) as unknown as BrudKernel,
  });

  dispatcher = new RequestDispatcher({
    registry,
    toolsToken: kernelModule.BrudToolsToken,
    actionsToken: kernelModule.ActionManagerToken,
    token: TOKEN,
    workspaceRoot: PRIMARY_ROOT,
  });
});

describe('actions.* dispatch routing', () => {
  it('lists actions for a UI caller', async () => {
    const root = join(tmpdir(), 'brud-dispatch-actions-a');
    const session = new TestSession('c_actions_a');

    await connect(session, root, 1, 'ui');

    const result = expectSuccess(
      await dispatcher.dispatch(request(Protocol.ACTIONS_LIST, {}, 2), session),
    ) as Protocol.ActionsListResult;

    assert.deepEqual(result.map((action) => action.name), [`action:${root}`]);
  });

  it('routes actions.execute to the caller workspace action manager', async () => {
    const root = join(tmpdir(), 'brud-dispatch-actions-b');
    const session = new TestSession('c_actions_b');

    await connect(session, root, 3, 'ui');

    const result = expectSuccess(
      await dispatcher.dispatch(
        request(
          Protocol.ACTIONS_EXECUTE,
          { name: `action:${root}`, input: { value: 42 } },
          4,
        ),
        session,
      ),
    ) as Protocol.ActionsExecuteResult;

    assert.equal(result.status, 'success');
    assert.deepEqual(result.data, {
      workspaceRoot: root,
      name: `action:${root}`,
      input: { value: 42 },
      origin: 'daemon-rpc',
    });

    const kernel = registry.get(root)?.kernel as unknown as FakeKernel;
    assert.equal(kernel.actions.calls.length, 1);
    assert.equal(kernel.actions.calls[0]?.context.callerId, 'c_actions_b');
    assert.equal(kernel.actions.calls[0]?.context.origin, 'daemon-rpc');
  });

  it('rejects actions.list for an AI caller with UNAUTHORIZED_TIER', async () => {
    const root = join(tmpdir(), 'brud-dispatch-actions-ai-list');
    const session = new TestSession('c_actions_ai_list');

    await connect(session, root, 5, 'ai');

    const response = await dispatcher.dispatch(request(Protocol.ACTIONS_LIST, {}, 6), session);

    assert.ok(Protocol.isRpcErrorResponse(response));
    assert.equal(response.error.code, -32003);
    assert.equal(response.error.message, 'UNAUTHORIZED_TIER');
    assert.equal(response.error.data?.errorCode, 'UNAUTHORIZED_TIER');
    assert.equal(response.error.data?.expected, 'ui');
    assert.equal(response.error.data?.actual, 'ai');
  });

  it('rejects actions.execute for an AI caller with UNAUTHORIZED_TIER', async () => {
    const root = join(tmpdir(), 'brud-dispatch-actions-ai-execute');
    const session = new TestSession('c_actions_ai_execute');

    await connect(session, root, 7, 'ai');

    const response = await dispatcher.dispatch(
      request(Protocol.ACTIONS_EXECUTE, { name: `action:${root}`, input: {} }, 8),
      session,
    );

    assert.ok(Protocol.isRpcErrorResponse(response));
    assert.equal(response.error.code, -32003);
    assert.equal(response.error.message, 'UNAUTHORIZED_TIER');
    assert.equal(response.error.data?.expected, 'ui');
    assert.equal(response.error.data?.actual, 'ai');

    const kernel = registry.get(root)?.kernel as unknown as FakeKernel;
    assert.equal(kernel.actions.calls.length, 0, 'an AI caller must never reach the handler');
  });

  it('leaves tools.list callable by an AI caller', async () => {
    const root = join(tmpdir(), 'brud-dispatch-tools-ai');
    const session = new TestSession('c_tools_ai');

    await connect(session, root, 9, 'ai');

    const result = expectSuccess(
      await dispatcher.dispatch(request(Protocol.TOOLS_LIST, {}, 10), session),
    ) as Protocol.ToolsListResult;

    assert.deepEqual(result.tools, []);
  });
});