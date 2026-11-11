import { workspaceContextOptions } from '../../../../kernel/src/__tests__/support/workspaceContext.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrudToolsToken, createStandardKernel } from '@brud/kernel';
import type {
  BrudKernel,
  IBrudToolsService,
  ServiceContext,
} from '@brud/kernel';
import { catalogManifest, catalogPlugin } from '../plugin.js';

const TEST_TOOL_NAME = 'test_tool';
const TEST_TOOL_DESCRIPTION = 'A deterministic tool used to exercise the catalog.';
const TEST_TOOL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    message: { type: 'string' },
  },
  required: ['message'],
  additionalProperties: false,
};

describe('Catalog plugin', () => {
  let kernel: BrudKernel;
  let root: string;
  let caller: ServiceContext;
  let tools: IBrudToolsService;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'brud-catalog-test-'));
    kernel = createStandardKernel({
      initialPlugins: [catalogPlugin],
      history: { dbPath: join(root, '.brud', 'history', 'universal.db') },
    });

    await kernel.boot({ options: {...workspaceContextOptions(root)} });

    caller = {
      callerId: 'test.catalog',
      tier: 'core',
      workspaceRoot: root,
    };
    tools = kernel.requestAccess(caller, BrudToolsToken);
    tools.registerTool('test.catalog.fixture', false, {
      name: TEST_TOOL_NAME,
      description: TEST_TOOL_DESCRIPTION,
      parametersSchema: TEST_TOOL_SCHEMA,
      execute: async (): Promise<{ status: 'success' }> => ({ status: 'success' }),
    });
  });

  after(async () => {
    await kernel.shutdown();
    await rm(root, { recursive: true, force: true });
  });

  it('declares the expected manifest identity and permission', () => {
    assert.equal(catalogManifest.id, 'akkhar-labs.plugin.catalog');
    assert.deepEqual(catalogManifest.permissions, ['tools:register']);
  });

  it('returns the full tool list with names, descriptions and schemas', async () => {
    const result = await tools.executeTool(
      'get_tool_info',
      {},
      { workspaceRoot: root, callerId: 'test.catalog', permissions: ['tools:register'] },
    );

    assert.equal(result.status, 'success');
    const message = String(result.message);

    assert.match(message, /^Available tools:/u);
    assert.ok(
      message.includes(TEST_TOOL_NAME),
      'the list must include the raw tool name test_tool',
    );
    assert.ok(message.includes(TEST_TOOL_DESCRIPTION), 'the list must include its description');
    assert.ok(
      message.includes(JSON.stringify(TEST_TOOL_SCHEMA)),
      'the list must include the registered schema',
    );
    assert.match(message, /CRITICAL MANDATE/u);

    const data = result.data as { count: number; tools: readonly { name: string }[] };
    assert.ok(data.count >= 2, 'the catalog itself and the fixture tool are registered');
    assert.ok(data.tools.some((tool) => tool.name === TEST_TOOL_NAME));
  });

  it('returns the detailed schema for a specific tool', async () => {
    const result = await tools.executeTool(
      'get_tool_info',
      { tool: TEST_TOOL_NAME },
      { workspaceRoot: root, callerId: 'test.catalog', permissions: ['tools:register'] },
    );

    assert.equal(result.status, 'success');
    const message = String(result.message);

    assert.ok(message.includes(`Tool: ${TEST_TOOL_NAME}`));
    assert.ok(message.includes(`Description: ${TEST_TOOL_DESCRIPTION}`));
    assert.ok(message.includes(JSON.stringify(TEST_TOOL_SCHEMA, null, 2)));

    const data = result.data as { name: string; parametersSchema: Record<string, unknown> };
    assert.equal(data.name, TEST_TOOL_NAME);
    assert.deepEqual(data.parametersSchema, TEST_TOOL_SCHEMA);
  });

  it('returns a structured TOOL_NOT_FOUND error for an unknown tool', async () => {
    const result = await tools.executeTool(
      'get_tool_info',
      { tool: 'does_not_exist' },
      { workspaceRoot: root, callerId: 'test.catalog', permissions: ['tools:register'] },
    );

    assert.equal(result.status, 'failed');
    assert.match(String(result.error), /^TOOL_NOT_FOUND: /u);

    const data = result.data as { code: string; tool: string };
    assert.equal(data.code, 'TOOL_NOT_FOUND');
    assert.equal(data.tool, 'does_not_exist');
  });
});
