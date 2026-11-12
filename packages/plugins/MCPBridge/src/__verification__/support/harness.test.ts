/**
 * Independent verification harness for the Phase 10 MCP bridge plugin.
 *
 * Boots a real standard kernel with real leaf plugins, attaches the MCP bridge
 * through a recording `IMcpTransport`, and exposes the live tool registry.
 */
import { workspaceContextOptions } from '../../../../../kernel/src/__tests__/support/workspaceContext.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  IBrudPlugin, OperationResult } from '@brud/kernel';
import type { IBrudToolsService } from '@brud/service-tools';
import type { IMcpTransport } from '@brud/service-plugin-manager';
import { createStandardKernel } from '../../../../../kernel/src/bootstrap/index.js';
import type { BrudKernel } from '../../../../../kernel/src/engine/BrudKernel.js';
import { BrudToolsToken } from '../../../../../services/BrudTools/descriptor/tokens.js';
import { PluginManagerToken } from '../../../../../services/PluginManager/contracts/tokens.js';
import type { IPluginManagerService } from '../../../../../services/PluginManager/contracts/IPluginManager.js';
import { createSearchPlugin } from '../../../../Search/src/index.js';
import { createStructurePlugin } from '../../../../Structure/src/index.js';
import { createReaderPlugin } from '../../../../Reader/src/index.js';
import { createFilesystemPlugin } from '../../../../Filesystem/src/index.js';
import { createMcpBridgePlugin } from '../../plugin.js';

export interface McpResponse {
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code?: number; readonly message?: string };
}

/** Recording transport that lets a test drive decoded MCP messages directly. */
export class FakeMcpTransport implements IMcpTransport {
  public readonly kind = 'stdio' as const;

  public readonly notifications: unknown[] = [];

  public closed = false;

  private handler: ((message: unknown) => Promise<unknown>) | undefined;

  public onMessage(handler: (message: unknown) => Promise<unknown>): void {
    this.handler = handler;
  }

  public sendNotification(message: unknown): void {
    this.notifications.push(message);
  }

  public async close(): Promise<void> {
    this.closed = true;
  }

  public async inject(message: unknown): Promise<McpResponse> {
    if (this.handler === undefined) {
      throw new Error('No MCP message handler is attached');
    }

    return await this.handler(message) as McpResponse;
  }
}

export interface BridgeHarness {
  readonly kernel: BrudKernel;
  readonly root: string;
  readonly bridge: IBrudPlugin;
  readonly transport: FakeMcpTransport;
  readonly tools: IBrudToolsService;
  readonly manager: IPluginManagerService;
  request(method: string, params?: Record<string, unknown>): Promise<McpResponse>;
  listTools(): Promise<readonly { readonly name?: string; readonly inputSchema?: Record<string, unknown> }[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpResponse>;
  deactivate(pluginId: string): Promise<void>;
  shutdown(): Promise<void>;
}

export interface BridgeHarnessOptions {
  readonly prefix?: string;
  readonly plugins?: readonly IBrudPlugin[];
  readonly certifyInitialPlugins?: boolean;
}

const OFFICIAL_PLUGINS = (): readonly IBrudPlugin[] => [
  createSearchPlugin(),
  createStructurePlugin(),
  createReaderPlugin(),
  createFilesystemPlugin(),
];

/** Boots a real kernel, activates the bridge and attaches a fake transport. */
export async function bootBridgeHarness(
  options: BridgeHarnessOptions = {},
): Promise<BridgeHarness> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), options.prefix ?? 'brud-mcp-bridge-verification-')),
  );
  const bridge = createMcpBridgePlugin();
  const plugins = options.plugins ?? OFFICIAL_PLUGINS();
  const kernel = createStandardKernel({
    history: { inMemory: true },
    certifyInitialPlugins: options.certifyInitialPlugins ?? true,
    initialPlugins: [...plugins, bridge],
  });

  await kernel.boot({ options: {...workspaceContextOptions(root)} });

  const caller = { callerId: 'verification.mcp', tier: 'core' as const, workspaceRoot: root };
  const tools = kernel.requestAccess(caller, BrudToolsToken);
  const manager = kernel.requestAccess(caller, PluginManagerToken);
  const transport = new FakeMcpTransport();

  await bridge.onTransportAttach?.(transport);

  let nextId = 1;

  const request = async (
    method: string,
    params?: Record<string, unknown>,
  ): Promise<McpResponse> => {
    const id = nextId;
    nextId += 1;

    return await transport.inject({
      jsonrpc: '2.0',
      id,
      method,
      ...(params === undefined ? {} : { params }),
    });
  };

  await request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'verification', version: '0.0.1' },
  });

  return {
    kernel,
    root,
    bridge,
    transport,
    tools,
    manager,
    request,
    listTools: async () => {
      const response = await request('tools/list');
      const result = response.result as
        | { readonly tools?: readonly { readonly name?: string; readonly inputSchema?: Record<string, unknown> }[] }
        | undefined;

      return result?.tools ?? [];
    },
    callTool: (name, args) => request('tools/call', { name, arguments: args }),
    deactivate: async (pluginId: string): Promise<void> => {
      const service = manager as IPluginManagerService & {
        deactivatePlugin(id: string): Promise<void>;
      };

      await service.deactivatePlugin(pluginId);
    },
    shutdown: async (): Promise<void> => {
      try {
        await kernel.shutdown();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  };
}

/** Text content of an MCP tool result. */
export function textOf(response: McpResponse): string {
  const result = response.result as
    | { readonly content?: readonly { readonly text?: string }[] }
    | undefined;

  return result?.content?.[0]?.text ?? '';
}

/** Whether an MCP tool result is marked as a tool-level error. */
export function isErrorOf(response: McpResponse): boolean {
  const result = response.result as { readonly isError?: boolean } | undefined;

  return result?.isError === true;
}

/** Builds a synthetic plugin with a named success tool. */
export function syntheticPlugin(
  id: string,
  toolName: string,
  result: OperationResult = { status: 'success', message: `${toolName} ok` },
): IBrudPlugin {
  return {
    manifest: {
      id,
      name: id,
      version: '0.0.1',
      permissions: ['tools:register'],
    },
    activate(context): void {
      context.registerTool({
        name: toolName,
        description: `Synthetic ${toolName}`,
        parametersSchema: {
          type: 'object',
          properties: { value: { type: 'string' } },
          additionalProperties: false,
        },
        execute: async (): Promise<OperationResult> => result,
      });
    },
  };
}
