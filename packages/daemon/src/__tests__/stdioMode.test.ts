import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI_PATH = resolve(__dirname, '../../dist/cli.js');
const REQUEST_TIMEOUT_MS = 30_000;

interface JsonRpcEnvelope {
  readonly jsonrpc?: string;
  readonly id?: number | string | null;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code?: number; readonly message?: string };
}

interface PendingRequest {
  readonly resolve: (response: JsonRpcEnvelope) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

class StdioMcpClient {
  readonly process: ChildProcessWithoutNullStreams;

  readonly exited: Promise<number | null>;

  readonly unexpectedStdout: string[] = [];

  stderr = '';

  private buffer = '';

  private nextId = 1;

  private readonly pending = new Map<number, PendingRequest>();

  constructor(workspaceRoot: string) {
    this.process = spawn(
      process.execPath,
      [CLI_PATH, '--stdio', '--workspace', workspaceRoot],
      { stdio: ['pipe', 'pipe', 'pipe'] },
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
      this.process.once('exit', (code) => resolveExit(code));
    });
  }

  request(method: string, params?: Record<string, unknown>): Promise<JsonRpcEnvelope> {
    const id = this.nextId;
    this.nextId += 1;

    return new Promise<JsonRpcEnvelope>((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(
          new Error(`Timed out waiting for MCP response to "${method}" (id=${id})`),
        );
      }, REQUEST_TIMEOUT_MS);
      timer.unref();

      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
      this.write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  notify(method: string, params?: Record<string, unknown>): void {
    this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  }

  closeStdin(): void {
    this.process.stdin.end();
  }

  private write(message: unknown): void {
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private consume(chunk: string): void {
    this.buffer += chunk;

    for (;;) {
      const newlineIndex = this.buffer.indexOf('\n');

      if (newlineIndex === -1) {
        return;
      }

      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line.length === 0) {
        continue;
      }

      let parsed: unknown;

      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        this.unexpectedStdout.push(line);
        continue;
      }

      if (typeof parsed !== 'object' || parsed === null) {
        this.unexpectedStdout.push(line);
        continue;
      }

      const message = parsed as JsonRpcEnvelope;
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

function resultOf(response: JsonRpcEnvelope): Record<string, unknown> {
  assert.equal(response.error, undefined, `unexpected JSON-RPC error: ${JSON.stringify(response.error)}`);
  assert.ok(response.result !== undefined, 'response must carry a result');
  return response.result;
}

describe('daemon --stdio MCP mode', () => {
  let root = '';
  let client: StdioMcpClient;

  before(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'brud-stdio-mode-')));
    await writeFile(join(root, 'smoke.txt'), 'stdio transport is alive\n', 'utf8');
    client = new StdioMcpClient(root);
  });

  after(async () => {
    if (client.process.exitCode === null) {
      client.process.kill('SIGKILL');
      await client.exited;
    }

    await rm(root, { recursive: true, force: true });
  });

  it('answers an MCP initialize request on stdout', async () => {
    const response = await client.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'brud-stdio-test', version: '0.0.1' },
    });
    const result = resultOf(response);

    assert.equal(typeof result.protocolVersion, 'string');
    assert.ok(
      typeof result.capabilities === 'object' && result.capabilities !== null,
      'initialize result must carry capabilities',
    );
    const serverInfo = result.serverInfo as { readonly name?: string } | undefined;
    assert.equal(serverInfo?.name, 'brud-mcp-bridge');

    client.notify('notifications/initialized');
  });

  it('lists the tools registered by the official plugins', async () => {
    const result = resultOf(await client.request('tools/list'));
    const tools = result.tools as readonly { readonly name?: string }[] | undefined;

    assert.ok(Array.isArray(tools), 'tools/list must return an array');
    const names = tools.map((tool) => tool.name);

    assert.ok(names.includes('read_file'), `read_file must be listed: ${names.join(', ')}`);
  });

  it('executes a real tool call over stdio', async () => {
    const result = resultOf(
      await client.request('tools/call', {
        name: 'read_file',
        arguments: { filePath: 'smoke.txt' },
      }),
    );

    assert.equal(result.isError, false);
    const content = result.content as readonly { readonly type?: string; readonly text?: string }[] | undefined;

    assert.ok(Array.isArray(content) && content.length > 0, 'tool result must carry content');
    assert.equal(content[0]?.type, 'text');
    assert.match(content[0]?.text ?? '', /Read summary: delivered=1 file/u);
  });

  it('reports an unknown tool as an MCP tool error', async () => {
    const result = resultOf(
      await client.request('tools/call', {
        name: 'tool_that_does_not_exist',
        arguments: {},
      }),
    );

    assert.equal(result.isError, true);
    const content = result.content as readonly { readonly text?: string }[] | undefined;
    assert.match(content?.[0]?.text ?? '', /TOOL_NOT_FOUND/u);
  });

  it('exits cleanly when the client closes stdin', async () => {
    client.closeStdin();

    const exitCode = await client.exited;

    assert.equal(exitCode, 0, `daemon exited with ${String(exitCode)}\nstderr:\n${client.stderr}`);
    assert.deepEqual(
      client.unexpectedStdout,
      [],
      'stdout must contain only JSON-RPC frames; diagnostics belong on stderr',
    );
  });
});