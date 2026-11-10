import { after, before, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { Buffer } from 'node:buffer';
import { mkdtemp, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Protocol from '@brud/protocol';
import type {
  DaemonConnectParams,
  JsonRpcId,
  RpcRequest,
  RpcResponse,
} from '@brud/protocol';
import type { BrudKernel } from '@brud/kernel' with { 'resolution-mode': 'import' };
import { DaemonServer } from '../server/DaemonServer.js';

const TOKEN = 'test-daemon-token-0123456789abcdef';
const CALL_TIMEOUT_MS = 5_000;

interface PendingCall {
  readonly resolve: (response: RpcResponse) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

class TestClient {
  private readonly socket: Socket;

  private buffer: Buffer = Buffer.alloc(0);

  private readonly pending: PendingCall[] = [];

  private constructor(socket: Socket) {
    this.socket = socket;

    socket.on('data', (chunk: Buffer) => {
      this.onData(chunk);
    });
    socket.on('error', (error: Error) => {
      this.failPending(error);
    });
    socket.on('close', () => {
      this.failPending(new Error('Daemon connection closed'));
    });
  }

  static async connect(socketPath: string): Promise<TestClient> {
    const socket = await new Promise<Socket>((resolve, reject) => {
      const candidate = createConnection(socketPath);
      const onConnect = (): void => {
        candidate.off('error', onError);
        resolve(candidate);
      };
      const onError = (error: Error): void => {
        candidate.off('connect', onConnect);
        reject(error);
      };

      candidate.once('connect', onConnect);
      candidate.once('error', onError);
    });

    return new TestClient(socket);
  }

  call(request: RpcRequest): Promise<RpcResponse> {
    return new Promise<RpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removePending(entry);
        reject(new Error(`Timed out waiting for response to "${request.method}"`));
      }, CALL_TIMEOUT_MS);
      const entry: PendingCall = { resolve, reject, timer };

      this.pending.push(entry);
      this.socket.write(Buffer.from(`${JSON.stringify(request)}\n`, 'utf8'));
    });
  }

  async close(): Promise<void> {
    if (this.socket.destroyed) {
      return;
    }

    const closed = new Promise<void>((resolve) => {
      this.socket.once('close', () => {
        resolve();
      });
    });

    this.socket.destroy();
    await closed;
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    try {
      for (;;) {
        const newlineIndex = this.buffer.indexOf(0x0a);
        if (newlineIndex === -1) {
          break;
        }

        const line = this.buffer.subarray(0, newlineIndex).toString('utf8');
        this.buffer = Buffer.from(this.buffer.subarray(newlineIndex + 1));

        const parsed: unknown = JSON.parse(line);
        assert.ok(Protocol.isRpcResponse(parsed), 'Expected a JSON-RPC response');

        const pending = this.pending.shift();
        if (pending === undefined) {
          throw new Error('Received a response with no pending call');
        }

        clearTimeout(pending.timer);
        pending.resolve(parsed);
      }
    } catch (error: unknown) {
      this.failPending(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private removePending(entry: PendingCall): void {
    const index = this.pending.indexOf(entry);

    if (index !== -1) {
      this.pending.splice(index, 1);
    }
  }

  private failPending(error: Error): void {
    const pending = this.pending.splice(0);

    for (const entry of pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function expectRecord(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value), 'Expected an object value');
  return value;
}

function expectString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  assert.ok(typeof value === 'string', `Expected "${key}" to be a string`);
  return value;
}

let nextRequestId = 1;

function createRequest(method: string, params?: unknown): RpcRequest {
  const id: JsonRpcId = nextRequestId;
  nextRequestId += 1;

  return {
    jsonrpc: '2.0',
    id,
    method,
    ...(params === undefined ? {} : { params }),
  };
}

function createConnectRequest(overrides?: Partial<DaemonConnectParams>): RpcRequest {
  const params: DaemonConnectParams = {
    protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
    token: TOKEN,
    workspaceRoot,
    tier: 'ui',
    ...overrides,
  };

  return {
    jsonrpc: '2.0',
    id: `connect-${nextRequestId}`,
    method: Protocol.DAEMON_CONNECT,
    params,
  };
}

let kernel: BrudKernel | undefined;
let server: DaemonServer | undefined;
let workspaceRoot = '';
let tempDirectory = '';
let socketPath = '';

function requireServer(): DaemonServer {
  assert.ok(server !== undefined, 'Daemon server is not initialized');
  return server;
}

async function openClient(): Promise<TestClient> {
  return TestClient.connect(socketPath);
}

async function openHandshakenClient(): Promise<TestClient> {
  const client = await openClient();
  const response = await client.call(createConnectRequest());
  assert.ok(Protocol.isRpcSuccessResponse(response), 'Expected handshake to succeed');
  return client;
}

describe('DaemonServer dispatch', () => {
  before(async () => {
    const kernelModule = await import('@brud/kernel');
    const storageDriver = new kernelModule.NodeStorageDriver();

    workspaceRoot = await mkdtemp(join(tmpdir(), 'brud-dispatch-test-'));
    tempDirectory = await mkdtemp(join(tmpdir(), 'brud-daemon-test-'));

    const createdKernel = kernelModule.createStandardKernel({
      storageDriver,
      history: { inMemory: true },
    });
    await createdKernel.boot({ options: { workspaceRoot } });
    kernel = createdKernel;

    socketPath = join(tempDirectory, 'daemon.sock');

    server = await DaemonServer.create({
      kernel: createdKernel,
      socketPath,
      token: TOKEN,
      workspaceRoot,
    });
    await server.listen();
  });

  after(async () => {
    if (server !== undefined) {
      await server.close();
    }

    if (kernel !== undefined) {
      await kernel.shutdown();
    }

    if (workspaceRoot.length > 0) {
      await rm(workspaceRoot, { recursive: true, force: true });
    }

    if (tempDirectory.length > 0) {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it('rejects handshakes with an invalid token and keeps the connection unauthenticated', async (t) => {
    const client = await openClient();
    t.after(async () => {
      await client.close();
    });

    const response = await client.call(createConnectRequest({ token: 'wrong-token' }));
    assert.ok(Protocol.isRpcErrorResponse(response));
    assert.equal(response.error.code, Protocol.AUTH_FAILED);

    const existsResponse = await client.call(
      createRequest(Protocol.TOOLS_LIST, {}),
    );
    assert.ok(Protocol.isRpcErrorResponse(existsResponse));
    assert.equal(existsResponse.error.code, Protocol.HANDSHAKE_REQUIRED);
  });

  it('rejects handshakes with a mismatched workspace root', async (t) => {
    const client = await openClient();
    t.after(async () => {
      await client.close();
    });

    const response = await client.call(
      createConnectRequest({ workspaceRoot: '/workspace-other' }),
    );
    assert.ok(Protocol.isRpcErrorResponse(response));
    assert.equal(response.error.code, Protocol.WORKSPACE_MISMATCH);
  });

  it('completes a handshake with capabilities and connection identity', async (t) => {
    const client = await openClient();
    t.after(async () => {
      await client.close();
    });

    const response = await client.call(createConnectRequest());
    assert.ok(Protocol.isRpcSuccessResponse(response));

    const result = expectRecord(response.result);
    assert.equal(expectString(result, 'protocolVersion'), Protocol.DAEMON_PROTOCOL_VERSION);
    assert.equal(expectString(result, 'workspaceRoot'), workspaceRoot);
    assert.ok(expectString(result, 'connectionId').startsWith('c_'));

    const capabilities = expectRecord(result.capabilities);
    assert.equal(capabilities.protocolVersion, Protocol.DAEMON_PROTOCOL_VERSION);
    assert.equal(capabilities.workspaceRoot, workspaceRoot);
    assert.equal('fs' in capabilities, false);
    assert.equal('history' in capabilities, false);
  });

  it('returns METHOD_NOT_FOUND for removed Level-1 SPI methods', async (t) => {
    const client = await openHandshakenClient();
    t.after(async () => {
      await client.close();
    });

    for (const method of ['fs.readFile', 'fs.writeAtomic', 'history.beginSession']) {
      const response = await client.call(createRequest(method, {}));
      assert.ok(Protocol.isRpcErrorResponse(response));
      assert.equal(response.error.code, Protocol.METHOD_NOT_FOUND);
      assert.deepEqual(response.error.data, { method });
    }
  });
});
