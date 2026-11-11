/**
 * Phase 13.0 — Category 5: concurrency and lifecycle races.
 *
 * A real write is interrupted by a socket close, a reversal request races an
 * active write, and a 10 MiB tools.execute frame probes the payload ceiling.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import * as Protocol from '@brud/protocol';
import { startAttackDaemon, toolResultOf } from './harness.js';
import type { AttackDaemon, RawJsonRpcClient } from './harness.js';

const MID_WRITE_BYTES = 7 * 1024 * 1024;
const PAYLOAD_DOS_BYTES = 10 * 1024 * 1024;

let daemon: AttackDaemon;
let client: RawJsonRpcClient;

before(async () => {
  daemon = await startAttackDaemon({ prefix: 'brud-redteam-concurrency-' });
  const pair = await daemon.connectAndHandshake();

  client = pair.client;
});

after(async () => {
  await client?.close().catch(() => undefined);
  await daemon?.stop();
});

async function delay(ms: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function residentBytes(pid: number | undefined): Promise<number | undefined> {
  if (pid === undefined || process.platform !== 'linux') {
    return undefined;
  }

  try {
    const status = await readFile(`/proc/${pid}/status`, 'utf8');
    const match = /^VmRSS:\s+(\d+)\s+kB$/mu.exec(status);

    return match === null ? undefined : Number.parseInt(match[1] ?? '0', 10) * 1024;
  } catch {
    return undefined;
  }
}

describe('Attack 14 — Disconnect-Mid-Write Race', () => {
  it('leaves no half-written file and releases the target mutex', { timeout: 60_000 }, async () => {
    const payload = 'w'.repeat(MID_WRITE_BYTES);
    const target = join(daemon.workspaceRoot, 'race-mid-write.txt');
    const racing = await daemon.connectAndHandshake();

    racing.client.send({
      jsonrpc: '2.0',
      id: 2,
      method: Protocol.TOOLS_EXECUTE,
      params: {
        name: 'create_file',
        input: { path: 'race-mid-write.txt', content: payload },
      },
    });

    // Let the frame reach the socket, then sever the connection while the
    // daemon may still be validating, journaling, or writing.
    await delay(30);
    racing.client.destroy();

    await delay(3_000);

    assert.equal(daemon.isAlive(), true, 'daemon must survive a mid-write disconnect');

    if (existsSync(target)) {
      const info = await stat(target);

      assert.equal(
        info.size,
        Buffer.byteLength(payload, 'utf8'),
        'the target must be complete or absent, never half-written',
      );
    }

    const recovered = await daemon.connectAndHandshake();

    try {
      const response = await recovered.client.request(Protocol.TOOLS_EXECUTE, {
        name: 'create_file',
        input: { path: 'post-race.txt', content: 'mutex released\n' },
      });
      const result = toolResultOf(response);

      assert.equal(response.error, undefined, JSON.stringify(response));
      assert.equal(result.status, 'success', JSON.stringify(result));
      assert.equal(existsSync(join(daemon.workspaceRoot, 'post-race.txt')), true);
    } finally {
      await recovered.client.close();
    }
  });
});

describe('Attack 15 — Reversal Conflict', () => {
  const AUTH_GATE_CODES: readonly number[] = [
    Protocol.AUTH_FAILED,
    Protocol.HANDSHAKE_REQUIRED,
  ];

  it('rejects revert_session from an unauthenticated caller while a write is in flight', { timeout: 60_000 }, async () => {
    const writer = await daemon.connectAndHandshake();
    // Deliberately no handshake: this caller is not authorized to reach any
    // tool, including the History plugin's revert surface.
    const reverter = await daemon.connect();
    const payload = 'r'.repeat(4 * 1024 * 1024);

    try {
      const writePromise = writer.client.request(Protocol.TOOLS_EXECUTE, {
        name: 'create_file',
        input: { path: 'reversal-target.txt', content: payload },
      });

      const revertResponse = await reverter.request(Protocol.TOOLS_EXECUTE, {
        name: 'revert_session',
        input: { sessionId: 'BR-20261107-001' },
      });

      assert.ok(revertResponse.error !== undefined, JSON.stringify(revertResponse));
      assert.ok(
        AUTH_GATE_CODES.includes(revertResponse.error.code as number),
        `expected an auth-gate code, got ${String(revertResponse.error.code)}`,
      );

      const writeResponse = await writePromise;
      const writeResult = toolResultOf(writeResponse);

      assert.equal(writeResponse.error, undefined, JSON.stringify(writeResponse));
      assert.equal(writeResult.status, 'success', JSON.stringify(writeResult));
    } finally {
      await writer.client.close().catch(() => undefined);
      await reverter.close().catch(() => undefined);
    }
  });

  it('rejects the removed history.revertSession RPC method', async () => {
    const response = await client.request('history.revertSession', {
      sessionId: 'BR-20261107-001',
    });

    assert.equal(response.error?.code, Protocol.METHOD_NOT_FOUND, JSON.stringify(response));
  });
});

describe('Attack 16 — Payload Size DoS', () => {
  it('rejects an oversized encrypted record before buffering it and survives', { timeout: 90_000 }, async () => {
    const pid = daemon.process.pid;
    const beforeRss = await residentBytes(pid);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(10 * 1024 * 1024, 0);

    // A hostile peer writes a length prefix larger than the receiver's record
    // ceiling. The daemon must close before allocating the body.
    client.sendUnframedBytes(Buffer.concat([header, Buffer.alloc(64)]));

    const closed = await client.waitForClose(10_000);
    const afterRss = await residentBytes(pid);
    const memory = `rss before=${beforeRss ?? 'n/a'} after=${afterRss ?? 'n/a'}`;

    assert.equal(closed, true, `daemon did not close the oversized record (${memory})`);
    assert.equal(daemon.isAlive(), true, `daemon crashed under a 10 MiB length prefix (${memory})`);
    assert.equal(existsSync(join(daemon.workspaceRoot, 'payload-dos.txt')), false);

    // The daemon must still accept fresh connections after the rejection.
    const recovered = await daemon.connectAndHandshake();

    try {
      const response = await recovered.client.request(Protocol.TOOLS_LIST, {});

      assert.equal(response.error, undefined, JSON.stringify(response));
    } finally {
      await recovered.client.close();
    }
  });
});