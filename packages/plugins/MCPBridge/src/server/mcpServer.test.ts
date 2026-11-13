import { workspaceContextOptions } from '../../../../kernel/src/__tests__/support/workspaceContext.js';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  IBrudPlugin, OperationResult } from '@brud/kernel';
import type { IBrudToolsService } from '@brud/service-tools';
import type { IPluginLogger } from '@brud/service-plugin-manager';
import { PluginContext } from '../../../../services/PluginManager/contracts/PluginContext.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage, RequestId } from '@modelcontextprotocol/sdk/types.js';
import { createStandardKernel } from '../../../../kernel/src/bootstrap/index.js';
import type { BrudKernel } from '../../../../kernel/src/engine/BrudKernel.js';
import { BrudToolsToken } from '../../../../services/BrudTools/descriptor/tokens.js';
import { ExposedApiRegistryService } from '../../../../kernel/services/ExposedApiRegistry/orchestrator/ExposedApiRegistryService.js';
import { CORE_API_NAME, lastProjectionWins } from '../../../../kernel/services/ExposedApiRegistry/contracts/index.js';
import { createRegistryCapabilityProviders } from '../../../../services/PluginManager/orchestrator/registryCapabilities.js';
import type { InternalPluginRecord } from '../../../../services/PluginManager/orchestrator/types.js';
import type { IKernelAccessBroker, ServiceInfo } from '../../../../kernel/src/contracts/accessBroker.js';
import type { ServiceContext } from '../../../../kernel/src/contracts/lifecycle.js';
import type { ServiceToken } from '../../../../kernel/src/contracts/serviceToken.js';
import { createMcpServer } from './mcpServer.js';

interface Harness {
  readonly kernel: BrudKernel;
  readonly root: string;
  readonly tools: IBrudToolsService;
  shutdown(): Promise<void>;
}

interface IdentifiedRequest {
  readonly jsonrpc: '2.0';
  readonly id: RequestId;
  readonly method: string;
  readonly params?: unknown;
}

type Response = JSONRPCMessage & {
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code?: number; readonly message?: string };
};

const LOGGER: IPluginLogger = {
  info: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
};

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

class MemoryTransport implements Transport {
  public onclose?: () => void;

  public onerror?: (error: Error) => void;

  public onmessage?: <T extends JSONRPCMessage>(message: T) => void;

  private readonly waiting = new Map<string, (message: Response) => void>();

  public async start(): Promise<void> {}

  public async send(message: JSONRPCMessage): Promise<void> {
    if (
      typeof message === 'object'
      && message !== null
      && 'id' in message
      && message.id !== null
      && message.id !== undefined
      && ('result' in message || 'error' in message)
    ) {
      const key = `${typeof message.id}:${String(message.id)}`;
      const resolve = this.waiting.get(key);

      if (resolve !== undefined) {
        this.waiting.delete(key);
        resolve(message as Response);
      }
    }
  }

  public async close(): Promise<void> {
    this.onclose?.();
  }

  public request(message: IdentifiedRequest): Promise<Response> {
    const key = `${typeof message.id}:${String(message.id)}`;

    return new Promise<Response>((resolve) => {
      this.waiting.set(key, resolve);
      this.onmessage?.(message as unknown as JSONRPCMessage);
    });
  }
}

async function bootKernel(): Promise<Harness> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'brud-mcp-server-')));
  const kernel = createStandardKernel({
    history: { inMemory: true },
    initialPlugins: [echoPlugin],
  });

  await kernel.boot({ options: {...workspaceContextOptions(root)} });

  const tools = kernel.requestAccess(
    { callerId: 'test.mcp.server', tier: 'core', workspaceRoot: root },
    BrudToolsToken,
  );

  return {
    kernel,
    root,
    tools,
    shutdown: async (): Promise<void> => {
      try {
        await kernel.shutdown();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  };
}

class ToolBroker implements IKernelAccessBroker {
  constructor(private readonly tools: IBrudToolsService) {}

  requestAccess<TService>(caller: ServiceContext, token: ServiceToken<TService>): TService {
    void caller;

    if (token.id === BrudToolsToken.id) {
      return this.tools as TService;
    }

    throw new Error(`Service "${token.id}" is not registered`);
  }

  hasService(token: ServiceToken<unknown>): boolean {
    return token.id === BrudToolsToken.id;
  }

  listServices(): readonly ServiceInfo[] {
    return Object.freeze([]);
  }
}

function createContext(harness: Harness): PluginContext {
  const permissions = ['tools:execute'] as const;
  const broker = new ToolBroker(harness.tools);
  const registry = new ExposedApiRegistryService({
    broker,
    callerContext: {
      callerId: 'test.api.registry',
      tier: 'core',
      workspaceRoot: harness.root,
    },
  });

  registry.registerApi(CORE_API_NAME.brudTools, BrudToolsToken, {
    capability: 'tools:register',
    scope: 'runtime',
    combine: lastProjectionWins,
  });
  registry.registerApi(CORE_API_NAME.brudTools, BrudToolsToken, {
    capability: 'tools:execute',
    scope: 'runtime',
    combine: lastProjectionWins,
  });
  registry.closeRegistration();

  const manifest = {
    id: 'test.mcp.server',
    name: 'MCP server test',
    version: '1.0.0',
    permissions: [...permissions],
  };
  const record: InternalPluginRecord = {
    plugin: { manifest, activate: (): void => undefined },
    manifest,
    official: false,
    state: 'unloaded',
  };

  return new PluginContext({
    pluginId: 'test.mcp.server',
    workspaceRoot: harness.root,
    permissions,
    logger: LOGGER,
    capabilities: createRegistryCapabilityProviders(
      registry,
      record,
      permissions,
      harness.root,
    ),
  });
}

function textOf(response: Response): string {
  const result = response.result as
    | { readonly content?: readonly { readonly text?: string }[] }
    | undefined;

  return result?.content?.[0]?.text ?? '';
}

describe('MCP server', () => {
  let harness: Harness;
  let transport: MemoryTransport;

  beforeEach(async () => {
    harness = await bootKernel();
    transport = new MemoryTransport();

    const server = createMcpServer(createContext(harness));

    await server.connect(transport);
    await transport.request({
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

  it('lists every registered tool with its schema', async () => {
    const response = await transport.request({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });
    const result = response.result as
      | { readonly tools?: readonly { readonly name?: string; readonly inputSchema?: Record<string, unknown> }[] }
      | undefined;
    const echo = result?.tools?.find((tool) => tool.name === 'echo');

    assert.ok(echo, 'echo tool must be listed');
    assert.equal(echo.inputSchema?.type, 'object');
    assert.deepEqual(echo.inputSchema?.required, ['text']);
    assert.ok(result?.tools?.some((tool) => tool.name === 'explode'));
  });

  it('returns a successful tools/call as MCP text content', async () => {
    const response = await transport.request({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'echo', arguments: { text: 'hello' } },
    });
    const result = response.result as { readonly isError?: boolean } | undefined;

    assert.equal(result?.isError, false);
    assert.equal(textOf(response), 'Echo: hello');
  });

  it('returns a tool-level failure with isError true', async () => {
    const response = await transport.request({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'explode', arguments: {} },
    });
    const result = response.result as { readonly isError?: boolean } | undefined;

    assert.equal(result?.isError, true);
    assert.equal(textOf(response), 'boom');
  });

  it('returns TOOL_NOT_FOUND text for an unknown tool', async () => {
    const response = await transport.request({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'does_not_exist', arguments: {} },
    });
    const result = response.result as { readonly isError?: boolean } | undefined;

    assert.equal(result?.isError, true);
    assert.match(textOf(response), /TOOL_NOT_FOUND/);
  });

  it('raises a JSON-RPC error for malformed params', async () => {
    const response = await transport.request({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { arguments: {} },
    });

    assert.ok(response.error, 'malformed tools/call must produce a JSON-RPC error');
    assert.equal(typeof response.error?.code, 'number');
    assert.match(response.error?.message ?? '', /Invalid (?:tools\/call request|input)/u);
  });
});
