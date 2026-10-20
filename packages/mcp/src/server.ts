import type { Server } from '@modelcontextprotocol/sdk/server/index.js' with { 'resolution-mode': 'import' };
import type { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js' with { 'resolution-mode': 'import' };
import { bootMcpWorkspace } from './bootstrap';
import type { McpWorkspace } from './bootstrap';
import { getToolCatalog } from './catalog';
import { dispatchToolCall } from './dispatch';

export interface ServerIdentity {
  readonly name: string;
  readonly version: string;
}

export const DEFAULT_SERVER_IDENTITY: ServerIdentity = {
  name: 'brud-code',
  version: '0.1.4',
};

export interface StartedStdioServer {
  readonly server: Server;
  readonly workspace: McpWorkspace;
}

export interface CreateServerOptions {
  readonly signal?: AbortSignal;
}

export async function createBrudMcpServer(
  workspace: McpWorkspace,
  identity: ServerIdentity = DEFAULT_SERVER_IDENTITY,
  options: CreateServerOptions = {},
): Promise<Server> {
  const { Server: ServerCtor } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { CallToolRequestSchema, ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');

  const server = new ServerCtor(
    { name: identity.name, version: identity.version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const catalog = getToolCatalog();
    return { tools: catalog.tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await dispatchToolCall(
      workspace.kernel,
      request.params.name,
      request.params.arguments ?? {},
      { workspaceRoot: workspace.workspaceRoot, signal: options.signal },
    );
    return {
      content: result.content.map((entry) => ({ type: 'text' as const, text: entry.text })),
      isError: result.isError,
    };
  });

  return server;
}

export async function startStdioServer(
  workspaceCandidate: string,
  identity: ServerIdentity = DEFAULT_SERVER_IDENTITY,
): Promise<StartedStdioServer> {
  const workspace = await bootMcpWorkspace(workspaceCandidate);
  const server = await createBrudMcpServer(workspace, identity);
  const { StdioServerTransport: TransportCtor } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const transport = new TransportCtor() as StdioServerTransport;
  await server.connect(transport);
  return { server, workspace };
}
