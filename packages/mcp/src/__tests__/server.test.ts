import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

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
});
