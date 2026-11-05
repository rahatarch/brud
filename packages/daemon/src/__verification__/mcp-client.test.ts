/**
 * Goal 5 — Real MCP client compatibility.
 *
 * A real `@modelcontextprotocol/sdk` Client drives a real daemon subprocess
 * over its stdio transport. The daemon is the built CLI, not an in-process
 * server.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import {
  INITIALIZE_PARAMS,
  RawMcpClient,
  connectSdkClient,
  createWorkspace,
  textOf,
} from './support/harness.js';
import type { SdkClientHarness } from './support/harness.js';

interface ToolDefinition {
  readonly name?: string;
  readonly description?: string;
  readonly inputSchema?: {
    readonly type?: string;
    readonly properties?: Record<string, unknown>;
    readonly required?: readonly string[];
    readonly additionalProperties?: boolean;
  };
}

interface CallResult {
  readonly isError?: boolean;
  readonly content?: readonly { readonly type?: string; readonly text?: string }[];
}

let workspace = '';
let sdk: SdkClientHarness;

before(async () => {
  workspace = await createWorkspace('brud-mcp-client-');
  await writeFile(join(workspace, 'smoke.txt'), 'stdio transport is alive\n', 'utf8');
  await writeFile(join(workspace, 'second.txt'), 'second file\n', 'utf8');
  sdk = await connectSdkClient(workspace);
});

after(async () => {
  await sdk.close().catch(() => undefined);
  await rm(workspace, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown>): Promise<CallResult> {
  return await sdk.client.callTool({ name, arguments: args }) as unknown as CallResult;
}

async function listTools(): Promise<readonly ToolDefinition[]> {
  const result = await sdk.client.listTools();

  return result.tools as unknown as readonly ToolDefinition[];
}

describe('Goal 5 — initialize handshake with a real SDK client', () => {
  it('connects and advertises the brud MCP bridge identity', () => {
    const server = sdk.client.getServerVersion();

    assert.ok(server, 'the SDK client must have received serverInfo');
    assert.equal(server?.name, 'brud-mcp-bridge');
    assert.equal(server?.version, '0.0.1');
  });

  it('advertises the tools capability', () => {
    const capabilities = sdk.client.getServerCapabilities();

    assert.ok(capabilities);
    assert.ok(capabilities?.tools, 'server capabilities must include tools');
  });

  it('negotiates the SDK default protocol version', { timeout: 20_000 }, async () => {
    const rawWorkspace = await createWorkspace('brud-mcp-protocol-');
    const client = new RawMcpClient(rawWorkspace);

    try {
      const response = await client.request('initialize', INITIALIZE_PARAMS);
      const result = response.result as { readonly protocolVersion?: string } | undefined;

      assert.equal(response.error, undefined);
      assert.equal(result?.protocolVersion, LATEST_PROTOCOL_VERSION);
    } finally {
      client.kill('SIGKILL');
      await client.waitForExit().catch(() => undefined);
      await rm(rawWorkspace, { recursive: true, force: true });
    }
  });
});

describe('Goal 5 — tools/list over the SDK client', () => {
  it('lists read_file', async () => {
    const tools = await listTools();

    assert.ok(tools.some((tool) => tool.name === 'read_file'));
  });

  it('lists create_file', async () => {
    const tools = await listTools();

    assert.ok(tools.some((tool) => tool.name === 'create_file'));
  });

  it('lists terminal_command', async () => {
    const tools = await listTools();

    assert.ok(tools.some((tool) => tool.name === 'terminal_command'));
  });

  it('returns an object inputSchema with properties for every tool', async () => {
    const tools = await listTools();

    assert.ok(tools.length > 0);

    for (const tool of tools) {
      assert.equal((tool.name?.length ?? 0) > 0, true, 'every tool must have a name');
      assert.equal(tool.inputSchema?.type, 'object', `${tool.name} inputSchema type`);
      assert.equal(
        typeof tool.inputSchema?.properties,
        'object',
        `${tool.name} must declare properties`,
      );
    }
  });

  it('marks compatible schemas additionalProperties false', async () => {
    const tools = await listTools();
    const readFile = tools.find((tool) => tool.name === 'read_file');

    assert.equal(readFile?.inputSchema?.additionalProperties, false);
  });
});

describe('Goal 5 — tools/call over the SDK client', () => {
  it('reads a real file and returns isError false', async () => {
    const result = await call('read_file', { filePath: 'smoke.txt' });

    assert.equal(result.isError, false);
    assert.equal(result.content?.[0]?.type, 'text');
    assert.match(textOf(result), /Read summary: delivered=1 file/u);
  });

  it('reports a nonexistent file as FILE_NOT_FOUND with isError true', async () => {
    const result = await call('read_file', { filePath: 'does-not-exist.txt' });

    assert.equal(result.isError, true);
    assert.match(textOf(result), /FILE_NOT_FOUND/u);
  });

  it('reports an unknown tool as TOOL_NOT_FOUND with isError true', async () => {
    const result = await call('tool_that_does_not_exist', {});

    assert.equal(result.isError, true);
    assert.match(textOf(result), /TOOL_NOT_FOUND/u);
  });

  it('executes terminal_command through the same MCP session', async () => {
    const result = await call('terminal_command', { command: 'echo mcp-terminal' });

    assert.equal(result.isError, false);
    assert.match(textOf(result), /mcp-terminal/u);
  });

  it('creates a real file through create_file', async () => {
    const result = await call('create_file', {
      path: 'created-over-mcp.txt',
      content: 'created over MCP\n',
    });

    assert.equal(result.isError, false);
    assert.match(textOf(result), /Created created-over-mcp\.txt\./u);
  });
});

describe('Goal 5 — transport lifecycle', () => {
  it('exits the daemon with code 0 when the client closes stdin', { timeout: 20_000 }, async () => {
    const rawWorkspace = await createWorkspace('brud-mcp-close-');
    const client = new RawMcpClient(rawWorkspace);

    try {
      const response = await client.request('initialize', INITIALIZE_PARAMS);

      assert.equal(response.error, undefined);
      client.closeStdin();
      const exitCode = await client.waitForExit();

      assert.equal(exitCode, 0, `daemon exited with ${String(exitCode)}\n${client.stderr}`);
    } finally {
      if (client.process.exitCode === null) {
        client.kill('SIGKILL');
        await client.waitForExit().catch(() => undefined);
      }
      await rm(rawWorkspace, { recursive: true, force: true });
    }
  });

  it('writes only parseable JSON-RPC frames to stdout for the whole session', { timeout: 20_000 }, async () => {
    const rawWorkspace = await createWorkspace('brud-mcp-frames-');
    await writeFile(join(rawWorkspace, 'frame.txt'), 'frame\n', 'utf8');
    const client = new RawMcpClient(rawWorkspace);

    try {
      await client.request('initialize', INITIALIZE_PARAMS);
      await client.request('tools/list', {});
      await client.request('tools/call', {
        name: 'read_file',
        arguments: { filePath: 'frame.txt' },
      });
      client.closeStdin();
      const exitCode = await client.waitForExit();

      assert.equal(exitCode, 0);
      assert.deepEqual(client.nonJsonLines, [], 'stdout must contain no prose or banners');
      assert.ok(client.frames.length >= 3, `expected response frames, got ${client.frames.length}`);
      for (const frame of client.frames) {
        assert.doesNotThrow(() => JSON.parse(frame), `invalid frame: ${frame.slice(0, 120)}`);
      }
      assert.doesNotMatch(client.frames.join('\n'), /brud-daemon .*ready|listening on/u);
    } finally {
      if (client.process.exitCode === null) {
        client.kill('SIGKILL');
        await client.waitForExit().catch(() => undefined);
      }
      await rm(rawWorkspace, { recursive: true, force: true });
    }
  });
});