import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as Protocol from '@brud/protocol';
import type { DaemonCallerTier, RpcRequest, RpcResponse } from '@brud/protocol';
import type {
  BrudKernel,
  IBrudToolsService,
  IPluginExecutionContext,
  OperationResult,
  RegisteredToolInfo,
  ServiceContext,
  ServiceToken,
} from '@brud/kernel' with { 'resolution-mode': 'import' };
import type { DispatchSession, RequestDispatcher } from '../server/dispatch.js';
import { WorkspaceRegistry } from '../workspaceRegistry.js';

const TOKEN = 'dispatch-tools-token-0123456789abcdef';
const PRIMARY_ROOT = join(tmpdir(), 'brud-dispatch-primary');

interface ExecutedCall {
  readonly name: string;
  readonly input: unknown;
  readonly context: IPluginExecutionContext;
}

class FakeToolsService implements IBrudToolsService {
  readonly calls: ExecutedCall[] = [];

  constructor(private readonly toolName: string) {}

  registerTool(): never {
    throw new Error('not used');
  }

  getTool(): RegisteredToolInfo | undefined {
    return undefined;
  }

  listTools(): readonly RegisteredToolInfo[] {
    return [
      {
        name: this.toolName,
        description: `Tool from ${this.toolName}`,
        parametersSchema: { type: 'object' },
        ownerPluginId: `owner.${this.toolName}`,
        isOfficial: true,
      },
    ];
  }

  validateTool(
    _name: string,
    _rawInput: unknown,
    _callerContext: IPluginExecutionContext,
  ): OperationResult {
    return { status: 'success' };
  }

  async executeTool(
    name: string,
    rawInput: unknown,
    callerContext: IPluginExecutionContext,
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

class FakeKernel {
  public readonly tools: FakeToolsService;

  public lifecycleState: 'RUNNING' | 'DISPOSED' = 'RUNNING';

  constructor(public readonly root: string) {
    this.tools = new FakeToolsService(`tool:${root}`);
  }

  async boot(): Promise<void> {
    this.lifecycleState = 'RUNNING';
  }

  async shutdown(): Promise<void> {
    this.lifecycleState = 'DISPOSED';
  }

  requestAccess<TService>(_caller: ServiceContext, _token: ServiceToken<TService>): TService {
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
let toolsToken: ServiceToken<IBrudToolsService>;

function connectRequest(root: string, id: number): RpcRequest {
  return {
    jsonrpc: '2.0',
    id,
    method: Protocol.DAEMON_CONNECT,
    params: {
      protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
      token: TOKEN,
      workspaceRoot: root,
      tier: 'ui',
    },
  };
}

function request(method: string, params: unknown, id: number): RpcRequest {
  return { jsonrpc: '2.0', id, method, params };
}

async function connect(session: TestSession, root: string, id: number): Promise<void> {
  const response = await dispatcher.dispatch(connectRequest(root, id), session);
  assert.ok(Protocol.isRpcSuccessResponse(response), JSON.stringify(response));
}

function expectSuccess(response: RpcResponse): unknown {
  assert.ok(Protocol.isRpcSuccessResponse(response), JSON.stringify(response));

  return response.result;
}

before(async () => {
  const kernelModule = await import('@brud/kernel');
  const { RequestDispatcher } = await import('../server/dispatch.js');

  toolsToken = kernelModule.BrudToolsToken;

  registry = new WorkspaceRegistry({
    kernelFactory: async ({ workspaceRoot }) =>
      new FakeKernel(workspaceRoot) as unknown as BrudKernel,
  });

  dispatcher = new RequestDispatcher({
    registry,
    toolsToken,
    token: TOKEN,
    workspaceRoot: PRIMARY_ROOT,
  });
});

describe('tools.* dispatch routing', () => {
  it('lists tools from the caller workspace', async () => {
    const root = join(tmpdir(), 'brud-dispatch-tools-a');
    const session = new TestSession('c_tools_a');

    await connect(session, root, 1);

    const result = expectSuccess(
      await dispatcher.dispatch(request(Protocol.TOOLS_LIST, {}, 2), session),
    ) as Protocol.ToolsListResult;

    assert.deepEqual(result.tools.map((tool) => tool.name), [`tool:${root}`]);
  });

  it('routes tools.execute to the caller workspace kernel', async () => {
    const root = join(tmpdir(), 'brud-dispatch-tools-b');
    const session = new TestSession('c_tools_b');

    await connect(session, root, 3);

    const result = expectSuccess(
      await dispatcher.dispatch(
        request(
          Protocol.TOOLS_EXECUTE,
          { name: `tool:${root}`, input: { value: 42 } },
          4,
        ),
        session,
      ),
    ) as Protocol.ToolsExecuteResult;

    assert.equal(result.result.status, 'success');
    assert.deepEqual(result.result.data, {
      workspaceRoot: root,
      name: `tool:${root}`,
      input: { value: 42 },
      origin: 'daemon-rpc',
    });

    const kernel = registry.get(root)?.kernel as unknown as FakeKernel;
    assert.equal(kernel.tools.calls.length, 1);
    assert.equal(kernel.tools.calls[0]?.context.callerId, 'c_tools_b');
    assert.equal(kernel.tools.calls[0]?.context.origin, 'daemon-rpc');
  });

  it('gives two clients in two workspaces different tools and kernels', async () => {
    const rootA = join(tmpdir(), 'brud-dispatch-tools-c');
    const rootB = join(tmpdir(), 'brud-dispatch-tools-d');
    const sessionA = new TestSession('c_tools_c');
    const sessionB = new TestSession('c_tools_d');

    await connect(sessionA, rootA, 5);
    await connect(sessionB, rootB, 6);

    const listA = expectSuccess(
      await dispatcher.dispatch(request(Protocol.TOOLS_LIST, {}, 7), sessionA),
    ) as Protocol.ToolsListResult;
    const listB = expectSuccess(
      await dispatcher.dispatch(request(Protocol.TOOLS_LIST, {}, 8), sessionB),
    ) as Protocol.ToolsListResult;

    assert.deepEqual(listA.tools.map((tool) => tool.name), [`tool:${rootA}`]);
    assert.deepEqual(listB.tools.map((tool) => tool.name), [`tool:${rootB}`]);
    assert.notEqual(
      registry.get(rootA)?.kernel,
      registry.get(rootB)?.kernel,
      'each workspace must own an independent kernel',
    );
  });
});