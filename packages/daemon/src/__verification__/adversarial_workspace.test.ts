/**
 * Phase 13.0 — Category 4: workspace boundary and symlink traps.
 *
 * The workspace is a real temporary directory. A real symbolic link points at
 * the host's `/etc/passwd`, and rogue `daemon.connect` attempts target host
 * roots that were never declared to the daemon.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
import * as Protocol from '@brud/protocol';
import { startAttackDaemon, toolResultOf } from './harness.js';
import type { AttackDaemon, RawJsonRpcClient } from './harness.js';

let daemon: AttackDaemon;
let client: RawJsonRpcClient;

before(async () => {
  daemon = await startAttackDaemon({
    prefix: 'brud-redteam-workspace-',
    seed: async (workspace) => {
      await symlink('/etc/passwd', join(workspace.root, 'evil_link'));
    },
  });
  const pair = await daemon.connectAndHandshake();

  client = pair.client;
});

after(async () => {
  await client?.close().catch(() => undefined);
  await daemon?.stop();
});

function rendered(value: unknown): string {
  return JSON.stringify(value);
}

async function execute(name: string, input: unknown): Promise<ReturnType<typeof toolResultOf>> {
  const response = await client.request(Protocol.TOOLS_EXECUTE, { name, input });

  assert.equal(response.error, undefined, JSON.stringify(response));

  return toolResultOf(response);
}

describe('Attack 12 — The Symlink Escape', () => {
  it('rejects read_file through a symlink that points outside the workspace', { skip: process.platform === 'win32' }, async () => {
    const result = await execute('read_file', { filePath: 'evil_link' });
    const text = rendered(result);

    assert.equal(result.status, 'failed', `symlink escape succeeded: ${text}`);
    assert.match(text, /SYMLINK_ESCAPE/u, `expected SYMLINK_ESCAPE: ${text}`);
    assert.doesNotMatch(text, /root:x:0:0/u, 'host passwd content leaked');
  });

  it('rejects a relative path that traverses through the symlink', { skip: process.platform === 'win32' }, async () => {
    const result = await execute('read_file', { filePath: './evil_link' });
    const text = rendered(result);

    assert.equal(result.status, 'failed', `symlink traversal succeeded: ${text}`);
    assert.match(text, /SYMLINK_ESCAPE|WORKSPACE_PATH_VIOLATION/u, text);
    assert.doesNotMatch(text, /root:x:0:0/u, 'host passwd content leaked');
  });
});

describe('Attack 13 — The Rogue Workspace Connect', () => {
  it('does not expose a workspace.connect method', async () => {
    const response = await client.request('workspace.connect', {
      root: '/',
      workspaceRoot: '/',
    });

    assert.equal(response.error?.code, Protocol.METHOD_NOT_FOUND, JSON.stringify(response));
  });

  it('rejects the host filesystem root ("/")', { timeout: 60_000 }, async () => {
    const rogue = await daemon.connect();

    try {
      const response = await rogue.request(Protocol.DAEMON_CONNECT, {
        protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
        token: daemon.token,
        workspaceRoot: '/',
      });
      const text = rendered(response);

      assert.ok(
        response.error !== undefined,
        `daemon attached to the host filesystem root: ${text}`,
      );
      assert.match(
        text,
        /FILESYSTEM_ROOT|filesystem root|WORKSPACE_CONFIGURATION_INVALID/u,
        `expected a filesystem-root rejection: ${text}`,
      );
    } finally {
      await rogue.close();
    }

    // The daemon must still serve the legitimate workspace afterwards.
    const list = await client.request(Protocol.TOOLS_LIST, {});
    assert.equal(list.error, undefined, JSON.stringify(list));
  });

  it('rejects a host directory outside the declared workspace ("/etc")', { timeout: 60_000 }, async () => {
    const rogue = await daemon.connect();

    try {
      const response = await rogue.request(Protocol.DAEMON_CONNECT, {
        protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
        token: daemon.token,
        workspaceRoot: '/etc',
      });
      const text = rendered(response);

      assert.ok(
        response.error !== undefined,
        `daemon attached a rogue workspace root outside the declared workspace: ${text}`,
      );
      assert.match(
        text,
        /FILESYSTEM_ROOT|ROGUE|OUTSIDE|WORKSPACE_MISMATCH/u,
        `expected a rogue-root rejection: ${text}`,
      );

      if (response.error === undefined) {
        // Clean up the accepted rogue kernel before failing the assertion path.
        await client.request(Protocol.WORKSPACE_DISPOSE, { workspaceRoot: '/etc' });
      }
    } finally {
      await rogue.close();
    }
  });
});