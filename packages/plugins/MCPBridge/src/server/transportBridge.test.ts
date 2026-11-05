import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IMcpTransport } from '@brud/kernel';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { ImcpTransportBridge } from './transportBridge.js';

class FakeTransport implements IMcpTransport {
  public readonly kind = 'stdio' as const;

  public readonly notifications: unknown[] = [];

  public closed = false;

  private handler: ((message: unknown) => Promise<unknown>) | undefined;

  public onMessage(handler: (message: unknown) => Promise<unknown>): void {
    this.handler = handler;
  }

  public sendNotification(message: unknown): void {
    this.notifications.push(message);
  }

  public async close(): Promise<void> {
    this.closed = true;
  }

  public async inject(message: unknown): Promise<unknown> {
    if (this.handler === undefined) {
      throw new Error('No handler attached');
    }

    return await this.handler(message);
  }
}

const INITIALIZE_REQUEST = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'test', version: '0.0.1' },
  },
};

describe('ImcpTransportBridge', () => {
  it('correlates an incoming request with the SDK response', async () => {
    const transport = new FakeTransport();
    const bridge = new ImcpTransportBridge(transport);

    bridge.onmessage = (message: JSONRPCMessage): void => {
      void bridge.send({
        jsonrpc: '2.0',
        id: (message as { readonly id: number }).id,
        result: { ok: true },
      });
    };

    await bridge.start();

    const response = await transport.inject(INITIALIZE_REQUEST) as JSONRPCMessage;

    assert.ok('result' in response);
  });

  it('resolves a notification without a response', async () => {
    const transport = new FakeTransport();
    const bridge = new ImcpTransportBridge(transport);

    bridge.onmessage = (): void => undefined;
    await bridge.start();

    const response = await transport.inject({ jsonrpc: '2.0', method: 'notifications/initialized' });

    assert.equal(response, undefined);
  });

  it('forwards an outgoing notification over sendNotification', async () => {
    const transport = new FakeTransport();
    const bridge = new ImcpTransportBridge(transport);

    await bridge.start();
    await bridge.send({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info' } });

    assert.equal(transport.notifications.length, 1);
  });

  it('closes the daemon transport and invokes onclose', async () => {
    const transport = new FakeTransport();
    const bridge = new ImcpTransportBridge(transport);
    let closed = false;

    bridge.onclose = (): void => {
      closed = true;
    };

    await bridge.start();
    await bridge.close();

    assert.equal(transport.closed, true);
    assert.equal(closed, true);
  });
});