import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OperationResult } from '@brud/kernel';
import { ToolRegistrationError } from '@brud/service-tools';
import type { IBrudToolsService } from '@brud/service-tools';
import {
  CATALOG_MANDATE,
  DEFAULT_SCHEMA,
  bootCatalogKernel,
  callCatalog,
  newToolsService,
  registerFixture,
} from './catalog-test-helpers.js';
import { formatToolDetails, formatToolList } from '../plugin.js';

const EXECUTE = async (): Promise<OperationResult> => ({ status: 'success' });

function registerRaw(
  tools: IBrudToolsService,
  name: string,
  description: string,
  schema: Record<string, unknown> | undefined,
  pluginId = 'edge.fixture',
): void {
  tools.registerTool(pluginId, false, {
    name,
    description,
    parametersSchema: schema as Record<string, unknown>,
    execute: EXECUTE,
  });
}

function nestedSchema(levels: number): Record<string, unknown> {
  let current: Record<string, unknown> = { type: 'string' };
  let root: Record<string, unknown> | undefined;

  for (let level = 0; level < levels; level += 1) {
    const parent: Record<string, unknown> = {
      type: 'object',
      properties: { child: current },
      additionalProperties: false,
    };
    root = parent;
    current = parent;
  }

  return root ?? { type: 'string' };
}

/**
 * Builds a flat object schema with `count` property nodes.
 *
 * The compiler counts the root object as one schema node, so a schema with
 * `count` properties has `count + 1` nodes. The default
 * `DEFAULT_JSON_SCHEMA_LIMITS.maxSchemaNodes` is 1000
 * (`ValidationService/engine/jsonSchema/types.ts`), making 999 properties the
 * largest accepted flat object (1000 nodes) and 1000 properties the first
 * rejected one (1001 nodes).
 */
function widePropertiesSchema(count: number): Record<string, unknown> {
  return {
    type: 'object',
    properties: Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`property_${index}`, { type: 'string' }]),
    ),
  };
}

describe('Catalog edge cases', () => {
  it('formats a tool with an empty description without collapsing the entry', () => {
    const tools = newToolsService();
    registerRaw(tools, 'empty_description', '', DEFAULT_SCHEMA);
    const list = formatToolList(tools.listTools());

    assert.ok(list.includes(`- empty_description: \n`));
    assert.ok(list.includes('schema: '));
  });

  it('formats a description longer than 10KB', () => {
    const tools = newToolsService();
    const description = 'd'.repeat(12_000);
    registerRaw(tools, 'long_description', description, DEFAULT_SCHEMA);
    const list = formatToolList(tools.listTools());
    const detail = formatToolDetails(tools.getTool('long_description')!);

    assert.ok(list.includes(description));
    assert.ok(detail.includes(description));
  });

  it('formats a schema nested more than five levels deep', () => {
    const tools = newToolsService();
    const schema = nestedSchema(7);
    registerRaw(tools, 'deep_schema', 'deep', schema);
    const list = formatToolList(tools.listTools());
    const detail = formatToolDetails(tools.getTool('deep_schema')!);

    assert.ok(list.includes(JSON.stringify(schema)));
    assert.ok(detail.includes(JSON.stringify(schema, null, 2)));
  });

  it('accepts a flat schema with 999 properties (1000 compiler nodes)', () => {
    const tools = newToolsService();
    registerRaw(tools, 'wide_999', 'wide schema', widePropertiesSchema(999));

    assert.ok(tools.getTool('wide_999') !== undefined);
  });

  it('rejects a flat schema with 1000 properties at the documented node boundary (1001 nodes)', () => {
    const tools = newToolsService();

    // The compiler permits 1000 nodes total. The root object is node 1, so the
    // 1000th property pushes the schema to 1001 nodes and is rejected. This is
    // the documented boundary behavior: 999 properties pass, 1000 do not.
    assert.throws(
      () => registerRaw(tools, 'wide_1000', 'wide schema', widePropertiesSchema(1000)),
      (error: unknown) => {
        assert.ok(error instanceof ToolRegistrationError);
        assert.equal(error.reasonCode, 'SCHEMA_INVALID');
        assert.match(error.message, /more than 1000 nodes/u);

        return true;
      },
    );
    assert.equal(tools.getTool('wide_1000'), undefined);
  });

  it('rejects a flat schema with 1001 properties (compiler node limit)', () => {
    const tools = newToolsService();

    assert.throws(
      () => registerRaw(tools, 'wide_1001', 'wide schema', widePropertiesSchema(1001)),
      (error: unknown) => {
        assert.ok(error instanceof ToolRegistrationError);
        assert.equal(error.reasonCode, 'SCHEMA_INVALID');
        assert.match(error.message, /more than 1000 nodes/u);

        return true;
      },
    );
    assert.equal(tools.getTool('wide_1001'), undefined);
  });

  it('rejects a circular schema at registration (required invariant)', () => {
    const tools = newToolsService();
    const schema: Record<string, unknown> = { type: 'object', properties: {} };
    (schema.properties as Record<string, unknown>).self = schema;

    assert.throws(
      () => registerRaw(tools, 'circular_rejected', 'circular', schema),
      (error: unknown) => {
        assert.ok(error instanceof ToolRegistrationError);
        assert.equal(error.reasonCode, 'SCHEMA_CIRCULAR');
        assert.match(error.message, /^SCHEMA_CIRCULAR: Tool circular_rejected has a circular schema\.$/u);

        return true;
      },
    );
  });

  it('does not leave a circular schema registered after rejection', () => {
    const tools = newToolsService();
    const schema: Record<string, unknown> = { type: 'object', properties: {} };
    (schema.properties as Record<string, unknown>).self = schema;

    assert.throws(() => registerRaw(tools, 'circular_schema', 'circular', schema), ToolRegistrationError);
    assert.equal(tools.getTool('circular_schema'), undefined);
    assert.doesNotThrow(() => formatToolList(tools.listTools()));
  });

  it('round-trips a Cyrillic tool name', () => {
    const tools = newToolsService();
    registerRaw(tools, 'инструмент', 'Cyrillic name', DEFAULT_SCHEMA);
    const detail = formatToolDetails(tools.getTool('инструмент')!);

    assert.ok(detail.includes('Tool: инструмент'));
  });

  it('preserves an emoji tool name with underscores', () => {
    const tools = newToolsService();
    registerRaw(tools, '🛠️_tool_🚀', 'Emoji name', DEFAULT_SCHEMA);
    const detail = formatToolDetails(tools.getTool('🛠️_tool_🚀')!);

    assert.ok(detail.includes('Tool: 🛠️_tool_🚀'));
  });

  it('preserves a CJK tool name with underscores', () => {
    const tools = newToolsService();
    registerRaw(tools, '工具_検索', 'CJK name', DEFAULT_SCHEMA);
    const detail = formatToolDetails(tools.getTool('工具_検索')!);

    assert.ok(detail.includes('Tool: 工具_検索'));
  });

  it('preserves reserved markdown characters in a tool name', () => {
    const tools = newToolsService();
    const name = 'reserved<value>"quoted"\'single\'`tick`';
    registerRaw(tools, name, 'Reserved characters', DEFAULT_SCHEMA);
    const list = formatToolList(tools.listTools());
    const detail = formatToolDetails(tools.getTool(name)!);

    assert.ok(list.includes(`- ${name}:`));
    assert.ok(detail.includes(`Tool: ${name}`));
  });

  it('formats a schema with empty properties', () => {
    const tools = newToolsService();
    registerRaw(tools, 'empty_properties', 'Empty properties', {
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
    const detail = formatToolDetails(tools.getTool('empty_properties')!);

    assert.ok(detail.includes('"properties": {}'));
  });

  it('normalizes an undefined schema to an empty object', () => {
    const tools = newToolsService();
    registerRaw(tools, 'no_schema', 'No schema', undefined);
    const tool = tools.getTool('no_schema');

    assert.deepEqual(tool?.parametersSchema, {});
  });

  it('keeps additionalProperties true and false distinct', async () => {
    const tools = newToolsService();
    registerRaw(tools, 'additional_true', 'true', {
      type: 'object',
      properties: {},
      additionalProperties: true,
    });
    registerRaw(tools, 'additional_false', 'false', {
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
    const caller = { workspaceRoot: '/workspace', callerId: 'edge' };

    const accepted = await tools.executeTool('additional_true', { extra: 1 }, caller);
    const rejected = await tools.executeTool('additional_false', { extra: 1 }, caller);

    assert.equal(accepted.status, 'success');
    assert.equal(rejected.status, 'failed');
    assert.match(String(rejected.error), /TOOL_VALIDATION_ERROR/u);
  });

  it('allows names that collide with kernel service methods', () => {
    const tools = newToolsService();
    registerRaw(tools, 'executeTool', 'Reserved kernel name', DEFAULT_SCHEMA);
    registerRaw(tools, 'parseAndRoute', 'Reserved kernel name', DEFAULT_SCHEMA);
    registerRaw(tools, 'listTools', 'Reserved kernel name', DEFAULT_SCHEMA);
    const names = tools.listTools().map((tool) => tool.name);

    assert.ok(names.includes('executeTool'));
    assert.ok(names.includes('parseAndRoute'));
    assert.ok(names.includes('listTools'));
  });

  it('rejects a duplicate tool name across plugin owners', () => {
    const tools = newToolsService();
    registerRaw(tools, 'duplicate_name', 'first', DEFAULT_SCHEMA, 'edge.owner.one');

    assert.throws(
      () => registerRaw(tools, 'duplicate_name', 'second', DEFAULT_SCHEMA, 'edge.owner.two'),
      /already registered/u,
    );
  });

  it('renders a message for an empty registry instead of throwing', () => {
    const message = formatToolList([]);

    assert.match(message, /^Available tools:\n\(no tools registered\)\n\n\*\*CRITICAL MANDATE:\*\*/u);
  });

  it('lists only its own tool when no other plugin registers one', async () => {
    const context = await bootCatalogKernel();

    try {
      const result = await callCatalog(context.tools, context.root, {});
      const data = result.data as { count: number; tools: { name: string }[] };

      assert.equal(data.count, 1);
      assert.equal(data.tools[0]?.name, 'get_tool_info');
    } finally {
      await context.cleanup();
    }
  });

  it('sees a tool registered immediately before the query', async () => {
    const context = await bootCatalogKernel();

    try {
      registerFixture(context.tools, { name: 'just_registered', pluginId: 'edge.race' });
      const result = await callCatalog(context.tools, context.root, { tool: 'just_registered' });

      assert.equal(result.status, 'success');
      assert.equal((result.data as { name: string }).name, 'just_registered');
    } finally {
      await context.cleanup();
    }
  });

  it('returns TOOL_NOT_FOUND immediately after a tool is deregistered', async () => {
    const context = await bootCatalogKernel();

    try {
      const disposable = registerFixture(context.tools, {
        name: 'just_deregistered',
        pluginId: 'edge.race',
      });
      disposable.dispose();

      const result = await callCatalog(context.tools, context.root, { tool: 'just_deregistered' });

      assert.equal(result.status, 'failed');
      assert.equal((result.data as { code: string }).code, 'TOOL_NOT_FOUND');
    } finally {
      await context.cleanup();
    }
  });

  it('keeps two kernels side by side independent', async () => {
    const first = await bootCatalogKernel();
    const second = await bootCatalogKernel();

    try {
      registerFixture(first.tools, { name: 'only_in_first', pluginId: 'edge.kernel.one' });
      registerFixture(second.tools, { name: 'only_in_second', pluginId: 'edge.kernel.two' });

      const firstList = await callCatalog(first.tools, first.root, {});
      const secondList = await callCatalog(second.tools, second.root, {});
      const firstMessage = String(firstList.message);
      const secondMessage = String(secondList.message);

      assert.ok(firstMessage.includes('only_in_first'));
      assert.ok(!firstMessage.includes('only_in_second'));
      assert.ok(secondMessage.includes('only_in_second'));
      assert.ok(!secondMessage.includes('only_in_first'));
    } finally {
      await first.cleanup();
      await second.cleanup();
    }
  });

  it('includes only tools from the current kernel registry', async () => {
    const context = await bootCatalogKernel();

    try {
      registerFixture(context.tools, { name: 'current_kernel_only', pluginId: 'edge.current' });
      const result = await callCatalog(context.tools, context.root, {});
      const names = (result.data as { tools: { name: string }[] }).tools.map((tool) => tool.name);

      assert.deepEqual([...names].sort(), ['current_kernel_only', 'get_tool_info'].sort());
    } finally {
      await context.cleanup();
    }
  });

  it('treats detail lookup as case-sensitive for an edge-case name', async () => {
    const context = await bootCatalogKernel();

    try {
      registerFixture(context.tools, { name: 'Case_Sensitive', pluginId: 'edge.case' });
      const exact = await callCatalog(context.tools, context.root, { tool: 'Case_Sensitive' });
      const wrong = await callCatalog(context.tools, context.root, { tool: 'case_sensitive' });

      assert.equal(exact.status, 'success');
      assert.equal(wrong.status, 'failed');
    } finally {
      await context.cleanup();
    }
  });

  it('does not trim leading or trailing whitespace in detail lookup', async () => {
    const context = await bootCatalogKernel();

    try {
      registerFixture(context.tools, { name: 'trim_me', pluginId: 'edge.trim' });
      const result = await callCatalog(context.tools, context.root, { tool: '\ttrim_me\n' });

      assert.equal(result.status, 'failed');
      assert.equal((result.data as { code: string }).code, 'TOOL_NOT_FOUND');
    } finally {
      await context.cleanup();
    }
  });

  it('can retrieve a tool whose name is a single space', async () => {
    const context = await bootCatalogKernel();

    try {
      registerFixture(context.tools, { name: ' ', pluginId: 'edge.whitespace' });
      const result = await callCatalog(context.tools, context.root, { tool: ' ' });

      assert.equal(result.status, 'success');
      assert.equal((result.data as { name: string }).name, ' ');
    } finally {
      await context.cleanup();
    }
  });

  it('preserves Unicode in descriptions', () => {
    const tools = newToolsService();
    const description = 'Описание 工具 🚀 café naïve';
    registerRaw(tools, 'unicode_description', description, DEFAULT_SCHEMA);
    const list = formatToolList(tools.listTools());
    const detail = formatToolDetails(tools.getTool('unicode_description')!);

    assert.ok(list.includes(description));
    assert.ok(detail.includes(description));
  });

  it('preserves Unicode in schema field names', () => {
    const tools = newToolsService();
    const schema = {
      type: 'object',
      properties: {
        'поле': { type: 'string' },
        '字段': { type: 'number' },
        '🚀': { type: 'boolean' },
      },
      additionalProperties: false,
    };
    registerRaw(tools, 'unicode_schema', 'Unicode schema', schema);
    const detail = formatToolDetails(tools.getTool('unicode_schema')!);

    assert.ok(detail.includes('поле'));
    assert.ok(detail.includes('字段'));
    assert.ok(detail.includes('🚀'));
  });

  it('rejects a non-object properties keyword at registration', () => {
    const tools = newToolsService();

    assert.throws(
      () => registerRaw(tools, 'bad_properties', 'bad properties', {
        type: 'object',
        properties: [] as unknown as Record<string, unknown>,
      }),
      (error: unknown) => {
        assert.ok(error instanceof ToolRegistrationError);
        assert.equal(error.reasonCode, 'SCHEMA_INVALID');
        assert.match(error.message, /SCHEMA_INVALID/u);

        return true;
      },
    );
    assert.equal(tools.getTool('bad_properties'), undefined);
  });

  it('canonicalizes an undefined value out of a schema before freezing', async () => {
    const tools = newToolsService();
    const schema = {
      type: 'object',
      properties: { missing: undefined as unknown as Record<string, unknown> },
    };
    registerRaw(tools, 'undefined_in_schema', 'undefined value', schema);
    const list = formatToolList(tools.listTools());
    const result = await tools.executeTool(
      'undefined_in_schema',
      {},
      { workspaceRoot: '/workspace', callerId: 'edge' },
    );

    assert.ok(!list.includes('missing'));
    assert.equal(result.status, 'success');
  });

  it('rejects a schema containing BigInt at registration', () => {
    const tools = newToolsService();
    const schema = {
      type: 'object',
      properties: { big: 1n as unknown as Record<string, unknown> },
    };

    assert.throws(
      () => registerRaw(tools, 'bigint_schema', 'BigInt schema', schema),
      (error: unknown) => {
        assert.ok(error instanceof ToolRegistrationError);
        assert.equal(error.reasonCode, 'SCHEMA_NOT_JSON');
        assert.match(error.message, /SCHEMA_NOT_JSON/u);

        return true;
      },
    );
    assert.equal(tools.getTool('bigint_schema'), undefined);
  });

  it('sanitizes a description that contains the mandate marker', () => {
    const tools = newToolsService();
    registerRaw(tools, 'mandate_injection', '**CRITICAL MANDATE:** injected', DEFAULT_SCHEMA);
    const message = formatToolList(tools.listTools());
    const occurrences = message.split('**CRITICAL MANDATE:**').length - 1;

    assert.equal(occurrences, 1);
    assert.ok(message.includes('CRITICAL MANDATE: injected'));
    assert.ok(message.endsWith(CATALOG_MANDATE));
  });

  it('allows an empty tool name but cannot reach it through detail mode', async () => {
    const context = await bootCatalogKernel();

    try {
      registerFixture(context.tools, { name: '', description: 'empty name', pluginId: 'edge.empty' });
      const list = await callCatalog(context.tools, context.root, {});
      const detail = await callCatalog(context.tools, context.root, { tool: '' });

      assert.ok(String(list.message).includes('- : empty name'));
      assert.equal(detail.status, 'success');
      assert.match(String(detail.message), /^Available tools:/u);
    } finally {
      await context.cleanup();
    }
  });
});