import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { startHttpServer } from '../http';
import type { StartedHttpServer } from '../http';
import { NodeFileSystem, NodeHistoryStore, revertSession } from '@brud/core';

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

  it('refuses a path that escapes the workspace and sanitizes the message', async () => {
    const { status, json } = await rpc(server, {
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: { name: 'read_file', arguments: { filePath: '../escape.txt' } },
    });
    assert.strictEqual(status, 200);
    const result = json.result as { isError: boolean; content: Array<{ text: string }> };
    assert.strictEqual(result.isError, true);
    const text = result.content.map((entry) => entry.text).join('\n');
    assert.ok(!text.includes(server.workspaceRoot), 'the workspace path must not be echoed');
  });

  it('refuses unknown tools and undeclared arguments', async () => {
    const unknownTool = await rpc(server, {
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: { name: 'no_such_tool', arguments: {} },
    });
    const unknownToolResult = unknownTool.json.result as { isError: boolean };
    assert.strictEqual(unknownToolResult.isError, true);

    const unknownParameter = await rpc(server, {
      jsonrpc: '2.0',
      id: 22,
      method: 'tools/call',
      params: { name: 'read_file', arguments: { filePath: 'a.txt', bogus: 'x' } },
    });
    const unknownParameterResult = unknownParameter.json.result as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    assert.strictEqual(unknownParameterResult.isError, true);
    assert.ok(unknownParameterResult.content.map((entry) => entry.text).join('\n').includes('bogus'));
  });

  it('records a machine write that the history API can revert', async () => {
    const before = await sessionIds(root);
    const { json } = await rpc(server, {
      jsonrpc: '2.0',
      id: 23,
      method: 'tools/call',
      params: { name: 'create_file', arguments: { path: 'mcp-http-created.txt', content: 'from-http' } },
    });
    const result = json.result as { isError: boolean };
    assert.strictEqual(result.isError, false);
    assert.ok(fs.existsSync(path.join(root, 'mcp-http-created.txt')));

    const reverted = await revertNewestSession(root, before);
    assert.strictEqual(reverted, true);
    assert.ok(!fs.existsSync(path.join(root, 'mcp-http-created.txt')));
  });
});

describe('MCP HTTP server with workspace settings', () => {
  let root: string;
  let server: StartedHttpServer;

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-http-settings-'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'alpha-over-http');
    fs.mkdirSync(path.join(root, '.brud'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.brud', 'settings.json'),
      JSON.stringify({
        workspaceBoundaryEnabled: true,
        commandValidationEnabled: true,
        toolAllowList: { create_file: false },
      }),
    );
    server = await startHttpServer(root);
  });

  after(async () => {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('honours the tool allow-list written to the workspace settings file', async () => {
    const { json } = await rpc(server, {
      jsonrpc: '2.0',
      id: 30,
      method: 'tools/call',
      params: { name: 'create_file', arguments: { path: 'blocked.txt', content: 'should not exist' } },
    });
    const result = json.result as { isError: boolean };
    assert.strictEqual(result.isError, true);
    assert.ok(!fs.existsSync(path.join(root, 'blocked.txt')));
  });
});

describe('MCP HTTP concurrency limit', () => {
  let root: string;
  let server: StartedHttpServer;

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-http-limit-'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'alpha-over-http');
    server = await startHttpServer(root, { maxConcurrentRequests: 1 });
  });

  after(async () => {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('refuses a second in-flight request with 429', async () => {
    const slowBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 40,
      method: 'tools/call',
      params: {
        name: 'terminal_command',
        arguments: { command: 'node -e "setTimeout(()=>{}, 1500)"' },
      },
    });
    const slow = fetch(server.url, { method: 'POST', headers: HEADERS, body: slowBody });
    await new Promise((resolve) => setTimeout(resolve, 250));

    const second = await rpc(server, { jsonrpc: '2.0', id: 41, method: 'tools/list' });
    assert.strictEqual(second.status, 429);

    await slow;
  });
});

describe('MCP HTTP deadline', () => {
  let root: string;
  let server: StartedHttpServer;

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-http-deadline-'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'alpha-over-http');
    server = await startHttpServer(root, { executionTimeoutMs: 400 });
  });

  after(async () => {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns an error within the deadline instead of waiting for the work', async () => {
    const started = Date.now();
    const { status, json } = await rpc(server, {
      jsonrpc: '2.0',
      id: 50,
      method: 'tools/call',
      params: {
        name: 'terminal_command',
        arguments: { command: 'node -e "setTimeout(()=>{}, 5000)"' },
      },
    });
    const elapsed = Date.now() - started;
    assert.strictEqual(status, 200);
    const result = json.result as { isError: boolean };
    assert.strictEqual(result.isError, true);
    assert.ok(elapsed < 3000, `deadline should answer promptly, took ${elapsed}ms`);
  });
});

describe('MCP HTTP client disconnect', () => {
  let root: string;
  let server: StartedHttpServer;

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-http-disconnect-'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'alpha-over-http');
    server = await startHttpServer(root, { executionTimeoutMs: 60000 });
  });

  after(async () => {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('cancels the running command so its side effect never happens', async () => {
    const command = `node -e "setTimeout(()=>require('fs').writeFileSync('disconnect.txt','x'),2000)"`;
    const controller = new AbortController();
    const pending = fetch(server.url, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 60,
        method: 'tools/call',
        params: { name: 'terminal_command', arguments: { command } },
      }),
      signal: controller.signal,
    }).catch(() => undefined);

    await new Promise((resolve) => setTimeout(resolve, 200));
    controller.abort();
    await pending;

    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.ok(
      !fs.existsSync(path.join(root, 'disconnect.txt')),
      'the aborted command must not write its side effect',
    );
  });
});
