import type { Server } from '@modelcontextprotocol/sdk/server/index.js' with { 'resolution-mode': 'import' };
import type { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js' with { 'resolution-mode': 'import' };
import { bootMcpWorkspace } from './bootstrap';
import type { McpWorkspace } from './bootstrap';
import { getToolCatalog } from './catalog';
import { dispatchToolCall } from './dispatch';
import { withTimeout, ExecutionAbortedError } from './limits';

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
  readonly executionTimeoutMs?: number;
  readonly onExecutionSettled?: () => void;
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
    try {
      const result = await withTimeout(
        options.executionTimeoutMs,
        options.signal,
        (signal) =>
          dispatchToolCall(
            workspace.kernel,
            request.params.name,
            request.params.arguments ?? {},
            { workspaceRoot: workspace.workspaceRoot, signal },
          ),
        options.onExecutionSettled,
      );
      return {
        content: result.content.map((entry) => ({ type: 'text' as const, text: entry.text })),
        isError: result.isError,
      };
    } catch (error) {
      const message =
        error instanceof ExecutionAbortedError
          ? error.message
          : 'The operation could not be completed.';
      return {
        content: [{ type: 'text' as const, text: message }],
        isError: true,
      };
    }
  });

  return server;
}

export async function startStdioServer(
  workspaceCandidate: string,
  identity: ServerIdentity = DEFAULT_SERVER_IDENTITY,
  options: CreateServerOptions = {},
): Promise<StartedStdioServer> {
  const workspace = await bootMcpWorkspace(workspaceCandidate);
  const server = await createBrudMcpServer(workspace, identity, options);
  const { StdioServerTransport: TransportCtor } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const transport = new TransportCtor() as StdioServerTransport;
  await server.connect(transport);
  return { server, workspace };
}
