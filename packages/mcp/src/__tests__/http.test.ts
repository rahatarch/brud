import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { startHttpServer } from '../http';
import type { StartedHttpServer } from '../http';

interface RpcResponse {
  result?: unknown;
  error?: { code: number; message: string };
}

const HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

async function rpc(server: StartedHttpServer, body: unknown): Promise<{ status: number; json: RpcResponse }> {
  const response = await fetch(server.url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text.length > 0 ? (JSON.parse(text) as RpcResponse) : {} };
}

describe('MCP HTTP server', () => {
  let root: string;
  let server: StartedHttpServer;

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-http-'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'alpha-over-http');
    server = await startHttpServer(root);
  });

  after(async () => {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('binds to loopback on an ephemeral port', () => {
    assert.strictEqual(server.host, '127.0.0.1');
    assert.ok(server.port > 0);
    assert.strictEqual(server.url, `http://127.0.0.1:${server.port}/mcp`);
    assert.strictEqual(server.workspaceRoot, fs.realpathSync.native(root));
  });

  it('refuses non-loopback binding', async () => {
    await assert.rejects(() => startHttpServer(root, { host: '0.0.0.0' }), /loopback/i);
  });

  it('completes the initialize handshake over HTTP', async () => {
    const { status, json } = await rpc(server, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'brud-http-test', version: '1.0.0' },
      },
    });
    assert.strictEqual(status, 200);
    const result = json.result as { serverInfo: { name: string } };
    assert.strictEqual(result.serverInfo.name, 'brud-code');
  });

  it('lists tools and executes a call over HTTP', async () => {
    const list = await rpc(server, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (list.json.result as { tools: unknown[] }).tools;
    assert.strictEqual(tools.length, 20);

    const call = await rpc(server, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'read_file', arguments: { filePath: 'a.txt' } },
    });
    const result = call.json.result as { isError: boolean; content: Array<{ text: string }> };
    assert.strictEqual(result.isError, false);
    assert.ok(result.content[0].text.includes('alpha-over-http'));
  });

  it('answers unknown paths with 404 and wrong methods with 405', async () => {
    const notFound = await fetch(`http://127.0.0.1:${server.port}/other`, { method: 'POST', headers: HEADERS, body: '{}' });
    assert.strictEqual(notFound.status, 404);
    const wrongMethod = await fetch(server.url, { method: 'PUT', headers: HEADERS, body: '{}' });
    assert.strictEqual(wrongMethod.status, 405);
  });

  it('releases the port on close so it can be reused', async () => {
    const first = await startHttpServer(root);
    const port = first.port;
    await first.close();
    const reused = await startHttpServer(root, { port });
    assert.strictEqual(reused.port, port);
    await reused.close();
  });
});
