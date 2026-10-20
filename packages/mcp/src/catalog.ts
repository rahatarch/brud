import { globalToolRegistry, initializeToolRegistry } from '@brud/core';
import type { ToolDoc, ToolParameter } from '@brud/core';

export interface McpToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: 'object';
    readonly properties: Record<string, Record<string, unknown>>;
    readonly required: string[];
    readonly additionalProperties: false;
  };
}

export interface ExcludedTool {
  readonly kind: string;
  readonly reason: string;
}

export interface ToolCatalog {
  readonly tools: McpToolDescriptor[];
  readonly excluded: ExcludedTool[];
}

const PROTOCOL_BOILERPLATE_MARKER = 'CRITICAL PROTOCOL';

function toJsonSchemaType(param: ToolParameter): Record<string, unknown> | null {
  switch (param.type) {
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'string[]':
      return { type: 'array', items: { type: 'string' } };
    default:
      return null;
  }
}

function coerceDefault(param: ToolParameter): unknown {
  if (param.default === undefined) {
    return undefined;
  }
  switch (param.type) {
    case 'number': {
      const value = Number(param.default);
      return Number.isFinite(value) ? value : undefined;
    }
    case 'boolean':
      return param.default === 'true';
    case 'string':
      return param.default;
    case 'string[]':
      return undefined;
    default:
      return undefined;
  }
}

function buildDescription(doc: ToolDoc): string {
  const rules = doc.rules.filter((rule) => !rule.includes(PROTOCOL_BOILERPLATE_MARKER));
  if (rules.length === 0) {
    return `${doc.name}: ${doc.description}`;
  }
  return `${doc.name}: ${doc.description}\n\nRules:\n${rules.map((rule) => `- ${rule}`).join('\n')}`;
}

function buildTool(doc: ToolDoc): { tool?: McpToolDescriptor; reason?: string } {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const param of doc.parameters) {
    const schema = toJsonSchemaType(param);
    if (!schema) {
      return { reason: `parameter "${param.name}" declares unsupported type "${param.type}"` };
    }
    const property: Record<string, unknown> = {
      ...schema,
      description: param.description,
    };
    const defaultValue = coerceDefault(param);
    if (defaultValue !== undefined) {
      property.default = defaultValue;
    }
    properties[param.name] = property;
    if (param.required) {
      required.push(param.name);
    }
  }

  return {
    tool: {
      name: doc.kind,
      description: buildDescription(doc),
      inputSchema: {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
      },
    },
  };
}

export function buildToolCatalog(docs: readonly ToolDoc[]): ToolCatalog {
  const tools: McpToolDescriptor[] = [];
  const excluded: ExcludedTool[] = [];
  const seen = new Set<string>();

  for (const doc of docs) {
    if (seen.has(doc.kind)) {
      excluded.push({ kind: doc.kind, reason: 'duplicate kind in tool registry' });
      continue;
    }
    seen.add(doc.kind);
    const { tool, reason } = buildTool(doc);
    if (!tool) {
      excluded.push({ kind: doc.kind, reason: reason ?? 'unknown catalog defect' });
      continue;
    }
    tools.push(tool);
  }

  return { tools, excluded };
}

export function getToolCatalog(): ToolCatalog {
  initializeToolRegistry();
  return buildToolCatalog(globalToolRegistry.getAllTools());
}
