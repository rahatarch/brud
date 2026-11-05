import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as Protocol from '@brud/protocol';
import type { RpcRequest } from '@brud/protocol';
import type {
  BrudKernel,
  IBrudToolsService,
  ServiceToken,
} from '@brud/kernel' with { 'resolution-mode': 'import' };
import type { DispatchSession, RequestDispatcher } from '../server/dispatch.js';
import { WorkspaceRegistry } from '../workspaceRegistry.js';

const TOKEN = 'connect-workspace-token-0123456789abcdef';
const PRIMARY_ROOT = join(tmpdir(), 'brud-connect-primary');

class FakeKernel {
  public lifecycleState: 'RUNNING' | 'DISPOSED' = 'RUNNING';

  public bootCount = 0;

  async boot(): Promise<void> {
    this.bootCount += 1;
    this.lifecycleState = 'RUNNING';
  }

  async shutdown(): Promise<void> {
    this.lifecycleState = 'DISPOSED';
  }

  requestAccess<TService>(): TService {
    throw new Error('not used');
  }
}

class TestSession implements DispatchSession {
  public workspaceRoot: string | undefined;

  public handshaken = false;

  constructor(public readonly connectionId: string) {}

  markHandshaken(): void {
    this.handshaken = true;
  }
}

let dispatcher: RequestDispatcher;
let registry: WorkspaceRegistry;
let spawnedRoots: string[];

function connectRequest(params: Record<string, unknown>, id: number): RpcRequest {
  return {
    jsonrpc: '2.0',
    id,
    method: Protocol.DAEMON_CONNECT,
    params,
  };
}

before(async () => {
  const kernelModule = await import('@brud/kernel');
  const { RequestDispatcher } = await import('../server/dispatch.js');

  spawnedRoots = [];
  registry = new WorkspaceRegistry({
    kernelFactory: async ({ workspaceRoot }) => {
      spawnedRoots.push(workspaceRoot);
      return new FakeKernel() as unknown as BrudKernel;
    },
  });

  dispatcher = new RequestDispatcher({
    registry,
    fileSystemToken: kernelModule.FileSystemToken as ServiceToken<never>,
    historyToken: kernelModule.UniversalHistoryToken as ServiceToken<never>,
    toolsToken: kernelModule.BrudToolsToken as ServiceToken<IBrudToolsService>,
    token: TOKEN,
    workspaceRoot: PRIMARY_ROOT,
  });
});

describe('daemon.connect workspace routing', () => {
  it('requires workspaceRoot', async () => {
    const session = new TestSession('c_missing');
    const response = await dispatcher.dispatch(
      connectRequest(
        {
          protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
          token: TOKEN,
        },
        1,
      ),
      session,
    );

    assert.ok(Protocol.isRpcErrorResponse(response));
    assert.equal(response.error.code, Protocol.INVALID_PARAMS);
    assert.equal(session.handshaken, false);
  });

  it('rejects a workspaceRoot that is not an absolute path', async () => {
    const session = new TestSession('c_relative');
    const response = await dispatcher.dispatch(
      connectRequest(
        {
          protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
          token: TOKEN,
          workspaceRoot: 'relative/workspace',
        },
        2,
      ),
      session,
    );

    assert.ok(Protocol.isRpcErrorResponse(response));
    assert.equal(response.error.code, Protocol.INVALID_PARAMS);
    assert.equal(response.error.data?.errorCode, 'INVALID_WORKSPACE_ROOT');
    assert.equal(session.handshaken, false);
  });

  it('spawns a kernel for a valid absolute workspaceRoot and attaches the client', async () => {
    const root = join(tmpdir(), 'brud-connect-workspace-a');
    const session = new TestSession('c_valid');
    const response = await dispatcher.dispatch(
      connectRequest(
        {
          protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
          token: TOKEN,
          workspaceRoot: root,
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
        3,
      ),
      session,
    );

    assert.ok(Protocol.isRpcSuccessResponse(response), JSON.stringify(response));
    const result = response.result as Protocol.DaemonHandshakeResult;
    assert.equal(result.workspaceId, root);
    assert.equal(result.workspaceRoot, root);
    assert.equal(result.kernelState, 'running');
    assert.equal(session.workspaceRoot, root);
    assert.equal(session.handshaken, true);
    assert.equal(registry.get(root)?.clients.has('c_valid'), true);
    assert.deepEqual(spawnedRoots, [root]);
  });

  it('reuses an existing workspace kernel for a second client', async () => {
    const root = join(tmpdir(), 'brud-connect-workspace-b');
    const first = new TestSession('c_reuse_1');
    const second = new TestSession('c_reuse_2');

    await dispatcher.dispatch(
      connectRequest(
        {
          protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
          token: TOKEN,
          workspaceRoot: root,
        },
        4,
      ),
      first,
    );
    const response = await dispatcher.dispatch(
      connectRequest(
        {
          protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
          token: TOKEN,
          workspaceRoot: root,
        },
        5,
      ),
      second,
    );

    assert.ok(Protocol.isRpcSuccessResponse(response));
    assert.equal(spawnedRoots.filter((entry) => entry === root).length, 1);
    assert.equal(registry.get(root)?.clients.size, 2);
  });

  it('rejects an invalid token before spawning', async () => {
    const root = join(tmpdir(), 'brud-connect-workspace-c');
    const session = new TestSession('c_bad_token');
    const response = await dispatcher.dispatch(
      connectRequest(
        {
          protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
          token: 'wrong-token',
          workspaceRoot: root,
        },
        6,
      ),
      session,
    );

    assert.ok(Protocol.isRpcErrorResponse(response));
    assert.equal(response.error.code, Protocol.AUTH_FAILED);
    assert.equal(registry.get(root), undefined);
  });
});