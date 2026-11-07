import { isAbsolute, relative } from 'node:path';
import type { IPluginContext, OperationResult } from '@brud/kernel';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  RequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * Envelope schema used for handler registration only.
 *
 * The SDK validates a request against the schema handed to
 * `setRequestHandler` before invoking the handler, and its default
 * `CallToolRequestSchema` rejects a malformed `params` with a bare Zod error
 * that the SDK serializes as `-32603`. Registering through a loose envelope
 * lets the bridge validate `params` itself and raise `-32602` (Invalid Params)
 * with a field-specific message. The SDK's `tools/call` wrapper still runs its
 * own `CallToolRequestSchema` validation after this envelope is accepted.
 */
const TOOL_CALL_ENVELOPE_SCHEMA = RequestSchema.extend({
  method: CallToolRequestSchema.shape.method,
  params: RequestSchema.shape.params.catch(undefined),
});

/** Tools whose success envelope can represent a missing primary target. */
const READER_FAMILY_TOOLS = new Set(['read_file', 'read_files', 'read_directory']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns the primary target argument for a Reader-family tool. */
function readerPrimaryTarget(
  toolName: string,
  args: Record<string, unknown>,
): string | undefined {
  const field = toolName === 'read_file'
    ? 'filePath'
    : toolName === 'read_directory'
      ? 'directoryPath'
      : 'pattern';
  const value = args[field];

  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Normalizes a path to a workspace-relative POSIX form for comparison. */
function normalizeTarget(value: string, workspaceRoot: string): string {
  let candidate = value.replace(/\\/gu, '/');

  if (isAbsolute(candidate)) {
    candidate = relative(workspaceRoot, candidate).replace(/\\/gu, '/');
  }

  return candidate.replace(/^\.\/+/u, '');
}

/**
 * Reports whether a successful Reader result only skipped the primary target.
 *
 * The Reader contract returns `status: 'success'` with an `unreadable` skip
 * when the root does not exist. MCP clients expect that case to be a tool-level
 * failure, so the bridge translates it at the boundary without changing the
 * Reader plugin.
 */
function isMissingPrimaryTarget(
  toolName: string,
  args: Record<string, unknown>,
  result: OperationResult,
  workspaceRoot: string,
): boolean {
  if (!READER_FAMILY_TOOLS.has(toolName)) {
    return false;
  }

  if (!isRecord(result.data)) {
    return false;
  }

  const { files, skips } = result.data;

  if (!Array.isArray(files) || files.length !== 0 || !Array.isArray(skips) || skips.length === 0) {
    return false;
  }

  const target = readerPrimaryTarget(toolName, args);

  if (target === undefined) {
    return true;
  }

  const normalizedTarget = normalizeTarget(target, workspaceRoot);

  return skips.some((skip) => {
    if (!isRecord(skip) || typeof skip.path !== 'string') {
      return false;
    }

    return normalizeTarget(skip.path, workspaceRoot) === normalizedTarget;
  });
}

/**
 * Removes the absolute workspace root from failure text.
 *
 * Paths inside the workspace become workspace-relative; any residual absolute
 * prefix becomes the literal `<workspace>`. Text outside the workspace is left
 * untouched so unrelated failures are not rewritten.
 */
export function sanitizeFailureText(text: string, workspaceRoot?: string): string {
  if (workspaceRoot === undefined || workspaceRoot.length === 0) {
    return text;
  }

  let sanitized = text;

  for (const separator of ['/', '\\']) {
    sanitized = sanitized.split(`${workspaceRoot}${separator}`).join('');
  }

  return sanitized.split(workspaceRoot).join('<workspace>');
}

/** Identity advertised in the MCP `initialize` response. */
export const MCP_SERVER_INFO = Object.freeze({
  name: 'brud-mcp-bridge',
  version: '0.0.1',
});

/** Shape of the JSON Schema the MCP `tools/list` response requires. */
interface McpToolInputSchema {
  readonly type: 'object';
  readonly properties?: Record<string, object>;
  readonly required?: readonly string[];
}

/**
 * Renders a successful tool result as MCP text content.
 *
 * The tool's own `message` is the model-facing summary when present; otherwise
 * the structured `data` is serialized so an MCP client still sees the payload.
 */
export function formatSuccess(result: OperationResult): string {
  if (typeof result.message === 'string' && result.message.length > 0) {
    return result.message;
  }

  if (result.data !== undefined) {
    try {
      return JSON.stringify(result.data, null, 2);
    } catch {
      return String(result.data);
    }
  }

  return 'Tool executed successfully.';
}

/**
 * Renders a failed tool result as MCP text content.
 *
 * The kernel already formats domain failures as `<CODE>: <message>` strings
 * (for example `TOOL_NOT_FOUND: Tool "x" is not registered`), and that text is
 * preserved verbatim so clients can branch on the stable prefix.
 */
export function formatFailure(result: OperationResult, workspaceRoot?: string): string {
  const error = result.error;
  const detail = typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : undefined;

  const text = detail !== undefined && detail.length > 0
    ? detail
    : typeof result.message === 'string' && result.message.length > 0
      ? result.message
      : 'Tool execution failed.';

  return sanitizeFailureText(text, workspaceRoot);
}

/**
 * Builds the MCP server exposed over a daemon-provided transport.
 *
 * This bridge is in-process: it receives an {@link IPluginContext} from the
 * daemon and never opens a socket of its own. If a socket-based MCP bridge is
 * added later, it MUST perform `daemon.connect` with `tier: 'ai'` because the
 * bridge represents an autonomous AI caller and UI-only methods reject it.
 *
 * Tool failures are MCP tool-level errors (`isError: true`), never JSON-RPC
 * errors: only malformed request envelopes reach the SDK's protocol error
 * channel. Every dispatch goes through {@link IPluginContext.executeTool}, so
 * the bridge inherits the kernel's schema validation and permission checks.
 *
 * @param context - Plugin-scoped kernel context holding `tools:execute`.
 * @returns An unconnected MCP SDK server.
 */
export function createMcpServer(context: IPluginContext): Server {
  const server = new Server(MCP_SERVER_INFO, {
    capabilities: { tools: {} },
  });

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: context.getBrudTools().listTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parametersSchema as unknown as McpToolInputSchema,
    })),
  }));

  server.setRequestHandler(TOOL_CALL_ENVELOPE_SCHEMA, async (request) => {
    const params: unknown = request.params;

    if (!isRecord(params)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid tools/call params: "params" must be an object',
      );
    }

    const { name, arguments: rawArguments } = params;

    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid tools/call params: "name" must be a non-empty string',
      );
    }

    if (rawArguments !== undefined && !isRecord(rawArguments)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid tools/call params: "arguments" must be an object',
      );
    }

    const args = rawArguments ?? {};
    const result = await context.executeTool(name, args);

    if (result.status === 'success') {
      if (isMissingPrimaryTarget(name, args, result, context.workspaceRoot)) {
        const target = readerPrimaryTarget(name, args) ?? name;

        return {
          content: [{ type: 'text' as const, text: `FILE_NOT_FOUND: ${target}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text' as const, text: formatSuccess(result) }],
        isError: false,
      };
    }

    return {
      content: [{ type: 'text' as const, text: formatFailure(result, context.workspaceRoot) }],
      isError: true,
    };
  });

  return server;
}