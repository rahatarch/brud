/**
 * Phase 13.0 — Category 1: protocol and dispatcher exploits.
 *
 * Every request travels over a real Unix-domain socket to a real daemon
 * subprocess. The suite attempts SPI ghost methods, prototype-pollution
 * method names, method-string smuggling, a malformed batch bomb, and an
 * unauthenticated call.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as Protocol from '@brud/protocol';
import {
  RawJsonRpcClient,
  startAttackDaemon,
} from './harness.js';
import type { AttackDaemon } from './harness.js';

const AUTH_GATE_CODES: readonly number[] = [
  Protocol.AUTH_FAILED,
  Protocol.HANDSHAKE_REQUIRED,
];

let daemon: AttackDaemon;
let client: RawJsonRpcClient;

before(async () => {
  daemon = await startAttackDaemon({ prefix: 'brud-redteam-protocol-' });
  const pair = await daemon.connectAndHandshake();

  client = pair.client;
});

after(async () => {
  await client?.close().catch(() => undefined);
  await daemon?.stop();
});

async function expectMethodNotFound(method: string): Promise<void> {
  const response = await client.request(method, {});

  assert.equal(
    response.error?.code,
    Protocol.METHOD_NOT_FOUND,
    `${method} must not be routable: ${JSON.stringify(response)}`,
  );
}

async function expectToolsListAlive(): Promise<void> {
  const response = await client.request(Protocol.TOOLS_LIST, {});
  const result = response.result as Protocol.ToolsListResult | undefined;

  assert.equal(response.error, undefined, JSON.stringify(response));
  assert.ok(Array.isArray(result?.tools), 'tools.list must still answer after the attack');
}

describe('Attack 1 — The Ghost Method', () => {
  it('rejects fs.readFile and history.* with METHOD_NOT_FOUND', async () => {
    await expectMethodNotFound('fs.readFile');
    await expectMethodNotFound('history.beginSession');
    await expectMethodNotFound('history.commitSession');

    await expectToolsListAlive();
  });
});

describe('Attack 2 — The Prototype Pollution Probe', () => {
  it('rejects __proto__ and constructor.prototype paths without crashing', async () => {
    await expectMethodNotFound('__proto__.readFile');
    await expectMethodNotFound('constructor.prototype.fileSystem');
    await expectMethodNotFound('__proto__');
    await expectMethodNotFound('constructor');

    assert.equal(daemon.isAlive(), true, 'daemon must survive prototype-name probe');
    await expectToolsListAlive();
  });
});

describe('Attack 3 — Dot-Traversal Smuggling', () => {
  it('rejects case and separator variants of fs.readFile', async () => {
    await expectMethodNotFound('FS.READFILE');
    await expectMethodNotFound('fs..readFile');
    await expectMethodNotFound('workspace.fs.readFile');
    await expectMethodNotFound('workspace..fs..readFile');

    await expectToolsListAlive();
  });
});

describe('Attack 4 — Malformed Batch Bomb', () => {
  it('rejects a JSON-RPC batch array without consuming or crashing the daemon', async () => {
    const batch = Array.from({ length: 50 }, (_, index) => {
      if (index % 5 === 0) {
        return { jsonrpc: '2.0', id: index + 1, method: Protocol.TOOLS_LIST, params: {} };
      }

      if (index % 5 === 1) {
        return { jsonrpc: '2.0', id: index + 1, method: 'fs.readFile', params: {} };
      }

      if (index % 5 === 2) {
        return { jsonrpc: '2.0', id: index + 1, method: '__proto__.readFile', params: {} };
      }

      if (index % 5 === 3) {
        return { jsonrpc: '2.0', id: index + 1, method: 'history.beginSession', params: {} };
      }

      return { jsonrpc: '2.0', id: index + 1, method: Protocol.DAEMON_PING, params: {} };
    });

    const from = client.mark();
    client.sendRaw(JSON.stringify(batch));

    const rejection = await client.waitForFrame(
      (frame) => frame.id === null && frame.error?.code === Protocol.INVALID_REQUEST,
      { from },
    );

    assert.equal(rejection.error?.code, Protocol.INVALID_REQUEST);
    assert.equal(daemon.isAlive(), true, 'batch array must not crash the daemon');
    await expectToolsListAlive();
  });

  it('processes 50 mixed frames (valid, malformed, cyclic markers, fs/history) without crashing', { timeout: 30_000 }, async () => {
    const from = client.mark();

    const validIds: number[] = [];
    const ghostIds: number[] = [];
    const protoIds: number[] = [];
    const markerIds: number[] = [];
    const lines: string[] = [];

    for (let index = 0; index < 10; index += 1) {
      const validId = 100 + index;
      const ghostId = 110 + index;
      const protoId = 120 + index;
      const markerId = 130 + index;

      validIds.push(validId);
      ghostIds.push(ghostId);
      protoIds.push(protoId);
      markerIds.push(markerId);

      lines.push(JSON.stringify({
        jsonrpc: '2.0',
        id: validId,
        method: Protocol.TOOLS_LIST,
        params: {},
      }));
      lines.push(JSON.stringify({
        jsonrpc: '2.0',
        id: ghostId,
        method: index % 2 === 0 ? 'fs.readFile' : 'history.beginSession',
        params: {},
      }));
      // A malformed frame deliberately interleaved with valid frames.
      lines.push(`{"jsonrpc":"2.0","id":${200 + index},"method":`);
      lines.push(JSON.stringify({
        jsonrpc: '2.0',
        id: protoId,
        method: '__proto__.readFile',
        params: JSON.parse('{"__proto__":{"polluted":true}}'),
      }));
      // JSON cannot encode a real cycle. A self-referential `$ref` marker plus
      // a duplicate key is the closest wire-level analogue; the dispatcher must
      // treat it as an ordinary tools.list request.
      lines.push(
        `{"jsonrpc":"2.0","id":${markerId},"method":"tools.list","params":{"self":{"$ref":"#"},"a":1,"a":2}}`,
      );
    }

    // One write, one transport chunk: the strongest form of the batch bomb.
    client.sendRaw(`${lines.join('\n')}\n`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 3_000));

    const received = client.frames.slice(from);
    const count = (predicate: (frame: (typeof received)[number]) => boolean): number =>
      received.filter(predicate).length;

    assert.equal(daemon.isAlive(), true, 'mixed 50-frame stream must not crash the daemon');

    assert.equal(
      count((frame) => typeof frame.id === 'number' && validIds.includes(frame.id)),
      validIds.length,
      `valid tools.list frames were dropped: ${JSON.stringify(received.map((frame) => frame.id))}`,
    );
    assert.equal(
      count((frame) => typeof frame.id === 'number' && markerIds.includes(frame.id)),
      markerIds.length,
      `cyclic-marker frames were dropped: ${JSON.stringify(received.map((frame) => frame.id))}`,
    );
    assert.equal(
      count((frame) => typeof frame.id === 'number' && ghostIds.includes(frame.id)
        && frame.error?.code === Protocol.METHOD_NOT_FOUND),
      ghostIds.length,
      `ghost-method frames were dropped: ${JSON.stringify(received.map((frame) => frame.id))}`,
    );
    assert.equal(
      count((frame) => typeof frame.id === 'number' && protoIds.includes(frame.id)
        && frame.error?.code === Protocol.METHOD_NOT_FOUND),
      protoIds.length,
      `prototype-method frames were dropped: ${JSON.stringify(received.map((frame) => frame.id))}`,
    );
    const parseErrors = received.filter(
      (frame) => frame.error?.code === Protocol.PARSE_ERROR,
    );

    assert.equal(
      parseErrors.length,
      10,
      `malformed frames were not all rejected: ${JSON.stringify(received.map((frame) => frame.id))}`,
    );
    assert.deepEqual(
      parseErrors.map((frame) => frame.id).sort((left, right) => Number(left) - Number(right)),
      Array.from({ length: 10 }, (_, index) => 200 + index),
      'each malformed frame must report its own extractable id',
    );

    await expectToolsListAlive();
  });
});

describe('Attack 5 — Unauthenticated Socket', () => {
  it('rejects tools.execute before daemon.connect and never executes the tool', async () => {
    const unauthenticated = await daemon.connect();

    try {
      const response = await unauthenticated.request(Protocol.TOOLS_EXECUTE, {
        name: 'create_file',
        input: { path: 'unauth-created.txt', content: 'should never exist\n' },
      });

      assert.ok(response.error !== undefined, JSON.stringify(response));
      assert.ok(
        AUTH_GATE_CODES.includes(response.error.code as number),
        `expected an auth-gate code (${AUTH_GATE_CODES.join(', ')}), got ${String(response.error.code)}`,
      );

      const ping = await unauthenticated.request(Protocol.DAEMON_PING, {});
      assert.ok(ping.error !== undefined, JSON.stringify(ping));
      assert.ok(AUTH_GATE_CODES.includes(ping.error.code as number));

      await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
      assert.equal(
        existsSync(join(daemon.workspaceRoot, 'unauth-created.txt')),
        false,
        'an unauthenticated tools.execute must not reach the kernel',
      );
      assert.equal(daemon.isAlive(), true);
    } finally {
      await unauthenticated.close();
    }
  });
});