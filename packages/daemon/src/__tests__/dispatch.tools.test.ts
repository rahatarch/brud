import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Protocol from '@brud/protocol';
import type { DaemonCallerTier, RpcRequest, RpcResponse } from '@brud/protocol';
import { RequestDispatcher } from '../server/dispatch.js';
import type { DispatchSession } from '../server/dispatch.js';
import { WorkspaceRegistry } from '../workspaceRegistry.js';


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

function connectRequest(id: number): RpcRequest {
  return {
    jsonrpc: '2.0',
    id,
    method: Protocol.DAEMON_CONNECT,
    params: {
      protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
    },
  };
}

function request(method: string, params: unknown, id: number): RpcRequest {
  return { jsonrpc: '2.0', id, method, params };
}

async function connect(session: TestSession, workspaceRoot: string, id: number): Promise<void> {
  session.workspaceRoot = workspaceRoot;
  session.tier = 'ui';
  const response = await dispatcher.dispatch(connectRequest(id), session);
  assert.ok(Protocol.isRpcSuccessResponse(response), JSON.stringify(response));
}

function expectSuccess(response: RpcResponse): unknown {
  assert.ok(Protocol.isRpcSuccessResponse(response), JSON.stringify(response));

  return response.result;
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'brud-dispatch-tools-'));
  const kernelModule = await import('@brud/kernel');
  registry = new WorkspaceRegistry();

  dispatcher = new RequestDispatcher({
    registry,
    toolsToken: kernelModule.BrudToolsToken,
    workspaceRoot: await makeWorkspace('primary'),
  });
});

after(async () => {
  await registry.disposeAll();
  await rm(root, { recursive: true, force: true });
});

describe('tools.* dispatch routing', () => {
  it('lists tools from the caller workspace', async () => {
    const workspaceRoot = await makeWorkspace('tools-a');
    const session = new TestSession('c_tools_a');

    await connect(session, workspaceRoot, 1);

    const result = expectSuccess(
      await dispatcher.dispatch(request(Protocol.TOOLS_LIST, {}, 2), session),
    ) as Protocol.ToolsListResult;

    const names = result.tools.map((tool) => tool.name);
    assert.ok(names.includes('read_file'), `real tools must be listed: ${names.join(', ')}`);
  });

  it('routes tools.execute to the caller workspace kernel', async () => {
    const workspaceRoot = await makeWorkspace('tools-b');
    await writeFile(join(workspaceRoot, 'payload.txt'), 'dispatch routed payload', 'utf8');
    const session = new TestSession('c_tools_b');

    await connect(session, workspaceRoot, 3);

    const result = expectSuccess(
      await dispatcher.dispatch(
        request(
          Protocol.TOOLS_EXECUTE,
          { name: 'read_file', input: { filePath: 'payload.txt' } },
          4,
        ),
        session,
      ),
    ) as Protocol.ToolsExecuteResult;

    assert.equal(result.result.status, 'success', String(result.result.error));
    const data = result.result.data as {
      readonly files?: readonly { readonly content?: string }[];
    };
    assert.equal(data.files?.[0]?.content, 'dispatch routed payload');
  });

  it('gives two clients in two workspaces independent kernels and workspace-scoped tools', async () => {
    const rootA = await makeWorkspace('tools-c');
    const rootB = await makeWorkspace('tools-d');
    await writeFile(join(rootA, 'only-a.txt'), 'workspace A payload', 'utf8');
    await writeFile(join(rootB, 'only-b.txt'), 'workspace B payload', 'utf8');
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

    // Tool names come from the shared production plugin config, so both
    // workspaces expose the same tool set. What must differ is the kernel and
    // the workspace each tool operates on.
    assert.deepEqual(
      listA.tools.map((tool) => tool.name).sort(),
      listB.tools.map((tool) => tool.name).sort(),
    );
    assert.notEqual(
      registry.get(rootA)?.kernel,
      registry.get(rootB)?.kernel,
      'each workspace must own an independent kernel',
    );

    const readA = expectSuccess(
      await dispatcher.dispatch(
        request(Protocol.TOOLS_EXECUTE, { name: 'read_file', input: { filePath: 'only-a.txt' } }, 9),
        sessionA,
      ),
    ) as Protocol.ToolsExecuteResult;
    const readB = expectSuccess(
      await dispatcher.dispatch(
        request(Protocol.TOOLS_EXECUTE, { name: 'read_file', input: { filePath: 'only-b.txt' } }, 10),
        sessionB,
      ),
    ) as Protocol.ToolsExecuteResult;

    const dataA = readA.result.data as { readonly files?: readonly { readonly content?: string }[] };
    const dataB = readB.result.data as { readonly files?: readonly { readonly content?: string }[] };
    assert.equal(dataA.files?.[0]?.content, 'workspace A payload');
    assert.equal(dataB.files?.[0]?.content, 'workspace B payload');
  });
});