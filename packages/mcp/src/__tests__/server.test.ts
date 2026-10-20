import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { NodeFileSystem, NodeHistoryStore, revertSession } from '@brud/core';

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

class StdioClient {
  private buffer = '';
  private pending = new Map<number, (response: JsonRpcResponse) => void>();
  private nextId = 1;
  private stderr = '';

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onData(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.stderr += chunk;
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line.length > 0) {
        const message = JSON.parse(line) as JsonRpcResponse;
        if (typeof message.id === 'number') {
          const resolve = this.pending.get(message.id);
          if (resolve) {
            this.pending.delete(message.id);
            resolve(message);
          }
        }
      }
      index = this.buffer.indexOf('\n');
    }
  }

  request(method: string, params?: unknown): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 10000);
      this.pending.set(id, (response) => {
        clearTimeout(timer);
        resolve(response);
      });
      this.child.stdin.write(payload + '\n');
    });
  }

  notify(method: string, params?: unknown): void {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  getStderr(): string {
    return this.stderr;
  }
}

function spawnStdioServer(
  root: string,
  extraArgs: readonly string[] = [],
): { client: StdioClient; child: ChildProcessWithoutNullStreams } {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', root, ...extraArgs], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;
  return { client: new StdioClient(child), child };
}

async function sessionIds(root: string): Promise<string[]> {
  const store = new NodeHistoryStore(root, new NodeFileSystem());
  const sessions = await store.getAllSessions();
  return sessions.map((session) => session.sessionId);
}

async function revertNewestSession(root: string, before: readonly string[]): Promise<boolean> {
  const fsPort = new NodeFileSystem();
  const store = new NodeHistoryStore(root, fsPort);
  const created = (await store.getAllSessions()).filter((session) => !before.includes(session.sessionId));
  assert.strictEqual(created.length, 1, 'expected exactly one new history session');
  const entry = await store.getSession(created[0].sessionId);
  assert.ok(entry, 'history entry for the machine write must exist');
  const result = await revertSession(entry, 'pre', fsPort, [root]);
  return result.success;
}

describe('MCP stdio server', () => {
  let root: string;
  let client: StdioClient;
  let child: ChildProcessWithoutNullStreams;

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-stdio-'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'alpha-from-stdio');
    child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', root], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    client = new StdioClient(child);
  });

  after(() => {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('completes the initialize handshake', async () => {
    const response = await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'brud-test-client', version: '1.0.0' },
    });
    assert.ok(response.result, JSON.stringify(response.error));
    const result = response.result as { serverInfo: { name: string } };
    assert.strictEqual(result.serverInfo.name, 'brud-code');
    client.notify('notifications/initialized');
  });

  it('lists the full tool catalog over the wire', async () => {
    const response = await client.request('tools/list');
    const result = response.result as { tools: Array<{ name: string; inputSchema: unknown }> };
    assert.strictEqual(result.tools.length, 20);
    assert.ok(result.tools.some((tool) => tool.name === 'read_file'));
  });

  it('executes a tool call and returns its content', async () => {
    const response = await client.request('tools/call', {
      name: 'read_file',
      arguments: { filePath: 'a.txt' },
    });
    const result = response.result as { isError: boolean; content: Array<{ type: string; text: string }> };
    assert.strictEqual(result.isError, false);
    assert.ok(result.content[0].text.includes('alpha-from-stdio'));
  });

  it('returns a protocol error result for refused input', async () => {
    const response = await client.request('tools/call', {
      name: 'read_file',
      arguments: { filePath: '../escape.txt' },
    });
    const result = response.result as { isError: boolean };
    assert.strictEqual(result.isError, true);
  });

  it('keeps the protocol channel byte-clean', () => {
    const stderr = client.getStderr();
    assert.ok(!stderr.includes('jsonrpc'), 'stderr must not carry protocol frames');
  });

  it('refuses an undeclared argument and never echoes the workspace path', async () => {
    const response = await client.request('tools/call', {
      name: 'read_file',
      arguments: { filePath: 'a.txt', bogus: 'x' },
    });
    const result = response.result as { isError: boolean; content: Array<{ text: string }> };
    assert.strictEqual(result.isError, true);
    const text = result.content.map((entry) => entry.text).join('\n');
    assert.ok(text.includes('bogus'), 'the rejected parameter must be named');
    assert.ok(!text.includes(root), 'the workspace path must not be echoed');
  });

  it('records a machine write that the history API can revert', async () => {
    const before = await sessionIds(root);
    const response = await client.request('tools/call', {
      name: 'create_file',
      arguments: { path: 'mcp-created.txt', content: 'from-stdio' },
    });
    const result = response.result as { isError: boolean };
    assert.strictEqual(result.isError, false);
    assert.ok(fs.existsSync(path.join(root, 'mcp-created.txt')));

    const reverted = await revertNewestSession(root, before);
    assert.strictEqual(reverted, true);
    assert.ok(!fs.existsSync(path.join(root, 'mcp-created.txt')));
  });
});

describe('MCP stdio server with workspace settings', () => {
  let root: string;
  let client: StdioClient;
  let child: ChildProcessWithoutNullStreams;

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-stdio-settings-'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'alpha-from-stdio');
    fs.mkdirSync(path.join(root, '.brud'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.brud', 'settings.json'),
      JSON.stringify({
        workspaceBoundaryEnabled: true,
        commandValidationEnabled: true,
        toolAllowList: { create_file: false },
      }),
    );
    ({ client, child } = spawnStdioServer(root));
    const init = await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'brud-settings-client', version: '1.0.0' },
    });
    assert.ok(init.result, JSON.stringify(init.error));
    client.notify('notifications/initialized');
  });

  after(() => {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('honours the tool allow-list written to the workspace settings file', async () => {
    const response = await client.request('tools/call', {
      name: 'create_file',
      arguments: { path: 'blocked.txt', content: 'should not exist' },
    });
    const result = response.result as { isError: boolean };
    assert.strictEqual(result.isError, true);
    assert.ok(!fs.existsSync(path.join(root, 'blocked.txt')));
  });
});

describe('MCP stdio deadline', () => {
  let root: string;
  let client: StdioClient;
  let child: ChildProcessWithoutNullStreams;

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-stdio-deadline-'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'alpha-from-stdio');
    ({ client, child } = spawnStdioServer(root, ['--timeout', '0.4']));
    const init = await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'brud-deadline-client', version: '1.0.0' },
    });
    assert.ok(init.result, JSON.stringify(init.error));
    client.notify('notifications/initialized');
  });

  after(() => {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns an error result when the deadline expires', async () => {
    const started = Date.now();
    const response = await client.request('tools/call', {
      name: 'terminal_command',
      arguments: { command: 'node -e "setTimeout(()=>{}, 5000)"' },
    });
    const elapsed = Date.now() - started;
    const result = response.result as { isError: boolean };
    assert.strictEqual(result.isError, true);
    assert.ok(elapsed < 3000, `deadline should answer promptly, took ${elapsed}ms`);
    assert.ok(!client.getStderr().includes('jsonrpc'), 'stderr must not carry protocol frames');
  });
});
