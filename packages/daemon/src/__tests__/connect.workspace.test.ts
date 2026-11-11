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
import {
  canonicalizeWorkspaceRoot,
  validateAuthenticatedWorkspaceRoot,
} from '../server/handshake.js';
import { WorkspaceRegistry } from '../workspaceRegistry.js';

class TestSession implements DispatchSession {
  public workspaceRoot: string | undefined;

  public handshaken = false;

  public tier: DaemonCallerTier | undefined;

  constructor(
    public readonly connectionId: string,
    workspaceRoot?: string,
    tier: DaemonCallerTier = 'ui',
  ) {
    this.workspaceRoot = workspaceRoot;
    this.tier = tier;
  }

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

function connectRequest(
  overrides: Record<string, unknown> = {},
  id = 1,
): RpcRequest {
  return {
    jsonrpc: '2.0',
    id,
    method: Protocol.DAEMON_CONNECT,
    params: {
      protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
      ...overrides,
    },
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
    workspaceRoot: primaryRoot,
  });
});

after(async () => {
  await registry.disposeAll();
  await rm(baseRoot, { recursive: true, force: true });
});

describe('daemon.connect post-handshake contract', () => {
  it('rejects a session that never authenticated a workspace or principal', async () => {
    const session = new TestSession('c_unauthenticated');
    const response = await dispatcher.dispatch(connectRequest(), session);

    assert.ok(Protocol.isRpcErrorResponse(response));
    assert.equal(response.error.code, Protocol.INTERNAL_ERROR);
    assert.equal(session.handshaken, false);
  });

  it('rejects a missing protocolVersion', async () => {
    const root = await makeWorkspace('missing-version');
    const session = new TestSession('c_missing_version', root);
    const response = await dispatcher.dispatch(
      {
        jsonrpc: '2.0',
        id: 2,
        method: Protocol.DAEMON_CONNECT,
        params: {},
      },
      session,
    );

    assert.ok(Protocol.isRpcErrorResponse(response));
    assert.equal(response.error.code, Protocol.INVALID_PARAMS);
    assert.equal(session.handshaken, false);
  });

  it('rejects a protocol version mismatch', async () => {
    const root = await makeWorkspace('version-mismatch');
    const session = new TestSession('c_version_mismatch', root);
    const response = await dispatcher.dispatch(
      connectRequest({ protocolVersion: '0.0.0' }, 3),
      session,
    );

    assert.ok(Protocol.isRpcErrorResponse(response));
    assert.equal(response.error.code, Protocol.PROTOCOL_VERSION_MISMATCH);
    assert.equal(session.handshaken, false);
  });

  it('rejects a second connect on the same session', async () => {
    const root = await makeWorkspace('second-connect');
    const session = new TestSession('c_second', root);

    const first = await dispatcher.dispatch(connectRequest({}, 4), session);
    assert.ok(Protocol.isRpcSuccessResponse(first));

    const second = await dispatcher.dispatch(connectRequest({}, 5), session);
    assert.ok(Protocol.isRpcErrorResponse(second));
    assert.equal(second.error.code, Protocol.ALREADY_HANDSHAKEN);
  });

  it('spawns a kernel for the authenticated workspace and attaches the client', async () => {
    const root = await makeWorkspace('workspace-a');
    const session = new TestSession('c_valid', root);
    const response = await dispatcher.dispatch(
      connectRequest({ clientInfo: { name: 'test-client', version: '1.0.0' } }, 6),
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
    const first = new TestSession('c_reuse_1', root);
    const second = new TestSession('c_reuse_2', root);

    await dispatcher.dispatch(connectRequest({}, 7), first);
    const kernel = registry.get(root)?.kernel;
    assert.ok(kernel !== undefined);

    const response = await dispatcher.dispatch(connectRequest({}, 8), second);

    assert.ok(Protocol.isRpcSuccessResponse(response));
    assert.equal(registry.get(root)?.kernel, kernel);
    assert.equal(registry.get(root)?.clients.size, 2);
  });
});

describe('authenticated workspace scope', () => {
  it('rejects a workspaceRoot that is not an absolute path', () => {
    const outcome = validateAuthenticatedWorkspaceRoot('relative/workspace', {
      primaryRoot,
      enforcePrimary: false,
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, Protocol.INVALID_PARAMS);
    assert.equal(outcome.data?.errorCode, 'INVALID_WORKSPACE_ROOT');
  });

  it('rejects the filesystem root and known system directories', () => {
    const deniedRoots = process.platform === 'win32'
      ? ['C:\\', 'C:\\Windows', 'C:\\Program Files', 'C:\\ProgramData']
      : ['/', '/etc', '/usr', '/bin', '/sbin', '/var', '/sys', '/proc', '/dev', '/boot', '/private'];

    for (const root of deniedRoots) {
      const outcome = validateAuthenticatedWorkspaceRoot(root, {
        primaryRoot,
        enforcePrimary: false,
      });

      assert.equal(outcome.ok, false, `${root}: ${JSON.stringify(outcome)}`);
      assert.equal(outcome.code, Protocol.INVALID_PARAMS);
      assert.equal(outcome.data?.errorCode, 'INVALID_WORKSPACE_ROOT');
      assert.equal(registry.get(root), undefined, `${root} must never be spawned`);
    }
  });

  it('rejects a symlink that resolves to a system directory', { skip: process.platform === 'win32' }, async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'brud-connect-symlink-')));
    const link = join(base, 'rogue');
    await symlink('/etc', link);

    try {
      const outcome = validateAuthenticatedWorkspaceRoot(link, {
        primaryRoot,
        enforcePrimary: false,
      });

      assert.equal(outcome.ok, false, JSON.stringify(outcome));
      assert.equal(outcome.data?.errorCode, 'INVALID_WORKSPACE_ROOT');
      assert.equal(registry.get(link), undefined);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('enforces the configured primary root for a single-kernel daemon', async () => {
    const other = await makeWorkspace('other-root');
    const outcome = validateAuthenticatedWorkspaceRoot(other, {
      primaryRoot: canonicalizeWorkspaceRoot(primaryRoot),
      enforcePrimary: true,
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, Protocol.WORKSPACE_MISMATCH);
  });

  it('accepts a valid absolute root for a registry daemon', async () => {
    const root = await makeWorkspace('registry-valid');
    const outcome = validateAuthenticatedWorkspaceRoot(root, {
      primaryRoot,
      enforcePrimary: false,
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.ok ? outcome.workspaceRoot : undefined, root);
  });
});