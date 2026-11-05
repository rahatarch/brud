import type {
  IBrudPlugin,
  IBrudToolsReader,
  IPluginContext,
  OperationResult,
  PluginManifest,
  RegisteredToolInfo,
} from '@brud/kernel';

/** Declarative plugin metadata. */
export const catalogManifest: PluginManifest = {
  id: 'akkhar-labs.plugin.catalog',
  name: 'Catalog',
  version: '0.0.1',
  description: 'Registers get_tool_info over the live BrudTools registry.',
  permissions: ['tools:register'],
};

const GET_TOOL_INFO_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    tool: {
      type: 'string',
      description: 'The name of a specific tool to look up.',
    },
  },
  additionalProperties: false,
};

/**
 * Warning attached to the full catalog listing.
 *
 * This text intentionally diverges from the legacy mandate: unlike the legacy
 * catalog, the new listing includes each tool's registered schema and exposes
 * a schema lookup. See
 * `.internal_docs/decisions/2026-11-05_mandate_text_divergence.md`.
 */
export const CATALOG_MANDATE = "**CRITICAL MANDATE:** You are about to see the list of available tools. Each tool has a registered schema. If you need a specific tool's schema or examples, call `get_tool_info` with the tool's name. Do not invent tools or parameters that are not in this list. Tool: <name> — <description>";

/**
 * Removes markdown metacharacters and control-like whitespace from a tool
 * description before it is rendered into the model-facing catalog.
 *
 * Tool names are deliberately NOT passed through this helper: they are
 * identifiers the model must echo verbatim when calling a tool, so stripping
 * characters such as `_` would break dispatch (`extract_structure` must not
 * become `extractstructure`). Schemas are likewise not sanitized: they are
 * JSON, not markdown, and must remain byte-accurate.
 *
 * @param text - Untrusted tool description.
 * @returns A single-line, markdown-safe rendering.
 */
export function sanitizeDescription(text: string): string {
  return text
    .replace(/[`*_\[\]<>]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Formats one tool for the full catalog listing.
 *
 * Mirrors the legacy list shape (`<name>: <description>`) and adds the
 * registered JSON Schema so the caller can see the accepted payload.
 *
 * @param tool - Registered tool projection.
 */
function formatListEntry(tool: RegisteredToolInfo): string {
  return [
    `- ${tool.name}: ${sanitizeDescription(tool.description)}`,
    `  schema: ${JSON.stringify(tool.parametersSchema)}`,
  ].join('\n');
}

/**
 * Builds the legacy `get_tool_info` full-list message.
 *
 * @param tools - Every registered tool, in registry order.
 */
export function formatToolList(tools: readonly RegisteredToolInfo[]): string {
  const entries = tools.length === 0
    ? '(no tools registered)'
    : tools.map(formatListEntry).join('\n');

  return `Available tools:\n${entries}\n\n${CATALOG_MANDATE}`;
}

/**
 * Builds the legacy `get_tool_info` detail message for one tool.
 *
 * @param tool - Registered tool projection.
 */
export function formatToolDetails(tool: RegisteredToolInfo): string {
  return [
    `Tool: ${tool.name}`,
    `Description: ${sanitizeDescription(tool.description)}`,
    `Owner: ${tool.ownerPluginId}`,
    `Official: ${tool.isOfficial ? 'true' : 'false'}`,
    '',
    'Parameters Schema:',
    JSON.stringify(tool.parametersSchema, null, 2),
  ].join('\n');
}

function notFound(toolName: string): OperationResult {
  return {
    status: 'failed',
    error: `TOOL_NOT_FOUND: Tool "${toolName}" is not registered`,
    data: { code: 'TOOL_NOT_FOUND', tool: toolName },
  };
}

/**
 * Creates the Catalog plugin.
 *
 * The plugin reads the registry through {@link IPluginContext.getBrudTools},
 * which is a read-only projection: the catalog can describe and list tools but
 * cannot mutate the registry or dispatch a tool call.
 */
export function createCatalogPlugin(): IBrudPlugin {
  return {
    manifest: catalogManifest,
    activate(context: IPluginContext): void {
      context.registerTool({
        name: 'get_tool_info',
        description: 'Get information about available tools. Call with no parameters for the full list, or with a tool name for specific details.',
        parametersSchema: GET_TOOL_INFO_SCHEMA,
        execute: async (input): Promise<OperationResult> => {
          const tools: IBrudToolsReader = context.getBrudTools();
          const toolName = typeof input.tool === 'string' && input.tool.length > 0
            ? input.tool
            : undefined;

          if (toolName === undefined) {
            const allTools = tools.listTools();

            return {
              status: 'success',
              message: formatToolList(allTools),
              data: { count: allTools.length, tools: allTools },
            };
          }

          const tool = tools.getTool(toolName);

          if (tool === undefined) {
            return notFound(toolName);
          }

          return {
            status: 'success',
            message: formatToolDetails(tool),
            data: tool,
          };
        },
      });

      context.logger.info('Catalog tool registered', { tools: ['get_tool_info'] });
    },
  };
}

/** Shared Catalog plugin instance. */
export const catalogPlugin: IBrudPlugin = createCatalogPlugin();

export default catalogPlugin;