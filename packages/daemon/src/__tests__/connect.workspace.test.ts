import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as Protocol from '@brud/protocol';
import type { DaemonCallerTier, RpcRequest } from '@brud/protocol';
import type {
  IBrudToolsService,
  ServiceToken,
} from '@brud/kernel' with { 'resolution-mode': 'import' };
import type { DispatchSession, RequestDispatcher } from '../server/dispatch.js';
import { RequestDispatcher as Dispatcher } from '../server/dispatch.js';
import { WorkspaceRegistry } from '../workspaceRegistry.js';

const TOKEN = 'connect-workspace-token-0123456789abcdef';

class TestSession implements DispatchSession {
  public workspaceRoot: string | undefined;

  public handshaken = false;

  public tier: DaemonCallerTier | undefined;

  constructor(public readonly connectionId: string) {}

  markHandshaken(): void {
    this.handshaken = true;
  }
}

let baseRoot = '';
let primaryRoot = '';
let dispatcher: RequestDispatcher;
let registry: WorkspaceRegistry;

async function makeWorkspace(name: string): Promise<string> {
  const root = join(baseRoot, name);
  await mkdir(root, { recursive: true });

  return await realpath(root);
}

function connectRequest(params: Record<string, unknown>, id: number): RpcRequest {
  return {
    jsonrpc: '2.0',
    id,
    method: Protocol.DAEMON_CONNECT,
    // Existing fixtures are UI callers unless a test overrides the tier.
    params: { tier: 'ui', ...params },
  };
}

before(async () => {
  baseRoot = await mkdtemp(join(tmpdir(), 'brud-connect-'));
  primaryRoot = await makeWorkspace('primary');
  const kernelModule = await import('@brud/kernel');
  registry = new WorkspaceRegistry();

  dispatcher = new Dispatcher({
    registry,
    toolsToken: kernelModule.BrudToolsToken as ServiceToken<IBrudToolsService>,
    token: TOKEN,
    workspaceRoot: primaryRoot,
  });
});

after(async () => {
  await registry.disposeAll();
  await rm(baseRoot, { recursive: true, force: true });
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

  it('rejects a handshake that omits tier', async () => {
    const session = new TestSession('c_missing_tier');
    const response = await dispatcher.dispatch(
      {
        jsonrpc: '2.0',
        id: 10,
        method: Protocol.DAEMON_CONNECT,
        params: {
          protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
          token: TOKEN,
          workspaceRoot: await makeWorkspace('missing-tier'),
        },
      },
      session,
    );

    assert.ok(Protocol.isRpcErrorResponse(response));
    assert.equal(response.error.code, Protocol.INVALID_PARAMS);
    assert.equal(response.error.data?.errorCode, 'INVALID_TIER');
    assert.equal(session.tier, undefined);
    assert.equal(session.handshaken, false);
  });

  it('rejects an unknown tier value', async () => {
    const session = new TestSession('c_invalid_tier');
    const response = await dispatcher.dispatch(
      connectRequest(
        {
          protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
          token: TOKEN,
          workspaceRoot: await makeWorkspace('invalid-tier'),
          tier: 'admin',
        },
        11,
      ),
      session,
    );

    assert.ok(Protocol.isRpcErrorResponse(response));
    assert.equal(response.error.code, Protocol.INVALID_PARAMS);
    assert.equal(response.error.data?.errorCode, 'INVALID_TIER');
    assert.equal(response.error.data?.actual, 'admin');
    assert.equal(session.tier, undefined);
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

  it('rejects the filesystem root and known system directories', async () => {
    const deniedRoots = process.platform === 'win32'
      ? ['C:\\', 'C:\\Windows', 'C:\\Program Files', 'C:\\ProgramData']
      : ['/', '/etc', '/usr', '/bin', '/sbin', '/var', '/sys', '/proc', '/dev', '/boot', '/private'];

    for (const [index, root] of deniedRoots.entries()) {
      const session = new TestSession(`c_denied_${index}`);
      const response = await dispatcher.dispatch(
        connectRequest(
          {
            protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
            token: TOKEN,
            workspaceRoot: root,
          },
          100 + index,
        ),
        session,
      );

      assert.ok(Protocol.isRpcErrorResponse(response), `${root}: ${JSON.stringify(response)}`);
      assert.equal(response.error.code, Protocol.INVALID_PARAMS);
      assert.equal(response.error.data?.errorCode, 'INVALID_WORKSPACE_ROOT');
      assert.equal(session.handshaken, false);
      assert.equal(registry.get(root), undefined, `${root} must never be spawned`);
    }
  });

  it('rejects a symlink that resolves to a system directory', { skip: process.platform === 'win32' }, async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'brud-connect-symlink-')));
    const link = join(base, 'rogue');
    await symlink('/etc', link);

    try {
      const session = new TestSession('c_denied_symlink');
      const response = await dispatcher.dispatch(
        connectRequest(
          {
            protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
            token: TOKEN,
            workspaceRoot: link,
          },
          200,
        ),
        session,
      );

      assert.ok(Protocol.isRpcErrorResponse(response), JSON.stringify(response));
      assert.equal(response.error.data?.errorCode, 'INVALID_WORKSPACE_ROOT');
      assert.equal(session.handshaken, false);
      assert.equal(registry.get(link), undefined);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('spawns a kernel for a valid absolute workspaceRoot and attaches the client', async () => {
    const root = await makeWorkspace('workspace-a');
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
    assert.equal(result.tier, 'ui');
    assert.equal(session.workspaceRoot, root);
    assert.equal(session.tier, 'ui');
    assert.equal(session.handshaken, true);
    assert.equal(registry.get(root)?.clients.has('c_valid'), true);
    assert.equal(registry.get(root)?.kernel.lifecycleState, 'RUNNING');
  });

  it('reuses an existing workspace kernel for a second client', async () => {
    const root = await makeWorkspace('workspace-b');
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
    const kernel = registry.get(root)?.kernel;
    assert.ok(kernel !== undefined);

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
    assert.equal(registry.get(root)?.kernel, kernel);
    assert.equal(registry.get(root)?.clients.size, 2);
  });

  it('rejects an invalid token before spawning', async () => {
    const root = await makeWorkspace('workspace-c');
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