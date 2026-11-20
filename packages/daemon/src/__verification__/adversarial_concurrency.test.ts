/**
 * Phase 13.0 — Category 5: concurrency and lifecycle races.
 *
 * A routed operation is interrupted by a socket close, an unauthenticated
 * caller races an active operation, and an oversized record probes the payload
 * ceiling. The operations are the throwaway probe participant's.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import * as Protocol from '@brud/protocol';
import { startAttackDaemon } from './harness.js';
import type { AttackDaemon, RawJsonRpcClient } from './harness.js';

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

/** Boots a probe kernel on this connection and returns its instance id. */
async function bootProbe(target: RawJsonRpcClient, label: string): Promise<string> {
  const response = await target.request(Protocol.KERNEL_BOOT, { options: { 'probe.label': label } });
  const result = response.result as { readonly instance?: { readonly instanceId?: string } } | undefined;
  const instanceId = result?.instance?.instanceId;

  assert.equal(response.error, undefined, JSON.stringify(response));
  assert.equal(typeof instanceId, 'string', JSON.stringify(response));

  return instanceId as string;
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

describe('Attack 14 — Disconnect-Mid-Operation Race', () => {
  it('survives a disconnect during a routed operation and stays usable', { timeout: 60_000 }, async () => {
    const racing = await daemon.connectAndHandshake();
    const racingInstance = await bootProbe(racing.client, 'racing');

    racing.client.send({
      jsonrpc: '2.0',
      id: 2,
      method: Protocol.KERNEL_ROUTE,
      params: {
        instanceId: racingInstance,
        text: '[BRUD]\n[CALL probe sleep]\nms: 3000\n[END]\n[/BRUD]',
      },
    });

    // Let the frame reach the socket, then sever the connection while the
    // daemon is still running the operation.
    await delay(30);
    racing.client.destroy();

    await delay(3_000);

    assert.equal(daemon.isAlive(), true, 'daemon must survive a mid-operation disconnect');

    const recovered = await daemon.connectAndHandshake();

    try {
      const recoveredInstance = await bootProbe(recovered.client, 'recovered');
      const response = await recovered.client.request(Protocol.KERNEL_ROUTE, {
        instanceId: recoveredInstance,
        text: '[BRUD]\n[CALL probe echo]\nx: 1\n[END]\n[/BRUD]',
      });

      assert.equal(response.error, undefined, JSON.stringify(response));
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

  it('rejects an unauthenticated caller while an operation is in flight', { timeout: 60_000 }, async () => {
    const writer = await daemon.connectAndHandshake();
    // Deliberately no handshake: this caller is not authorized to reach any
    // kernel instance, including the one the writer is using.
    const reverter = await daemon.connect();

    try {
      const writerInstance = await bootProbe(writer.client, 'writer');
      const writePromise = writer.client.request(Protocol.KERNEL_ROUTE, {
        instanceId: writerInstance,
        text: '[BRUD]\n[CALL probe sleep]\nms: 3000\n[END]\n[/BRUD]',
      });

      const revertResponse = await reverter.request(Protocol.KERNEL_ROUTE, {
        instanceId: writerInstance,
        text: '[BRUD]\n[CALL probe echo]\nx: 1\n[END]\n[/BRUD]',
      });

      assert.ok(revertResponse.error !== undefined, JSON.stringify(revertResponse));
      assert.ok(
        AUTH_GATE_CODES.includes(revertResponse.error.code as number),
        `expected an auth-gate code, got ${String(revertResponse.error.code)}`,
      );

      const writeResponse = await writePromise;
      const writeResult = writeResponse.result as { readonly status?: string } | undefined;

      assert.equal(writeResponse.error, undefined, JSON.stringify(writeResponse));
      assert.equal(writeResult?.status, 'success', JSON.stringify(writeResult));
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

    // The daemon must still accept fresh connections after the rejection.
    const recovered = await daemon.connectAndHandshake();

    try {
      const response = await recovered.client.request(Protocol.KERNEL_LIST, {});

      assert.equal(response.error, undefined, JSON.stringify(response));
    } finally {
      await recovered.client.close();
    }
  });
});