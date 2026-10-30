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
import type { BrudKernel, IStorageDriver } from '@brud/kernel' with { 'resolution-mode': 'import' };
import { DaemonServer } from '../server/DaemonServer.js';

const WORKSPACE_ROOT = '/workspace';
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
    workspaceRoot: WORKSPACE_ROOT,
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
let driver: IStorageDriver | undefined;
let server: DaemonServer | undefined;
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
    const storageDriver = new kernelModule.InMemoryStorageDriver();

    const createdKernel = kernelModule.createStandardKernel({
      storageDriver,
      history: { inMemory: true },
    });
    await createdKernel.boot({ workspaceRoot: WORKSPACE_ROOT });
    kernel = createdKernel;
    driver = storageDriver;

    tempDirectory = await mkdtemp(join(tmpdir(), 'brud-daemon-test-'));
    socketPath = join(tempDirectory, 'daemon.sock');

    server = await DaemonServer.create({
      kernel: createdKernel,
      socketPath,
      token: TOKEN,
      workspaceRoot: WORKSPACE_ROOT,
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
      createRequest(Protocol.FS_EXISTS, { path: 'anything.txt' }),
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
    assert.equal(expectString(result, 'workspaceRoot'), WORKSPACE_ROOT);
    assert.ok(expectString(result, 'connectionId').startsWith('c_'));

    const capabilities = expectRecord(result.capabilities);
    assert.deepEqual(capabilities.history, [...Protocol.HISTORY_CAPABILITIES]);
    assert.deepEqual(capabilities.fs, [...Protocol.FS_METHODS]);
  });

  it('writes, reads, and probes a file atomically', async (t) => {
    const client = await openHandshakenClient();
    t.after(async () => {
      await client.close();
    });

    const content = 'héllo daemon';
    const writeResponse = await client.call(
      createRequest(Protocol.FS_WRITE_ATOMIC, { path: 'notes.md', data: content }),
    );
    assert.ok(Protocol.isRpcSuccessResponse(writeResponse));
    assert.deepEqual(writeResponse.result, {
      path: 'notes.md',
      bytesWritten: Buffer.byteLength(content, 'utf8'),
    });

    const readResponse = await client.call(
      createRequest(Protocol.FS_READ_FILE, { path: 'notes.md' }),
    );
    assert.ok(Protocol.isRpcSuccessResponse(readResponse));
    assert.deepEqual(readResponse.result, {
      path: 'notes.md',
      encoding: 'utf8',
      data: content,
    });

    const base64Response = await client.call(
      createRequest(Protocol.FS_READ_FILE, { path: 'notes.md', encoding: 'base64' }),
    );
    assert.ok(Protocol.isRpcSuccessResponse(base64Response));
    const base64Result = expectRecord(base64Response.result);
    const encoded = expectString(base64Result, 'data');
    assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), content);

    const existsResponse = await client.call(
      createRequest(Protocol.FS_EXISTS, { path: 'notes.md' }),
    );
    assert.ok(Protocol.isRpcSuccessResponse(existsResponse));
    assert.deepEqual(existsResponse.result, { path: 'notes.md', exists: true });

    const missingResponse = await client.call(
      createRequest(Protocol.FS_EXISTS, { path: 'missing.md' }),
    );
    assert.ok(Protocol.isRpcSuccessResponse(missingResponse));
    assert.deepEqual(missingResponse.result, { path: 'missing.md', exists: false });
  });

  it('lists directory contents through readDirectory', async (t) => {
    assert.ok(driver !== undefined, 'Storage driver is not initialized');
    const client = await openHandshakenClient();
    t.after(async () => {
      await client.close();
    });

    await driver.mkdir(join(WORKSPACE_ROOT, 'listing'));
    await driver.mkdir(join(WORKSPACE_ROOT, 'listing', 'nested'));

    const writeResponse = await client.call(
      createRequest(Protocol.FS_WRITE_ATOMIC, {
        path: 'listing/alpha.txt',
        data: 'alpha',
      }),
    );
    assert.ok(Protocol.isRpcSuccessResponse(writeResponse));

    const listResponse = await client.call(
      createRequest(Protocol.FS_LIST, { path: 'listing' }),
    );
    assert.ok(Protocol.isRpcSuccessResponse(listResponse));

    const result = expectRecord(listResponse.result);
    assert.equal(expectString(result, 'path'), 'listing');
    const entries = result.entries;
    assert.ok(isUnknownArray(entries));

    const mapped = entries.map((entry: unknown) => {
      const record = expectRecord(entry);
      return {
        name: expectString(record, 'name'),
        isFile: record.isFile,
        isDirectory: record.isDirectory,
      };
    });

    assert.deepEqual(mapped, [
      { name: 'alpha.txt', isFile: true, isDirectory: false },
      { name: 'nested', isFile: false, isDirectory: true },
    ]);
  });

  it('drives a history session end-to-end over the socket', async (t) => {
    const client = await openHandshakenClient();
    t.after(async () => {
      await client.close();
    });

    const path = 'history/phase4.txt';
    await client.call(
      createRequest(Protocol.FS_WRITE_ATOMIC, { path, data: 'before\n' }),
    );

    const beginResponse = await client.call(
      createRequest(Protocol.HISTORY_BEGIN_SESSION, {
        prompt: 'daemon history lifecycle',
        targets: [path],
      }),
    );
    assert.ok(Protocol.isRpcSuccessResponse(beginResponse));
    const beginResult = expectRecord(beginResponse.result);
    const sessionId = expectString(beginResult, 'sessionId');
    assert.match(sessionId, /^BR-\d{8}-\d{3}$/u);

    await client.call(
      createRequest(Protocol.FS_WRITE_ATOMIC, { path, data: 'after\n' }),
    );

    const commitResponse = await client.call(
      createRequest(Protocol.HISTORY_COMMIT_SESSION, { sessionId }),
    );
    assert.ok(Protocol.isRpcSuccessResponse(commitResponse));
    const commitResult = expectRecord(commitResponse.result);
    assert.equal(commitResult.sessionId, sessionId);
    assert.equal(commitResult.committedFileCount, 1);

    const getResponse = await client.call(
      createRequest(Protocol.HISTORY_GET, { sessionId }),
    );
    assert.ok(Protocol.isRpcSuccessResponse(getResponse));
    const getResult = expectRecord(getResponse.result);
    const manifest = expectRecord(getResult.session);
    assert.equal(manifest.sessionId, sessionId);
    assert.equal(manifest.status, 'committed');
    assert.deepEqual(manifest.filesAffected, [path]);

    const listResponse = await client.call(
      createRequest(Protocol.HISTORY_LIST, { limit: 10 }),
    );
    assert.ok(Protocol.isRpcSuccessResponse(listResponse));
    const listResult = expectRecord(listResponse.result);
    assert.ok(isUnknownArray(listResult.sessions));
    const listed = listResult.sessions.map((entry: unknown) => expectRecord(entry));
    assert.ok(listed.some((row) => row.session_id === sessionId));

    const revertResponse = await client.call(
      createRequest(Protocol.HISTORY_REVERT, { sessionId }),
    );
    assert.ok(Protocol.isRpcSuccessResponse(revertResponse));
    const revertResult = expectRecord(revertResponse.result);
    assert.equal(revertResult.isExecutable, true);
    assert.deepEqual(revertResult.conflicts, []);
    const receipt = expectRecord(revertResult.receipt);
    assert.equal(receipt.sessionId, sessionId);
    assert.equal(receipt.targetState, 'pre');
    assert.equal(receipt.filesRestored, 1);

    const readResponse = await client.call(
      createRequest(Protocol.FS_READ_FILE, { path }),
    );
    assert.ok(Protocol.isRpcSuccessResponse(readResponse));
    const readResult = expectRecord(readResponse.result);
    assert.equal(expectString(readResult, 'data'), 'before\n');

    const revertedResponse = await client.call(
      createRequest(Protocol.HISTORY_GET, { sessionId }),
    );
    assert.ok(Protocol.isRpcSuccessResponse(revertedResponse));
    const revertedResult = expectRecord(revertedResponse.result);
    const revertedManifest = expectRecord(revertedResult.session);
    assert.equal(revertedManifest.status, 'reverted');
  });

  it('returns non-executable plans with conflicts when a reversal is stale', async (t) => {
    const client = await openHandshakenClient();
    t.after(async () => {
      await client.close();
    });

    const path = 'history/tampered.txt';
    await client.call(
      createRequest(Protocol.FS_WRITE_ATOMIC, { path, data: 'before\n' }),
    );

    const beginResponse = await client.call(
      createRequest(Protocol.HISTORY_BEGIN_SESSION, {
        prompt: 'daemon stale reversal',
        targets: [path],
      }),
    );
    assert.ok(Protocol.isRpcSuccessResponse(beginResponse));
    const sessionId = expectString(expectRecord(beginResponse.result), 'sessionId');

    await client.call(
      createRequest(Protocol.FS_WRITE_ATOMIC, { path, data: 'after\n' }),
    );
    const commitResponse = await client.call(
      createRequest(Protocol.HISTORY_COMMIT_SESSION, { sessionId }),
    );
    assert.ok(Protocol.isRpcSuccessResponse(commitResponse));

    await client.call(
      createRequest(Protocol.FS_WRITE_ATOMIC, { path, data: 'tampered\n' }),
    );

    const revertResponse = await client.call(
      createRequest(Protocol.HISTORY_REVERT, { sessionId }),
    );
    assert.ok(Protocol.isRpcSuccessResponse(revertResponse));
    const result = expectRecord(revertResponse.result);
    assert.equal(result.isExecutable, false);
    assert.equal(result.receipt, null);
    assert.ok(isUnknownArray(result.conflicts));
    const conflicts = result.conflicts.map((entry: unknown) => expectRecord(entry));
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]?.code, 'STALE_BASELINE_CONFLICT');
    assert.equal(conflicts[0]?.relativePath, path);
  });

  it('translates kernel path violations into JSON-RPC errors', async (t) => {
    const client = await openHandshakenClient();
    t.after(async () => {
      await client.close();
    });

    const response = await client.call(
      createRequest(Protocol.FS_READ_FILE, { path: '../escape.txt' }),
    );
    assert.ok(Protocol.isRpcErrorResponse(response));
    assert.equal(response.error.code, Protocol.PATH_VIOLATION);
    assert.ok(response.error.data !== undefined);
    assert.equal(response.error.data.errorCode, 'PATH_TRAVERSAL_DETECTED');
    assert.equal(response.error.data.rule, 'TRAVERSAL');
  });

  it('translates an absolute path outside the workspace into PATH_VIOLATION', async (t) => {
    const client = await openHandshakenClient();
    t.after(async () => {
      await client.close();
    });

    const response = await client.call(
      createRequest(Protocol.FS_READ_FILE, { path: '/etc/passwd' }),
    );
    assert.ok(Protocol.isRpcErrorResponse(response));
    assert.equal(response.error.code, Protocol.PATH_VIOLATION);
    assert.ok(response.error.data !== undefined);
    assert.equal(response.error.data.errorCode, 'PATH_TRAVERSAL_DETECTED');
    assert.equal(response.error.data.rule, 'OUTSIDE_ROOT');
    assert.equal(response.error.data.path, '/etc/passwd');
  });

  it('translates a protected-path write into PATH_VIOLATION', async (t) => {
    const client = await openHandshakenClient();
    t.after(async () => {
      await client.close();
    });

    const response = await client.call(
      createRequest(Protocol.FS_WRITE_ATOMIC, { path: '.brud/settings.json', data: '{}' }),
    );
    assert.ok(Protocol.isRpcErrorResponse(response));
    assert.equal(response.error.code, Protocol.PATH_VIOLATION);
    assert.ok(response.error.data !== undefined);
    assert.equal(response.error.data.errorCode, 'PATH_TRAVERSAL_DETECTED');
    assert.equal(response.error.data.rule, 'PROTECTED_PATH_DENIED');
    assert.equal(response.error.data.path, '.brud/settings.json');
  });

  it('reports file metadata through fs.stat', async (t) => {
    const client = await openHandshakenClient();
    t.after(async () => {
      await client.close();
    });

    const response = await client.call(
      createRequest(Protocol.FS_STAT, { path: 'notes.md' }),
    );
    assert.ok(Protocol.isRpcSuccessResponse(response));

    const result = expectRecord(response.result);
    assert.equal(expectString(result, 'path'), 'notes.md');
    const stat = expectRecord(result.stat);
    assert.equal(stat.isFile, true);
    assert.equal(stat.isDirectory, false);
    assert.ok(typeof stat.size === 'number');
    assert.ok(typeof stat.mtimeMs === 'number');
  });
});
