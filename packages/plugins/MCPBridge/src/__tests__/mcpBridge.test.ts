import { workspaceContextOptions } from '../../../../kernel/src/__tests__/support/workspaceContext.js';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  IBrudPlugin,
  IMcpTransport,
  OperationResult,
} from '@brud/kernel';
import { createStandardKernel } from '../../../../kernel/src/bootstrap/index.js';
import type { BrudKernel } from '../../../../kernel/src/engine/BrudKernel.js';
import { createMcpBridgePlugin } from '../plugin.js';

interface Response {
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code?: number; readonly message?: string };
}

const echoPlugin: IBrudPlugin = {
  manifest: {
    id: 'test.echo',
    name: 'Echo Test Plugin',
    version: '0.0.1',
    permissions: ['tools:register'],
  },
  activate(context): void {
    context.registerTool({
      name: 'echo',
      description: 'Echo the supplied text',
      parametersSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
      execute: async (input): Promise<OperationResult> => ({
        status: 'success',
        message: `Echo: ${String(input.text)}`,
        data: { text: input.text },
      }),
    });

    context.registerTool({
      name: 'explode',
      description: 'Always fails',
      parametersSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      execute: async (): Promise<OperationResult> => ({
        status: 'failed',
        error: 'boom',
      }),
    });
  },
};

class FakeMcpTransport implements IMcpTransport {
  public readonly kind = 'stdio' as const;

  public readonly notifications: unknown[] = [];

  private handler: ((message: unknown) => Promise<unknown>) | undefined;

  public onMessage(handler: (message: unknown) => Promise<unknown>): void {
    this.handler = handler;
  }

  public sendNotification(message: unknown): void {
    this.notifications.push(message);
  }

  public async close(): Promise<void> {}

  public async inject(message: unknown): Promise<Response> {
    if (this.handler === undefined) {
      throw new Error('No MCP message handler is attached');
    }

    return await this.handler(message) as Response;
  }
}

interface Harness {
  readonly kernel: BrudKernel;
  readonly root: string;
  readonly transport: FakeMcpTransport;
  shutdown(): Promise<void>;
}

async function bootBridge(): Promise<Harness> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'brud-mcp-bridge-')));
  const bridge = createMcpBridgePlugin();
  const kernel = createStandardKernel({
    history: { inMemory: true },
    initialPlugins: [bridge, echoPlugin],
  });

  await kernel.boot({ options: {...workspaceContextOptions(root)} });

  const transport = new FakeMcpTransport();
  await bridge.onTransportAttach?.(transport);

  return {
    kernel,
    root,
    transport,
    shutdown: async (): Promise<void> => {
      try {
        await kernel.shutdown();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  };
}

function textOf(response: Response): string {
  const result = response.result as
    | { readonly content?: readonly { readonly text?: string }[] }
    | undefined;

  return result?.content?.[0]?.text ?? '';
}

describe('MCP bridge over IMcpTransport', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await bootBridge();
    await harness.transport.inject({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0.0.1' },
      },
    });
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it('answers initialize with protocol version, capabilities, and server info', async () => {
    const response = await harness.transport.inject({
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0.0.1' },
      },
    });
    const result = response.result as
      | {
          readonly protocolVersion?: string;
          readonly capabilities?: { readonly tools?: unknown };
          readonly serverInfo?: { readonly name?: string; readonly version?: string };
        }
      | undefined;

    assert.ok(result?.protocolVersion);
    assert.ok(result?.capabilities?.tools);
    assert.equal(result?.serverInfo?.name, 'brud-mcp-bridge');
    assert.equal(result?.serverInfo?.version, '0.0.1');
  });

  it('lists the registered tools', async () => {
    const response = await harness.transport.inject({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
    });
    const result = response.result as
      | { readonly tools?: readonly { readonly name?: string; readonly inputSchema?: Record<string, unknown> }[] }
      | undefined;
    const echo = result?.tools?.find((tool) => tool.name === 'echo');

    assert.ok(echo, 'echo must be listed');
    assert.equal(echo.inputSchema?.type, 'object');
    assert.deepEqual(echo.inputSchema?.required, ['text']);
  });

  it('dispatches a successful tools/call', async () => {
    const response = await harness.transport.inject({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'echo', arguments: { text: 'hi' } },
    });
    const result = response.result as { readonly isError?: boolean } | undefined;

    assert.equal(result?.isError, false);
    assert.equal(textOf(response), 'Echo: hi');
  });

  it('returns tool failures as isError true instead of JSON-RPC errors', async () => {
    const response = await harness.transport.inject({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'explode', arguments: {} },
    });
    const result = response.result as { readonly isError?: boolean } | undefined;

    assert.equal(response.error, undefined);
    assert.equal(result?.isError, true);
    assert.equal(textOf(response), 'boom');
  });

  it('returns TOOL_NOT_FOUND text for an unknown tool', async () => {
    const response = await harness.transport.inject({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'missing', arguments: {} },
    });
    const result = response.result as { readonly isError?: boolean } | undefined;

    assert.equal(result?.isError, true);
    assert.match(textOf(response), /TOOL_NOT_FOUND/);
  });

  it('raises a JSON-RPC error for malformed tools/call params', async () => {
    const response = await harness.transport.inject({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { arguments: {} },
    });

    assert.ok(response.error, 'malformed params must produce a JSON-RPC error');
    assert.equal(typeof response.error?.code, 'number');
    assert.match(response.error?.message ?? '', /Invalid (?:tools\/call request|input)/u);
  });
});
