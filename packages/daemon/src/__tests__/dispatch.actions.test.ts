import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Protocol from '@brud/protocol';
import type { DaemonCallerTier, RpcRequest, RpcResponse } from '@brud/protocol';
import { RequestDispatcher } from '../server/dispatch.js';
import type { DispatchSession } from '../server/dispatch.js';
import { WorkspaceRegistry } from '../workspaceRegistry.js';

const TOKEN = 'dispatch-actions-token-0123456789abcdef';
const TERMINAL_LIST_PROCESSES_ACTION = 'terminal.list_processes';
const TERMINAL_KILL_PROCESS_ACTION = 'terminal.kill_process';

class TestSession implements DispatchSession {
  public workspaceRoot: string | undefined;

  public handshaken = false;

  public tier: DaemonCallerTier | undefined;

  constructor(public readonly connectionId: string) {}

  markHandshaken(): void {
    this.handshaken = true;
  }
}

let root = '';
let dispatcher: RequestDispatcher;
let registry: WorkspaceRegistry;

async function makeWorkspace(name: string): Promise<string> {
  const workspaceRoot = join(root, name);
  await mkdir(workspaceRoot, { recursive: true });

  return await realpath(workspaceRoot);
}

function connectRequest(workspaceRoot: string, id: number, tier: DaemonCallerTier): RpcRequest {
  return {
    jsonrpc: '2.0',
    id,
    method: Protocol.DAEMON_CONNECT,
    params: {
      protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
      token: TOKEN,
      workspaceRoot,
      tier,
    },
  };
}

function request(method: string, params: unknown, id: number): RpcRequest {
  return { jsonrpc: '2.0', id, method, params };
}

async function connect(
  session: TestSession,
  workspaceRoot: string,
  id: number,
  tier: DaemonCallerTier,
): Promise<void> {
  const response = await dispatcher.dispatch(connectRequest(workspaceRoot, id, tier), session);
  assert.ok(Protocol.isRpcSuccessResponse(response), JSON.stringify(response));
}

function expectSuccess(response: RpcResponse): unknown {
  assert.ok(Protocol.isRpcSuccessResponse(response), JSON.stringify(response));

  return response.result;
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'brud-dispatch-actions-'));
  const kernelModule = await import('@brud/kernel');
  registry = new WorkspaceRegistry();

  dispatcher = new RequestDispatcher({
    registry,
    toolsToken: kernelModule.BrudToolsToken,
    actionsToken: kernelModule.ActionManagerToken,
    token: TOKEN,
    workspaceRoot: await makeWorkspace('primary'),
  });
});

after(async () => {
  await registry.disposeAll();
  await rm(root, { recursive: true, force: true });
});

describe('actions.* dispatch routing', () => {
  it('lists actions for a UI caller', async () => {
    const workspaceRoot = await makeWorkspace('actions-a');
    const session = new TestSession('c_actions_a');

    await connect(session, workspaceRoot, 1, 'ui');

    const result = expectSuccess(
      await dispatcher.dispatch(request(Protocol.ACTIONS_LIST, {}, 2), session),
    ) as Protocol.ActionsListResult;

    const names = result.map((action) => action.name);
    assert.ok(
      names.includes(TERMINAL_LIST_PROCESSES_ACTION),
      `actions must come from the real terminal plugin: ${names.join(', ')}`,
    );
    assert.ok(names.includes('history.list_sessions'));
  });

  it('routes actions.execute to the caller workspace action manager', async () => {
    const workspaceRoot = await makeWorkspace('actions-b');
    const session = new TestSession('c_actions_b');

    await connect(session, workspaceRoot, 3, 'ui');

    const result = expectSuccess(
      await dispatcher.dispatch(
        request(
          Protocol.ACTIONS_EXECUTE,
          { name: TERMINAL_LIST_PROCESSES_ACTION, input: {} },
          4,
        ),
        session,
      ),
    ) as Protocol.ActionsExecuteResult;

    assert.equal(result.status, 'success', String(result.error));
    const data = result.data as { readonly processes?: readonly unknown[] };
    assert.ok(Array.isArray(data.processes), 'the real action must return its process list');
  });

  it('rejects actions.list for an AI caller with UNAUTHORIZED_TIER', async () => {
    const workspaceRoot = await makeWorkspace('actions-ai-list');
    const session = new TestSession('c_actions_ai_list');

    await connect(session, workspaceRoot, 5, 'ai');

    const response = await dispatcher.dispatch(request(Protocol.ACTIONS_LIST, {}, 6), session);

    assert.ok(Protocol.isRpcErrorResponse(response));
    assert.equal(response.error.code, -32003);
    assert.equal(response.error.message, 'UNAUTHORIZED_TIER');
    assert.equal(response.error.data?.errorCode, 'UNAUTHORIZED_TIER');
    assert.equal(response.error.data?.expected, 'ui');
    assert.equal(response.error.data?.actual, 'ai');
  });

  it('rejects actions.execute for an AI caller with UNAUTHORIZED_TIER', async () => {
    const workspaceRoot = await makeWorkspace('actions-ai-execute');
    const session = new TestSession('c_actions_ai_execute');

    await connect(session, workspaceRoot, 7, 'ai');

    const response = await dispatcher.dispatch(
      request(
        Protocol.ACTIONS_EXECUTE,
        { name: TERMINAL_KILL_PROCESS_ACTION, input: { processId: 'missing' } },
        8,
      ),
      session,
    );

    assert.ok(Protocol.isRpcErrorResponse(response));
    assert.equal(response.error.code, -32003);
    assert.equal(response.error.message, 'UNAUTHORIZED_TIER');
    assert.equal(response.error.data?.expected, 'ui');
    assert.equal(response.error.data?.actual, 'ai');
    // A reached handler would return an OperationResult; a JSON-RPC tier error
    // proves the real action manager was never invoked.
  });

  it('leaves tools.list callable by an AI caller', async () => {
    const workspaceRoot = await makeWorkspace('tools-ai');
    const session = new TestSession('c_tools_ai');

    await connect(session, workspaceRoot, 9, 'ai');

    const result = expectSuccess(
      await dispatcher.dispatch(request(Protocol.TOOLS_LIST, {}, 10), session),
    ) as Protocol.ToolsListResult;

    const names = result.tools.map((tool) => tool.name);
    assert.ok(names.length > 0, 'the real plugin set must register tools');
    assert.ok(names.includes('read_file'));
  });
});