import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import * as Protocol from '@brud/protocol';
import type { RequestCancelledParams } from '@brud/protocol';
import { DaemonClient } from '../client/DaemonClient.js';
import { connectSocket } from '../client/socket.js';
import { DaemonRequestCancelledError } from '../client/errors.js';
import { startAttackDaemon } from '../__verification__/harness.js';
import type { AttackDaemon } from '../__verification__/harness.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

async function connectClient(daemon: AttackDaemon): Promise<DaemonClient> {
  const socket = await connectSocket(daemon.socketPath);
  const client = new DaemonClient(socket, {
    psk: daemon.token,
    principal: 'ui',
    home: daemon.home,
    prologue: daemon.prologue,
  });

  try {
    await client.connect({
      protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
      clientInfo: { name: 'brud-cancellation-mirror', version: '0.0.1' },
    });
  } catch (error: unknown) {
    await client.close();
    throw error;
  }

  return client;
}

let daemon: AttackDaemon;
let client: DaemonClient;

before(async () => {
  daemon = await startAttackDaemon({ prefix: 'brud-cancellation-mirror-' });
  client = await connectClient(daemon);
});

after(async () => {
  await client?.close().catch(() => undefined);
  await daemon?.stop();
});

describe('server-side cancellation round trip', () => {
  it(
    'stops a real long-running operation and acknowledges the cancellation',
    { timeout: 30_000 },
    async () => {
      const boot = await client.request<Protocol.KernelBootResult>(Protocol.KERNEL_BOOT, { options: { 'probe.label': 'cancel' } });

      let unsubscribe: () => void = () => undefined;
      const ackPromise = new Promise<RequestCancelledParams>((resolveAck) => {
        unsubscribe = client.onCancelAck((ack) => {
          resolveAck(ack);
        });
      });

      const controller = new AbortController();
      const startedAt = Date.now();
      const pending = client.request(
        Protocol.KERNEL_ROUTE,
        // The probe sleeps 3s unless its dispatch signal aborts.
        { instanceId: boot.instance.instanceId, text: `[BRUD]
[CALL probe sleep]
ms: 3000
[END]
[/BRUD]` },
        { timeoutMs: 20_000, signal: controller.signal },
      );

      // Let the request reach the daemon and the real terminal session start.
      await delay(300);
      controller.abort();

      try {
        await assert.rejects(pending, (error: unknown) => {
          assert.ok(error instanceof DaemonRequestCancelledError);
          assert.equal(error.method, Protocol.KERNEL_ROUTE);
          return true;
        });

        const ack = await ackPromise;

        assert.equal(ack.status, 'cancelled', JSON.stringify(ack));
        assert.equal(typeof ack.id, 'number', JSON.stringify(ack));
        assert.ok(
          Date.now() - startedAt < 10_000,
          'cancellation must be acknowledged without waiting for the full operation',
        );
      } finally {
        unsubscribe();
      }

      assert.equal(daemon.isAlive(), true);
    },
  );
});