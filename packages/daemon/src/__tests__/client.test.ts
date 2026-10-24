import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import * as Protocol from '@brud/protocol';
import type {
  DaemonInfoResult,
  DaemonPingResult,
  RpcSuccessResponse,
} from '@brud/protocol';
import { DaemonClient } from '../client/DaemonClient.js';
import { connectToDaemon } from '../client/connectToDaemon.js';
import {
  DaemonDisconnectedError,
  DaemonNotRunningError,
  DaemonRequestCancelledError,
  DaemonRequestTimeoutError,
  DaemonRpcError,
  DaemonStartupTimeoutError,
} from '../client/errors.js';
import { connectSocket } from '../client/socket.js';
import { spawnDaemon } from '../client/spawn.js';
import { resolveEndpoint } from '../lifecycle/endpoint.js';
import { acquireDaemonLock, isPidAlive } from '../lifecycle/lock.js';
import { NdjsonFramingStream } from '../server/framing.js';
import { createDaemon } from '../server/createDaemon.js';
import type { RunningDaemon } from '../server/createDaemon.js';

const SLOW_METHOD = 'test.slow';
const CANCEL_METHOD = 'request.cancel';

interface FakeCancelRecord {
  readonly method: string;
  readonly params: unknown;
}

class FakeDaemon {
  readonly socketPath: string;

  readonly cancellations: FakeCancelRecord[] = [];

  private readonly server: Server;

  private readonly sockets = new Set<Socket>();

  private acceptedWrites = 0;

  private constructor(socketPath: string) {
    this.socketPath = socketPath;
    this.server = createServer((socket: Socket) => {
      this.accept(socket);
    });
  }

  static async start(directory: string): Promise<FakeDaemon> {
    const socketPath = process.platform === 'win32'
      ? `\\\\.\\pipe\\brud-client-test-${randomUUID()}`
      : join(directory, `fake-${randomUUID()}.sock`);
    const fake = new FakeDaemon(socketPath);

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        fake.server.off('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        fake.server.off('error', onError);
        resolve();
      };

      fake.server.once('error', onError);
      fake.server.once('listening', onListening);
      fake.server.listen(socketPath);
    });

    return fake;
  }

  get writeCount(): number {
    return this.acceptedWrites;
  }

  async connect(): Promise<DaemonClient> {
    const socket = await connectSocket(this.socketPath);
    return new DaemonClient(socket);
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }

    this.sockets.clear();

    await new Promise<void>((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }

  private accept(socket: Socket): void {
    const framing = new NdjsonFramingStream();
    this.sockets.add(socket);

    socket.on('data', (chunk: Buffer) => {
      const messages = framing.push(chunk);

      for (const message of messages) {
        this.handleMessage(message, socket, framing);
      }
    });
    socket.on('close', () => {
      this.sockets.delete(socket);
    });
    socket.on('error', () => {
      this.sockets.delete(socket);
    });
  }

  private handleMessage(
    message: unknown,
    socket: Socket,
    framing: NdjsonFramingStream,
  ): void {
    if (Protocol.isRpcNotification(message)) {
      if (message.method === CANCEL_METHOD) {
        this.cancellations.push({ method: message.method, params: message.params });
      }

      return;
    }

    if (!Protocol.isRpcRequest(message)) {
      return;
    }

    if (message.method === SLOW_METHOD) {
      return;
    }

    if (message.method === Protocol.FS_WRITE_ATOMIC) {
      this.acceptedWrites += 1;
      socket.destroy();
      return;
    }

    const response: RpcSuccessResponse = {
      jsonrpc: '2.0',
      id: message.id,
      result: { method: message.method },
    };

    socket.write(framing.encode(response));
  }
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Condition was not met before the deadline');
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }
}

async function createWorkspace(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  return realpath(path);
}

interface SpawnedMetadata {
  readonly pid: number;
  readonly workspaceRoot: string;
}

function parseSpawnedMetadata(value: unknown): SpawnedMetadata | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  if (!('pid' in value) || !('workspaceRoot' in value)) {
    return undefined;
  }

  const { pid, workspaceRoot } = value;

  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return undefined;
  }

  if (typeof workspaceRoot !== 'string') {
    return undefined;
  }

  return { pid, workspaceRoot };
}

async function stopSpawnedDaemon(workspaceRoot: string): Promise<void> {
  let endpoint;

  try {
    endpoint = await resolveEndpoint(workspaceRoot);
  } catch {
    return;
  }

  let metadata: SpawnedMetadata | undefined;

  try {
    metadata = parseSpawnedMetadata(
      JSON.parse(await readFile(endpoint.metaPath, 'utf8')) as unknown,
    );
  } catch {
    return;
  }

  if (metadata === undefined || metadata.workspaceRoot !== endpoint.workspaceRoot) {
    return;
  }

  if (metadata.pid === process.pid) {
    return;
  }

  try {
    process.kill(metadata.pid, 'SIGTERM');
  } catch {
    return;
  }

  const deadline = Date.now() + 3_000;

  while (isPidAlive(metadata.pid) && Date.now() < deadline) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }

  if (isPidAlive(metadata.pid)) {
    try {
      process.kill(metadata.pid, 'SIGKILL');
    } catch {
      return;
    }
  }
}

let root = '';
let runningWorkspace = '';
let coldWorkspace = '';
let timeoutWorkspace = '';
let idleWorkspace = '';
let previousRuntimeDir: string | undefined;
let runningDaemon: RunningDaemon | undefined;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'brud-client-'));
  previousRuntimeDir = process.env.BRUD_DAEMON_RUNTIME_DIR;
  process.env.BRUD_DAEMON_RUNTIME_DIR = join(root, 'runtime');

  runningWorkspace = await createWorkspace(join(root, 'running'));
  coldWorkspace = await createWorkspace(join(root, 'cold'));
  timeoutWorkspace = await createWorkspace(join(root, 'timeout'));
  idleWorkspace = await createWorkspace(join(root, 'idle'));

  runningDaemon = await createDaemon({ workspaceRoot: runningWorkspace });
});

after(async () => {
  await stopSpawnedDaemon(coldWorkspace);
  await stopSpawnedDaemon(timeoutWorkspace);

  if (runningDaemon !== undefined) {
    await runningDaemon.shutdown();
  }

  if (previousRuntimeDir === undefined) {
    delete process.env.BRUD_DAEMON_RUNTIME_DIR;
  } else {
    process.env.BRUD_DAEMON_RUNTIME_DIR = previousRuntimeDir;
  }

  await rm(root, { recursive: true, force: true });
});

describe('daemon client', () => {
  it('connects to an already-running daemon and completes the handshake', async (t) => {
    const client = await connectToDaemon({ workspaceRoot: runningWorkspace });

    t.after(async () => {
      await client.close();
    });

    assert.equal(client.isConnected, true);

    const handshake = client.handshake;
    assert.ok(handshake !== undefined);
    assert.equal(handshake.workspaceRoot, await realpath(runningWorkspace));
    assert.equal(handshake.server.pid, process.pid);
    assert.equal(handshake.protocolVersion, Protocol.DAEMON_PROTOCOL_VERSION);
    assert.deepEqual(handshake.capabilities.fs, [...Protocol.FS_METHODS]);

    const ping = await client.request<DaemonPingResult>(Protocol.DAEMON_PING, {
      nonce: 'client-ping',
    });
    assert.equal(ping.nonce, 'client-ping');

    const info = await client.request<DaemonInfoResult>(Protocol.DAEMON_INFO, {});
    assert.equal(info.workspaceRoot, handshake.workspaceRoot);
    assert.equal(info.pid, process.pid);
  });

  it('reuses a responsive daemon when spawnIfMissing is disabled', async (t) => {
    const client = await connectToDaemon({
      workspaceRoot: runningWorkspace,
      spawnIfMissing: false,
    });

    t.after(async () => {
      await client.close();
    });

    assert.ok(client.handshake !== undefined);
    assert.equal(client.handshake.server.pid, process.pid);
  });

  it('reads, writes, probes, and lists through the typed filesystem helpers', async (t) => {
    const client = await connectToDaemon({ workspaceRoot: runningWorkspace });

    t.after(async () => {
      await client.close();
    });

    const text = 'héllo daemon client';

    const writeResult = await client.fsWriteAtomic('notes/hello.md', text);
    assert.equal(writeResult.path, 'notes/hello.md');
    assert.equal(writeResult.bytesWritten, Buffer.byteLength(text, 'utf8'));

    assert.equal(await client.fsReadFile('notes/hello.md'), text);
    assert.equal(
      Buffer.from(await client.fsReadFile('notes/hello.md', 'base64'), 'base64').toString('utf8'),
      text,
    );

    assert.equal(await client.fsExists('notes/hello.md'), true);
    assert.equal(await client.fsExists('notes/missing.md'), false);

    await client.fsWriteAtomic('notes/second.md', 'second');

    const entries = await client.fsList('notes');
    assert.deepEqual(
      entries.map((entry) => entry.name).sort(),
      ['hello.md', 'second.md'],
    );
    assert.equal(entries.find((entry) => entry.name === 'hello.md')?.isFile, true);

    const limited = await client.fsList('notes', 1);
    assert.equal(limited.length, 1);

    const bytes = new Uint8Array([0, 1, 2, 255]);
    await client.fsWriteAtomic('notes/blob.bin', bytes);
    assert.equal(
      await client.fsReadFile('notes/blob.bin', 'base64'),
      Buffer.from(bytes).toString('base64'),
    );
  });

  it('translates wire errors into typed DaemonRpcError instances', async (t) => {
    const client = await connectToDaemon({ workspaceRoot: runningWorkspace });

    t.after(async () => {
      await client.close();
    });

    await assert.rejects(
      () => client.request(Protocol.FS_READ_FILE, { path: '../escape.txt' }),
      (error: unknown) => {
        assert.ok(error instanceof DaemonRpcError);
        assert.equal(error.code, Protocol.PATH_VIOLATION);
        assert.equal(error.details?.rule, 'TRAVERSAL');
        assert.equal(error.method, Protocol.FS_READ_FILE);
        return true;
      },
    );
  });

  it('rejects requests that exceed their timeout and sends a cancellation frame', async (t) => {
    const fake = await FakeDaemon.start(root);
    const client = await fake.connect();

    t.after(async () => {
      await client.close();
      await fake.close();
    });

    await assert.rejects(
      () => client.request(SLOW_METHOD, {}, { timeoutMs: 60 }),
      (error: unknown) => {
        assert.ok(error instanceof DaemonRequestTimeoutError);
        assert.equal(error.method, SLOW_METHOD);
        assert.equal(error.timeoutMs, 60);
        return true;
      },
    );

    await waitFor(() => fake.cancellations.length === 1);

    const cancellation = fake.cancellations[0];
    assert.ok(cancellation !== undefined);
    assert.equal(cancellation.method, CANCEL_METHOD);
    assert.deepEqual(cancellation.params, { id: 1 });
  });

  it('cancels in-flight requests through an AbortSignal', async (t) => {
    const fake = await FakeDaemon.start(root);
    const client = await fake.connect();

    t.after(async () => {
      await client.close();
      await fake.close();
    });

    const controller = new AbortController();
    const pending = client.request(SLOW_METHOD, {}, {
      timeoutMs: 5_000,
      signal: controller.signal,
    });

    controller.abort();

    await assert.rejects(pending, (error: unknown) => {
      assert.ok(error instanceof DaemonRequestCancelledError);
      assert.equal(error.method, SLOW_METHOD);
      return true;
    });

    await waitFor(() => fake.cancellations.length === 1);
    assert.deepEqual(fake.cancellations[0]?.params, { id: 1 });
  });

  it('does not retry writes when the socket drops mid-request', async (t) => {
    const fake = await FakeDaemon.start(root);
    const client = await fake.connect();

    t.after(async () => {
      await client.close();
      await fake.close();
    });

    await assert.rejects(
      () => client.fsWriteAtomic('dropped.txt', 'payload'),
      (error: unknown) => {
        assert.ok(error instanceof DaemonDisconnectedError);
        return true;
      },
    );

    assert.equal(fake.writeCount, 1);
    assert.equal(client.isConnected, false);

    await assert.rejects(
      () => client.fsWriteAtomic('dropped.txt', 'payload'),
      DaemonDisconnectedError,
    );
    assert.equal(fake.writeCount, 1);
  });

  it('refuses a cold workspace when spawnIfMissing is disabled', async () => {
    const canonicalRoot = await realpath(idleWorkspace);

    await assert.rejects(
      () => connectToDaemon({ workspaceRoot: idleWorkspace, spawnIfMissing: false }),
      (error: unknown) => {
        assert.ok(error instanceof DaemonNotRunningError);
        assert.equal(error.workspaceRoot, canonicalRoot);
        return true;
      },
    );
  });

  it('spawns a detached daemon on demand and connects to it', async (t) => {
    let client: DaemonClient | undefined;
    let secondClient: DaemonClient | undefined;

    t.after(async () => {
      await secondClient?.close();
      await client?.close();
      await stopSpawnedDaemon(coldWorkspace);
    });

    client = await connectToDaemon({ workspaceRoot: coldWorkspace, timeoutMs: 10_000 });

    assert.ok(client.handshake !== undefined);
    assert.notEqual(client.handshake.server.pid, process.pid);
    assert.equal(client.handshake.workspaceRoot, await realpath(coldWorkspace));

    await client.fsWriteAtomic('cold/created.txt', 'spawned daemon');
    assert.equal(await client.fsReadFile('cold/created.txt'), 'spawned daemon');
    assert.equal(
      await readFile(join(coldWorkspace, 'cold', 'created.txt'), 'utf8'),
      'spawned daemon',
    );

    secondClient = await connectToDaemon({
      workspaceRoot: coldWorkspace,
      spawnIfMissing: false,
    });

    assert.ok(secondClient.handshake !== undefined);
    assert.equal(secondClient.handshake.server.pid, client.handshake.server.pid);
  });

  it('throws DaemonStartupTimeoutError when a controlled daemon cannot start', async () => {
    const endpoint = await resolveEndpoint(timeoutWorkspace);
    const lock = await acquireDaemonLock(endpoint, {
      pid: process.pid,
      version: '0.0.1-test',
    });

    try {
      await assert.rejects(
        () => spawnDaemon(timeoutWorkspace, { timeoutMs: 400 }),
        (error: unknown) => {
          assert.ok(error instanceof DaemonStartupTimeoutError);
          assert.equal(error.timeoutMs, 400);
          return true;
        },
      );
    } finally {
      await lock.release();
    }
  });
});
