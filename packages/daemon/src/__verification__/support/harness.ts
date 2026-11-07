/**
 * Shared verification harness for the Phase 10 daemon MCP surface.
 *
 * This module is test support only. It spawns the real built daemon entry
 * point (falling back to the TypeScript entry point through tsx) and speaks
 * either raw newline-delimited JSON-RPC or the real MCP SDK client.
 */
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as Protocol from '@brud/protocol';
import { connectSocket } from '../../client/socket.js';
import { DaemonClient } from '../../client/DaemonClient.js';
import { resolveEndpoint } from '../../lifecycle/endpoint.js';
import type { DaemonEndpoint } from '../../lifecycle/endpoint.js';

const HERE = __dirname;

/** Repository root, five directories above the support directory. */
export const REPO_ROOT = resolve(HERE, '../../../../..');

/** Built daemon CLI. */
export const DAEMON_CLI = join(REPO_ROOT, 'packages', 'daemon', 'dist', 'cli.js');

/** TypeScript daemon CLI used when the build is absent. */
export const DAEMON_SOURCE_CLI = join(REPO_ROOT, 'packages', 'daemon', 'src', 'cli.ts');

export const DAEMON_PROTOCOL_VERSION = Protocol.DAEMON_PROTOCOL_VERSION;

/** Parameters accepted by the MCP SDK's default client. */
export const INITIALIZE_PARAMS = Object.freeze({
  protocolVersion: '2025-11-25',
  capabilities: {},
  clientInfo: { name: 'brud-verification-client', version: '0.0.1' },
});

const REQUEST_TIMEOUT_MS = 30_000;

/** Command prefix that invokes the real daemon entry point. */
export function cliInvocation(): readonly string[] {
  if (existsSync(DAEMON_CLI)) {
    return [DAEMON_CLI];
  }

  return ['--import', 'tsx', DAEMON_SOURCE_CLI];
}

/** Creates a real temporary workspace. */
export async function createWorkspace(prefix: string): Promise<string> {
  return await realpath(await mkdtemp(join(tmpdir(), prefix)));
}

export interface JsonRpcResponse {
  readonly jsonrpc?: string;
  readonly id?: number | string | null;
  readonly result?: Record<string, unknown>;
  readonly error?: {
    readonly code?: number;
    readonly message?: string;
    readonly data?: unknown;
  };
}

interface PendingRequest {
  readonly resolve: (response: JsonRpcResponse) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

/** Minimal raw MCP client that keeps every stdout line inspectable. */
export class RawMcpClient {
  public readonly process: ChildProcessWithoutNullStreams;

  public readonly exited: Promise<number | null>;

  public readonly frames: string[] = [];

  public readonly nonJsonLines: string[] = [];

  public stderr = '';

  private buffer = '';

  private nextId = 1;

  private readonly pending = new Map<number, PendingRequest>();

  constructor(workspaceRoot: string, extraArgs: readonly string[] = []) {
    this.process = spawn(
      process.execPath,
      [...cliInvocation(), ...extraArgs, '--stdio', '--workspace', workspaceRoot],
      { cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'pipe'] },
    );

    this.process.stdout.setEncoding('utf8');
    this.process.stdout.on('data', (chunk: string) => {
      this.consume(chunk);
    });

    this.process.stderr.setEncoding('utf8');
    this.process.stderr.on('data', (chunk: string) => {
      this.stderr += chunk;
    });

    this.exited = new Promise<number | null>((resolveExit) => {
      this.process.once('exit', (code) => {
        this.failPending();
        resolveExit(code);
      });
    });
  }

  get pid(): number | undefined {
    return this.process.pid;
  }

  request(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<JsonRpcResponse> {
    const id = this.nextId;
    this.nextId += 1;

    return new Promise<JsonRpcResponse>((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new Error(`Timed out waiting for ${method} (id=${id})`));
      }, timeoutMs);
      timer.unref();

      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
      this.write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  notify(method: string, params?: Record<string, unknown>): void {
    this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  }

  /** Sends a raw line verbatim, including malformed JSON. */
  writeRaw(line: string): void {
    this.process.stdin.write(line.endsWith('\n') ? line : `${line}\n`);
  }

  write(message: unknown): void {
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  closeStdin(): void {
    this.process.stdin.end();
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): void {
    this.process.kill(signal);
  }

  async waitForExit(timeoutMs = 10_000): Promise<number | null> {
    return await Promise.race([
      this.exited,
      new Promise<null>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`daemon did not exit within ${timeoutMs}ms`)),
          timeoutMs,
        );
        timer.unref();
      }),
    ]);
  }

  /** Rejects pending requests once the process has gone away. */
  private failPending(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(new Error('daemon process exited'));
    }
  }

  private consume(chunk: string): void {
    this.buffer += chunk;

    for (;;) {
      const newlineIndex = this.buffer.indexOf('\n');

      if (newlineIndex === -1) {
        return;
      }

      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line.trim().length === 0) {
        continue;
      }

      this.frames.push(line);

      let parsed: unknown;

      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        this.nonJsonLines.push(line);
        continue;
      }

      if (typeof parsed !== 'object' || parsed === null) {
        this.nonJsonLines.push(line);
        continue;
      }

      const message = parsed as JsonRpcResponse;
      const id = message.id;

      if (typeof id !== 'number') {
        continue;
      }

      const pending = this.pending.get(id);

      if (pending === undefined) {
        continue;
      }

      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.resolve(message);
    }
  }
}

export interface SdkClientHarness {
  readonly client: Client;
  readonly transport: StdioClientTransport;
  readonly stderr: () => string;
  readonly pid: () => number | null;
  close(): Promise<void>;
}

/** Connects a real MCP SDK client to a real daemon subprocess. */
export async function connectSdkClient(
  workspaceRoot: string,
  extraArgs: readonly string[] = [],
): Promise<SdkClientHarness> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [...cliInvocation(), ...extraArgs, '--stdio', '--workspace', workspaceRoot],
    cwd: REPO_ROOT,
    stderr: 'pipe',
  });
  let stderr = '';
  const errorStream = transport.stderr;

  errorStream?.on('data', (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  const client = new Client(
    { name: 'brud-verification-sdk-client', version: '0.0.1' },
    { capabilities: {} },
  );

  await client.connect(transport);

  return {
    client,
    transport,
    stderr: () => stderr,
    pid: () => transport.pid,
    close: async (): Promise<void> => {
      await client.close();
    },
  };
}

/** Extracts the first text content block from an MCP tool result. */
export function textOf(result: unknown): string {
  const candidate = result as
    | { readonly content?: readonly { readonly type?: string; readonly text?: string }[] }
    | undefined;

  return candidate?.content?.[0]?.text ?? '';
}

/** Whether a pid is still addressable. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Waits for a pid to disappear. */
export async function waitForPidGone(pid: number, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (pidAlive(pid)) {
    if (Date.now() > deadline) {
      return false;
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }

  return true;
}

/** Resolves the daemon endpoint paths for a workspace. */
export async function endpointOf(workspaceRoot: string): Promise<DaemonEndpoint> {
  return await resolveEndpoint(workspaceRoot);
}

/** Connects a daemon client over the real Unix socket. */
export async function connectSocketClient(
  endpoint: DaemonEndpoint,
  token: string,
  workspaceRoot: string,
): Promise<DaemonClient> {
  const socket = await connectSocket(endpoint.socketPath, 5_000);
  const client = new DaemonClient(socket);

  await client.connect({
    protocolVersion: DAEMON_PROTOCOL_VERSION,
    token,
    workspaceRoot,
    tier: 'ui',
    clientInfo: { name: 'brud-verification-socket-client', version: '0.0.1' },
  });

  return client;
}

export interface HttpMcpResponse {
  readonly status: number;
  readonly text: string;
}

/** Posts one MCP message to a loopback HTTP transport. */
export async function postMcp(
  url: string,
  message: unknown,
): Promise<HttpMcpResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(message),
  });

  return { status: response.status, text: await response.text() };
}

/** Posts a raw body to a loopback HTTP transport. */
export async function postMcpRaw(
  url: string,
  body: string,
): Promise<HttpMcpResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });

  return { status: response.status, text: await response.text() };
}