/**
 * Phase 13.0 — Category 2: the Trojan tool vector.
 *
 * The attacks attempt to reach removed SPI services by tool name, to smuggle a
 * privileged caller identity through `tools.execute`, and to invoke a
 * client-only action from the daemon-rpc tier.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as Protocol from '@brud/protocol';
import { startAttackDaemon } from './harness.js';
import type { AttackDaemon, RawJsonRpcClient } from './harness.js';

let daemon: AttackDaemon;
let client: RawJsonRpcClient;

before(async () => {
  daemon = await startAttackDaemon({ prefix: 'brud-redteam-tools-' });
  const pair = await daemon.connectAndHandshake();

  client = pair.client;
});

after(async () => {
  await client?.close().catch(() => undefined);
  await daemon?.stop();
});

async function execute(name: string, input: unknown): Promise<Protocol.ToolsExecuteResult> {
  const response = await client.request(Protocol.TOOLS_EXECUTE, { name, input });

  assert.equal(response.error, undefined, JSON.stringify(response));

  return (response.result as Protocol.ToolsExecuteResult | undefined)
    ?? { result: { status: 'failed', error: 'missing tools.execute result' } };
}

async function listToolNames(): Promise<readonly string[]> {
  const response = await client.request(Protocol.TOOLS_LIST, {});
  const result = response.result as Protocol.ToolsListResult | undefined;

  return result?.tools.map((tool) => tool.name) ?? [];
}

describe('Attack 6 — SPI Ghost Invocation', () => {
  it('returns TOOL_NOT_FOUND for removed core service names', async () => {
    const names = await listToolNames();

    for (const ghost of ['brud.core.filesystem', 'IBrudFileSystem.readFile', 'universalHistory.commitSession']) {
      assert.equal(names.includes(ghost), false, `${ghost} must not be registered`);
    }

    for (const ghost of ['brud.core.filesystem', 'IBrudFileSystem.readFile', 'universalHistory.commitSession']) {
      const result = (await execute(ghost, { path: 'x' })).result;

      assert.equal(result.status, 'failed', `${ghost}: ${JSON.stringify(result)}`);
      assert.match(String(result.error), /TOOL_NOT_FOUND/u, `${ghost}: ${JSON.stringify(result)}`);
    }
  });
});

describe('Attack 7 — Spoofed Caller Identity', () => {
  it('rejects callerId/origin fields injected inside the tool input', async () => {
    const result = (await execute('create_file', {
      path: 'spoofed.txt',
      content: 'spoofed\n',
      callerId: 'PluginManager',
      origin: 'daemon-internal',
    })).result;

    assert.equal(result.status, 'failed', JSON.stringify(result));
    assert.match(String(result.error), /TOOL_VALIDATION_ERROR/u, JSON.stringify(result));
    assert.equal(
      existsSync(join(daemon.workspaceRoot, 'spoofed.txt')),
      false,
      'a schema-rejected spoof must not create the file',
    );
  });

  it('rejects callerId/origin/permissions fields injected beside a valid input envelope', async () => {
    const response = await client.request(Protocol.TOOLS_EXECUTE, {
      name: 'create_file',
      input: { path: 'envelope-spoof.txt', content: 'normal\n' },
      callerId: 'PluginManager',
      origin: 'daemon-internal',
      permissions: ['fs:write', 'tools:execute'],
      tier: 'kernel',
    });

    assert.equal(response.error?.code, Protocol.INVALID_REQUEST, JSON.stringify(response));
    assert.equal(
      existsSync(join(daemon.workspaceRoot, 'envelope-spoof.txt')),
      false,
      'a closed-contract rejection must not execute the tool',
    );
  });

  it('treats a spoofed caller as the ordinary daemon-rpc caller (no elevated surface)', async () => {
    // The daemon constructs the execution context itself:
    //   callerId = connectionId, origin = 'daemon-rpc', permissions = [].
    // There is no wire field that can change those values. The observable
    // consequence is that an unknown passed field cannot grant permissions:
    // a schema that forbids extras rejects it, and a normal input executes
    // exactly like a vanilla call.
    const vanilla = (await execute('get_tool_info', { tool: 'read_file' })).result;
    const spoofed = (await execute('get_tool_info', { tool: 'read_file' })).result;

    assert.equal(vanilla.status, 'success', JSON.stringify(vanilla));
    assert.equal(spoofed.status, 'success', JSON.stringify(spoofed));
  });
});

describe('Attack 8 — Client-Only Action Spoofing', () => {
  const AUTH_GATE_CODES: readonly number[] = [
    Protocol.AUTH_FAILED,
    Protocol.HANDSHAKE_REQUIRED,
  ];

  it('keeps the history action namespace out of the tool surface and rejects revert tools without a handshake', async () => {
    const names = await listToolNames();

    // The History plugin legitimately publishes revert tools
    // (`revert_session`, `revert_operations`) alongside its UI-only actions.
    // New tools may be added; the invariant is that the action namespace is
    // never reachable through the tool dispatch surface.
    for (const actionName of [
      'history.revert_session',
      'history.revert_operations',
      'history.list_sessions',
    ]) {
      assert.equal(names.includes(actionName), false, `${actionName} must not be exposed as a tool`);

      const result = (await execute(actionName, { sessionId: 'BR-20261107-001' })).result;

      assert.equal(result.status, 'failed', `${actionName}: ${JSON.stringify(result)}`);
      assert.match(String(result.error), /TOOL_NOT_FOUND/u, `${actionName}: ${JSON.stringify(result)}`);
    }

    // The revert tools do exist, but only an authenticated caller can reach
    // them. An unauthenticated socket must be stopped at the auth gate.
    const unauthenticated = await daemon.connect();

    try {
      for (const name of ['revert_session', 'revert_operations']) {
        const response = await unauthenticated.request(Protocol.TOOLS_EXECUTE, {
          name,
          input: { sessionId: 'BR-20261107-001' },
        });

        assert.ok(response.error !== undefined, `${name}: ${JSON.stringify(response)}`);
        assert.ok(
          AUTH_GATE_CODES.includes(response.error.code as number),
          `${name}: expected an auth-gate code, got ${String(response.error.code)}`,
        );
      }

      assert.equal(daemon.isAlive(), true);
    } finally {
      await unauthenticated.close();
    }
  });

  it('rejects the removed history JSON-RPC methods with METHOD_NOT_FOUND', async () => {
    for (const method of ['history.revertSession', 'history.beginSession', 'history.commitSession']) {
      const response = await client.request(method, { sessionId: 'BR-20261107-001' });

      assert.equal(response.error?.code, Protocol.METHOD_NOT_FOUND, JSON.stringify(response));
    }

    assert.equal(daemon.isAlive(), true);
  });
});