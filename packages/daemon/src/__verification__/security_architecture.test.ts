/**
 * Production-mirror coverage for `docs/architecture/SECURITY_ARCHITECTURE.md`.
 *
 * Every test uses the real daemon, the real kernel, a real Unix-domain socket,
 * the real Noise NNpsk0 handshake, and the real AEAD record layer. The relay
 * tests add a real byte-level middle party; they do not mock the channel.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, createConnection } from 'node:net';
import type { Server, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Protocol from '@brud/protocol';
import { createDaemon } from '../server/createDaemon.js';
import type { RunningDaemon } from '../server/createDaemon.js';
import { DaemonServer } from '../server/DaemonServer.js';
import { WorkspaceRegistry } from '../workspaceRegistry.js';
import { DaemonClient } from '../client/DaemonClient.js';
import { DaemonRpcError } from '../client/errors.js';
import { connectToDaemon } from '../client/connectToDaemon.js';
import { connectSocket } from '../client/socket.js';
import { channelPrologue } from '../security/channel.js';
import { verifyEndpointOwnership } from '../security/ownership.js';
import { RawJsonRpcClient } from './harness.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

async function makeWorkspace(prefix: string): Promise<string> {
  return await realpath(await mkdtemp(join(tmpdir(), prefix)));
}

async function secureClient(
  daemon: RunningDaemon,
  principal: 'ui' | 'ai' = 'ui',
): Promise<DaemonClient> {
  return await connectToDaemon({
    workspaceRoot: daemon.endpoint.workspaceRoot,
    tier: principal,
    spawnIfMissing: false,
    handshakeTimeoutMs: 5_000,
  });
}

async function rawClient(
  daemon: RunningDaemon,
  principal: 'ui' | 'ai' = 'ui',
  workspaceRoot: string = daemon.endpoint.workspaceRoot,
): Promise<RawJsonRpcClient> {
  return await RawJsonRpcClient.connect(daemon.endpoint.socketPath, {
    psk: daemon.tokens[principal],
    principal,
    workspaceRoot,
    prologue: channelPrologue(daemon.endpoint.socketPath),
  });
}

/**
 * Real byte-level relay in front of the daemon socket.
 *
 * It forwards both directions, records every byte, and can tamper with or
 * replay one client-to-server frame. It has no session keys.
 */
class Relay {
  readonly socketPath: string;

  private readonly directory: string;

  private readonly server: Server;

  private readonly upstreamPath: string;

  private readonly action: RelayAction;

  private readonly sockets = new Set<Socket>();

  readonly clientToServer: Buffer[] = [];

  readonly serverToClient: Buffer[] = [];

  private constructor(directory: string, socketPath: string, upstreamPath: string, action: RelayAction, server: Server) {
    this.directory = directory;
    this.socketPath = socketPath;
    this.upstreamPath = upstreamPath;
    this.action = action;
    this.server = server;
  }

  static async open(upstreamPath: string, action: RelayAction): Promise<Relay> {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'brud-relay-')));
    const socketPath = join(directory, 'relay.sock');
    let relay: Relay | undefined;

    const previousUmask = process.platform === 'win32' ? undefined : process.umask(0o177);
    let server: Server;

    try {
      server = createServer((downstream) => {
        relay?.attach(downstream);
      });

      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, () => {
          server.off('error', reject);
          resolve();
        });
      });
    } finally {
      if (previousUmask !== undefined) {
        process.umask(previousUmask);
      }
    }

    relay = new Relay(directory, socketPath, upstreamPath, action, server);
    await chmod(socketPath, 0o600);

    return relay;
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }

    this.sockets.clear();
    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
    await rm(this.directory, { recursive: true, force: true });
  }

  private attach(downstream: Socket): void {
    const upstream = createConnection(this.upstreamPath);
    this.sockets.add(downstream);
    this.sockets.add(upstream);

    const toServer = new FrameRelay(this.action, (frame) => {
      this.clientToServer.push(frame);
      upstream.write(frame);
    });
    const toClient = new FrameRelay({ kind: 'passive' }, (frame) => {
      this.serverToClient.push(frame);
      downstream.write(frame);
    });

    downstream.on('data', (chunk: Buffer) => {
      toServer.push(chunk);
    });
    upstream.on('data', (chunk: Buffer) => {
      toClient.push(chunk);
    });
    downstream.on('close', () => upstream.destroy());
    upstream.on('close', () => downstream.destroy());
    downstream.on('error', () => upstream.destroy());
    upstream.on('error', () => downstream.destroy());
  }
}

type RelayAction =
  | { readonly kind: 'passive' }
  | { readonly kind: 'flip-tag'; readonly frame: number }
  | { readonly kind: 'flip-type'; readonly frame: number }
  | { readonly kind: 'replay'; readonly frame: number };

/** Reassembles length-prefixed frames and optionally transforms one. */
class FrameRelay {
  private buffer: Buffer = Buffer.alloc(0);

  private frameIndex = 0;

  constructor(
    private readonly action: RelayAction,
    private readonly forward: (frame: Buffer) => void,
  ) {}

  push(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    for (;;) {
      if (this.buffer.length < 4) {
        return;
      }

      const length = this.buffer.readUInt32BE(0);

      if (this.buffer.length < 4 + length) {
        return;
      }

      const payload = Buffer.from(this.buffer.subarray(4, 4 + length));
      this.buffer = this.buffer.subarray(4 + length);
      this.frameIndex += 1;

      this.handle(payload);
    }
  }

  private handle(payload: Buffer): void {
    const frame = Buffer.allocUnsafe(4 + payload.length);
    frame.writeUInt32BE(payload.length, 0);
    payload.copy(frame, 4);

    if (this.action.kind === 'passive' || this.action.frame !== this.frameIndex) {
      this.forward(frame);
      return;
    }

    if (this.action.kind === 'flip-tag') {
      const tampered = Buffer.from(frame);
      tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
      this.forward(tampered);
      return;
    }

    if (this.action.kind === 'flip-type') {
      const tampered = Buffer.from(frame);
      tampered[4] = (tampered[4] ?? 1) === 1 ? 3 : 1;
      this.forward(tampered);
      return;
    }

    this.forward(frame);
    this.forward(Buffer.from(frame));
  }
}

const daemons: RunningDaemon[] = [];

async function startDaemon(options: {
  maxConnections?: number;
  maxInFlightPerConnection?: number;
  requestTimeoutMs?: number;
  prefix?: string;
} = {}): Promise<RunningDaemon> {
  const workspaceRoot = await makeWorkspace(options.prefix ?? 'brud-sec-');
  const daemon = await createDaemon({
    workspaceRoot,
    ...(options.maxConnections === undefined ? {} : { maxConnections: options.maxConnections }),
    ...(options.maxInFlightPerConnection === undefined
      ? {}
      : { maxInFlightPerConnection: options.maxInFlightPerConnection }),
    ...(options.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: options.requestTimeoutMs }),
  });
  daemons.push(daemon);

  return daemon;
}

after(async () => {
  for (const daemon of daemons.splice(0)) {
    await daemon.shutdown().catch(() => undefined);
    await rm(daemon.endpoint.workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe('D-01 — OS-verified endpoint identity', () => {
  it('binds an owner-only socket and owner-only principal keys', async () => {
    const daemon = await startDaemon({ prefix: 'brud-sec-d01-' });

    if (process.platform !== 'win32') {
      const socket = await stat(daemon.endpoint.socketPath);
      assert.equal(socket.uid, process.getuid?.());
      assert.equal(socket.mode & 0o077, 0, 'socket must not be group/world accessible');

      const ownership = await verifyEndpointOwnership(daemon.endpoint.socketPath);
      assert.equal(ownership.status, 'verified');

      const token = await stat(daemon.endpoint.tokenPath);
      const aiToken = await stat(daemon.endpoint.aiTokenPath);
      assert.equal(token.mode & 0o077, 0);
      assert.equal(aiToken.mode & 0o077, 0);
    }
  });

  it('refuses an endpoint that group or world users can reach', async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'brud-sec-rogue-')));
    const socketPath = join(directory, 'rogue.sock');
    const server = createServer();

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, () => {
          server.off('error', reject);
          resolve();
        });
      });
      await chmod(socketPath, 0o666);

      await assert.rejects(
        () => connectSocket(socketPath),
        /insecure mode|ownership/i,
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('D-02 / D-03 — authenticated key exchange and AEAD records', () => {
  it('authenticates both ends and hides request content from a passive relay', async () => {
    const daemon = await startDaemon({ prefix: 'brud-sec-eavesdrop-' });
    const relay = await Relay.open(daemon.endpoint.socketPath, { kind: 'passive' });

    try {
      const socket = await connectSocket(relay.socketPath);
      const client = new DaemonClient(socket, {
        psk: daemon.tokens.ui,
        principal: 'ui',
        workspaceRoot: daemon.endpoint.workspaceRoot,
        prologue: channelPrologue(daemon.endpoint.socketPath),
      });

      await client.connect({ protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION });

      const result = await client.request<Protocol.ToolsExecuteResult>(
        Protocol.TOOLS_EXECUTE,
        {
          name: 'create_file',
          input: { path: 'eavesdrop.txt', content: 'TOP_SECRET_MARKER_4f8a\n' },
        },
      );

      assert.equal(result.result.status, 'success', String(result.result.error));
      await client.close();

      const wire = Buffer.concat([...relay.clientToServer, ...relay.serverToClient]);
      const text = wire.toString('latin1');

      assert.equal(
        text.includes('TOP_SECRET_MARKER_4f8a'),
        false,
        'plaintext request content appeared on the wire',
      );
      assert.equal(
        text.includes(daemon.endpoint.workspaceRoot),
        false,
        'workspace path appeared on the wire',
      );
      assert.equal(existsSync(join(daemon.endpoint.workspaceRoot, 'eavesdrop.txt')), true);
    } finally {
      await relay.close();
    }
  });

  it('rejects a tampered record and does not execute it', async () => {
    const daemon = await startDaemon({ prefix: 'brud-sec-tamper-' });
    // Frame 1 is the Noise initiator message, frame 2 is daemon.connect, and
    // frame 3 is the tools.execute request.
    const relay = await Relay.open(daemon.endpoint.socketPath, { kind: 'flip-tag', frame: 3 });

    try {
      const socket = await connectSocket(relay.socketPath);
      const client = new DaemonClient(socket, {
        psk: daemon.tokens.ui,
        principal: 'ui',
        workspaceRoot: daemon.endpoint.workspaceRoot,
        prologue: channelPrologue(daemon.endpoint.socketPath),
      });

      await client.connect({ protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION });

      await assert.rejects(
        () => client.request(Protocol.TOOLS_EXECUTE, {
          name: 'create_file',
          input: { path: 'tampered.txt', content: 'must not exist\n' },
        }),
        (error: unknown) => error instanceof Error,
      );

      await delay(300);
      assert.equal(daemon.isShuttingDown(), false);
      assert.equal(existsSync(join(daemon.endpoint.workspaceRoot, 'tampered.txt')), false);
      await client.close().catch(() => undefined);
    } finally {
      await relay.close();
    }

    const recovered = await secureClient(daemon);
    const response = await recovered.request(Protocol.TOOLS_LIST, {});
    assert.ok(Array.isArray((response as Protocol.ToolsListResult).tools));
    await recovered.close();
  });

  it('rejects a reflected record whose authenticated type was changed', async () => {
    const daemon = await startDaemon({ prefix: 'brud-sec-reflect-' });
    const relay = await Relay.open(daemon.endpoint.socketPath, { kind: 'flip-type', frame: 3 });

    try {
      const socket = await connectSocket(relay.socketPath);
      const client = new DaemonClient(socket, {
        psk: daemon.tokens.ui,
        principal: 'ui',
        workspaceRoot: daemon.endpoint.workspaceRoot,
        prologue: channelPrologue(daemon.endpoint.socketPath),
      });

      await client.connect({ protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION });

      await assert.rejects(
        () => client.request(Protocol.TOOLS_EXECUTE, {
          name: 'create_file',
          input: { path: 'reflected.txt', content: 'must not exist\n' },
        }),
        (error: unknown) => error instanceof Error,
      );

      await delay(300);
      assert.equal(existsSync(join(daemon.endpoint.workspaceRoot, 'reflected.txt')), false);
      await client.close().catch(() => undefined);
    } finally {
      await relay.close();
    }
  });

  it('rejects a replayed record and executes the operation only once', async () => {
    const daemon = await startDaemon({ prefix: 'brud-sec-replay-' });
    const target = join(daemon.endpoint.workspaceRoot, 'replay.txt');
    await writeFile(target, '', 'utf8');

    const relay = await Relay.open(daemon.endpoint.socketPath, { kind: 'replay', frame: 3 });

    try {
      const socket = await connectSocket(relay.socketPath);
      const client = new DaemonClient(socket, {
        psk: daemon.tokens.ui,
        principal: 'ui',
        workspaceRoot: daemon.endpoint.workspaceRoot,
        prologue: channelPrologue(daemon.endpoint.socketPath),
      });

      await client.connect({ protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION });

      try {
        await client.request(Protocol.TOOLS_EXECUTE, {
          name: 'append_file',
          input: { path: 'replay.txt', content: 'one-line\n' },
        });
      } catch {
        // The daemon closes the connection when the replay fails the AEAD tag.
      }

      await delay(500);
      await client.close().catch(() => undefined);
    } finally {
      await relay.close();
    }

    const content = await readFile(target, 'utf8');
    const lines = content.split('\n').filter((line) => line.length > 0);
    assert.ok(
      lines.length <= 1,
      `replayed operation executed more than once: ${JSON.stringify(content)}`,
    );
    assert.equal(daemon.isShuttingDown(), false);

    const recovered = await secureClient(daemon);
    try {
      const response = await recovered.request(Protocol.TOOLS_LIST, {});
      assert.ok(Array.isArray((response as Protocol.ToolsListResult).tools));
    } finally {
      await recovered.close();
    }
  });
});

describe('D-04 — authenticated principal and scope', () => {
  it('fixes the principal from the key that authenticated', async () => {
    const daemon = await startDaemon({ prefix: 'brud-sec-principal-' });

    const ui = await secureClient(daemon, 'ui');
    const ai = await secureClient(daemon, 'ai');

    try {
      assert.equal(ui.handshake?.tier, 'ui');
      assert.equal(ai.handshake?.tier, 'ai');

      const tools = await ai.request<Protocol.ToolsListResult>(Protocol.TOOLS_LIST, {});
      assert.ok(tools.tools.length > 0);

      await assert.rejects(
        () => ai.request(Protocol.ACTIONS_LIST, {}),
        (error: unknown) => {
          assert.ok(error instanceof DaemonRpcError);
          assert.equal(error.code, -32003);
          assert.equal(error.details?.errorCode, 'UNAUTHORIZED_TIER');
          return true;
        },
      );

      const actions = await ui.request<Protocol.ActionsListResult>(Protocol.ACTIONS_LIST, {});
      assert.ok(actions.length > 0);
    } finally {
      await ui.close();
      await ai.close();
    }
  });

  it('rejects a request that tries to assert a tier or token in daemon.connect', async () => {
    const daemon = await startDaemon({ prefix: 'brud-sec-claim-' });
    const raw = await rawClient(daemon);

    try {
      const claim = await raw.request(Protocol.DAEMON_CONNECT, {
        protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
        tier: 'ui',
        token: daemon.tokens.ui,
      });

      assert.equal(claim.error?.code, Protocol.INVALID_REQUEST, JSON.stringify(claim));

      const valid = await raw.request(Protocol.DAEMON_CONNECT, {
        protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
      });
      assert.equal(valid.error, undefined, JSON.stringify(valid));
    } finally {
      await raw.close();
    }
  });

  it('confines workspace.list, workspace.status and workspace.dispose to the session scope', async () => {
    const rootA = await makeWorkspace('brud-sec-scope-a-');
    const rootB = await makeWorkspace('brud-sec-scope-b-');
    const registry = new WorkspaceRegistry();
    await registry.spawn(rootA);
    await registry.spawn(rootB);

    const socketPath = join(await makeWorkspace('brud-sec-scope-sock-'), 'd.sock');
    const ui = 'scope-ui-token';
    const ai = 'scope-ai-token';
    const server = await DaemonServer.create({
      registry,
      socketPath,
      principals: { ui, ai },
      workspaceRoot: rootA,
    });
    await server.listen();

    const socketA = await connectSocket(socketPath);
    const clientA = new DaemonClient(socketA, {
      psk: ui,
      principal: 'ui',
      workspaceRoot: rootA,
      prologue: channelPrologue(socketPath),
    });

    try {
      await clientA.connect({ protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION });

      const listed = await clientA.request<Protocol.WorkspaceListResult>(
        Protocol.WORKSPACE_LIST,
        {},
      );
      assert.deepEqual(listed.workspaces.map((workspace) => workspace.root), [rootA]);

      await assert.rejects(
        () => clientA.request(Protocol.WORKSPACE_STATUS, { workspaceRoot: rootB }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal((error as { code?: number }).code, Protocol.ACCESS_DENIED);
          return true;
        },
      );

      await assert.rejects(
        () => clientA.request(Protocol.WORKSPACE_DISPOSE, { workspaceRoot: rootB }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal((error as { code?: number }).code, Protocol.ACCESS_DENIED);
          return true;
        },
      );

      assert.equal(registry.get(rootB) !== undefined, true, 'workspace B must survive the attempt');
    } finally {
      await clientA.close().catch(() => undefined);
      await server.close().catch(() => undefined);
      await registry.disposeAll().catch(() => undefined);
      await rm(rootA, { recursive: true, force: true });
      await rm(rootB, { recursive: true, force: true });
    }
  });
});

describe('D-05 — strict protocol validation', () => {
  it('rejects duplicate keys, unknown fields and pre-handshake requests', async () => {
    const daemon = await startDaemon({ prefix: 'brud-sec-strict-' });
    const raw = await rawClient(daemon);

    try {
      const duplicateFrom = raw.mark();
      raw.sendRaw('{"jsonrpc":"2.0","id":31,"method":"tools.list","params":{},"params":{}}');
      const duplicateFrame = await raw.waitForFrame(
        (frame) => frame.id === 31,
        { from: duplicateFrom },
      );
      assert.equal(duplicateFrame.error?.code, Protocol.PARSE_ERROR, JSON.stringify(duplicateFrame));

      const unknownTop = await raw.request(Protocol.TOOLS_EXECUTE, {
        name: 'create_file',
        input: { path: 'x.txt', content: 'x' },
        extra: true,
      });
      assert.equal(unknownTop.error?.code, Protocol.INVALID_REQUEST, JSON.stringify(unknownTop));

      const unknownParam = await raw.request(Protocol.TOOLS_LIST, { extra: true });
      assert.equal(unknownParam.error?.code, Protocol.INVALID_REQUEST, JSON.stringify(unknownParam));

      const preHandshake = await rawClient(daemon);
      try {
        const response = await preHandshake.request(Protocol.TOOLS_LIST, {});
        assert.equal(response.error?.code, Protocol.HANDSHAKE_REQUIRED, JSON.stringify(response));
      } finally {
        await preHandshake.close();
      }

      const first = await raw.request(Protocol.DAEMON_CONNECT, {
        protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
      });
      assert.equal(first.error, undefined, JSON.stringify(first));

      const second = await raw.request(Protocol.DAEMON_CONNECT, {
        protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
      });
      assert.equal(second.error?.code, Protocol.ALREADY_HANDSHAKEN, JSON.stringify(second));
    } finally {
      await raw.close();
    }
  });
});

describe('D-06 — bounded resources and request lifetime', () => {
  it('refuses connections beyond the configured ceiling', async () => {
    const daemon = await startDaemon({ prefix: 'brud-sec-conn-', maxConnections: 2 });
    const first = await secureClient(daemon);
    const second = await secureClient(daemon);
    const extra = createConnection(daemon.endpoint.socketPath);

    try {
      await Promise.race([
        new Promise<void>((resolve) => {
          extra.once('close', () => resolve());
          extra.once('error', () => resolve());
        }),
        delay(2_000),
      ]);

      assert.equal(
        extra.destroyed || extra.readableEnded,
        true,
        'the third connection was not refused',
      );
      assert.equal(daemon.server.connectionCount, 2);
    } finally {
      extra.destroy();
      await first.close();
      await second.close();
    }
  });

  it('rejects a request beyond the in-flight ceiling before dispatch', async () => {
    const daemon = await startDaemon({ prefix: 'brud-sec-inflight-', maxInFlightPerConnection: 1 });
    const client = await secureClient(daemon);

    try {
      const first = client.request(Protocol.TOOLS_EXECUTE, {
        name: 'terminal_command',
        input: { command: 'exec sleep 1' },
      }, { timeoutMs: 5_000 });

      await delay(100);

      await assert.rejects(
        () => client.request(Protocol.TOOLS_EXECUTE, {
          name: 'terminal_command',
          input: { command: 'echo second' },
        }, { timeoutMs: 5_000 }),
        (error: unknown) => {
          assert.equal((error as { code?: number }).code, Protocol.RESOURCE_EXHAUSTED);
          return true;
        },
      );

      await first.catch(() => undefined);
    } finally {
      await client.close();
    }
  });

  it('ends a request at its server-side deadline and aborts the work', async () => {
    const daemon = await startDaemon({ prefix: 'brud-sec-timeout-', requestTimeoutMs: 300 });
    const client = await secureClient(daemon);
    const marker = join(daemon.endpoint.workspaceRoot, 'timeout-marker.txt');

    try {
      await assert.rejects(
        () => client.request(Protocol.TOOLS_EXECUTE, {
          name: 'terminal_command',
          input: { command: 'sleep 2; echo done > timeout-marker.txt' },
        }, { timeoutMs: 10_000 }),
        (error: unknown) => {
          assert.equal((error as { code?: number }).code, Protocol.REQUEST_TIMEOUT);
          return true;
        },
      );

      await delay(2_500);
      assert.equal(existsSync(marker), false, 'the timed-out command was not stopped');
    } finally {
      await client.close();
    }
  });

  it('aborts in-flight work when the requester disconnects', async () => {
    const daemon = await startDaemon({ prefix: 'brud-sec-abandon-' });
    const client = await secureClient(daemon);
    const marker = join(daemon.endpoint.workspaceRoot, 'abandoned-marker.txt');

    client.request(Protocol.TOOLS_EXECUTE, {
      name: 'terminal_command',
      input: { command: 'sleep 2; echo done > abandoned-marker.txt' },
    }, { timeoutMs: 10_000 }).catch(() => undefined);

    await delay(300);
    await client.close();
    await delay(2_500);

    assert.equal(existsSync(marker), false, 'the abandoned command ran to completion');
    const recovered = await secureClient(daemon);
    try {
      const response = await recovered.request(Protocol.TOOLS_LIST, {});
      assert.ok(Array.isArray((response as Protocol.ToolsListResult).tools));
    } finally {
      await recovered.close();
    }
  });
});