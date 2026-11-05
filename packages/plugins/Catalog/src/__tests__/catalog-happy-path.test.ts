import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CatalogKernel } from './catalog-test-helpers.js';
import {
  CATALOG_MANDATE,
  LEAF_FIXTURES,
  bootCatalogKernel,
  callCatalog,
  registerFixture,
  registerLeafFixtures,
} from './catalog-test-helpers.js';
import { catalogManifest } from '../plugin.js';

interface CatalogListData {
  readonly count: number;
  readonly tools: readonly {
    readonly name: string;
    readonly description: string;
    readonly parametersSchema: Record<string, unknown>;
    readonly ownerPluginId: string;
    readonly isOfficial: boolean;
  }[];
}

interface CatalogDetailData {
  readonly name: string;
  readonly description: string;
  readonly parametersSchema: Record<string, unknown>;
  readonly ownerPluginId: string;
  readonly isOfficial: boolean;
}

const SYNTHETIC_NAME = 'synthetic_detail_tool';
const SYNTHETIC_DESCRIPTION = 'A synthetic tool used to verify detail mode.';
const SYNTHETIC_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    count: { type: 'number' },
  },
  required: ['message'],
  additionalProperties: false,
};

describe('Catalog happy path', () => {
  let context: CatalogKernel;

  before(async () => {
    context = await bootCatalogKernel();
    registerLeafFixtures(context.tools);
    registerFixture(context.tools, {
      name: SYNTHETIC_NAME,
      description: SYNTHETIC_DESCRIPTION,
      schema: SYNTHETIC_SCHEMA,
      pluginId: 'test.synthetic',
    });
  });

  after(async () => {
    await context.cleanup();
  });

  it('declares the expected manifest identity, name, version and permission', () => {
    assert.equal(catalogManifest.id, 'akkhar-labs.plugin.catalog');
    assert.equal(catalogManifest.name, 'Catalog');
    assert.equal(catalogManifest.version, '0.0.1');
    assert.deepEqual(catalogManifest.permissions, ['tools:register']);
  });

  it('returns the full registry list when no parameter is supplied', async () => {
    const result = await callCatalog(context.tools, context.root, {});

    assert.equal(result.status, 'success');
    const data = result.data as CatalogListData;

    assert.equal(data.count, context.tools.listTools().length);
    assert.equal(data.tools.length, data.count);
  });

  it('includes every registered tool name in the full list', async () => {
    const result = await callCatalog(context.tools, context.root, {});
    const message = String(result.message);
    const names = ['extract_structure', 'codebase_metadata', 'search_files', 'get_tool_info', SYNTHETIC_NAME];

    for (const name of names) {
      assert.ok(
        message.includes(name),
        `list must include the raw tool name ${name}`,
      );
    }
  });

  it('starts the full list with the legacy Available tools header', async () => {
    const result = await callCatalog(context.tools, context.root, {});

    assert.match(String(result.message), /^Available tools:\n/u);
  });

  it('ends the full list with the critical mandate trailer', async () => {
    const result = await callCatalog(context.tools, context.root, {});

    assert.ok(String(result.message).endsWith(`\n\n${CATALOG_MANDATE}`));
  });

  it('contains the critical mandate exactly once in the full list', async () => {
    const result = await callCatalog(context.tools, context.root, {});
    const occurrences = String(result.message).split('**CRITICAL MANDATE:**').length - 1;

    assert.equal(occurrences, 1);
  });

  it('reports the catalog tool itself in the full list', async () => {
    const result = await callCatalog(context.tools, context.root, {});
    const data = result.data as CatalogListData;

    assert.ok(data.tools.some((tool) => tool.name === 'get_tool_info'));
  });

  it('reports every tool projection with owner and official fields', async () => {
    const result = await callCatalog(context.tools, context.root, {});
    const data = result.data as CatalogListData;

    for (const tool of data.tools) {
      assert.equal(typeof tool.ownerPluginId, 'string');
      assert.equal(typeof tool.isOfficial, 'boolean');
    }
  });

  it('returns details for extract_structure', async () => {
    const result = await callCatalog(context.tools, context.root, { tool: 'extract_structure' });
    const message = String(result.message);

    assert.equal(result.status, 'success');
    assert.ok(message.includes(`Tool: extract_structure`));
    assert.ok(message.includes(LEAF_FIXTURES[0]?.description ?? ''));
  });

  it('returns details for codebase_metadata', async () => {
    const result = await callCatalog(context.tools, context.root, { tool: 'codebase_metadata' });
    const message = String(result.message);

    assert.equal(result.status, 'success');
    assert.ok(message.includes(`Tool: codebase_metadata`));
    assert.ok(message.includes(LEAF_FIXTURES[1]?.description ?? ''));
  });

  it('returns details for search_files', async () => {
    const result = await callCatalog(context.tools, context.root, { tool: 'search_files' });
    const message = String(result.message);

    assert.equal(result.status, 'success');
    assert.ok(message.includes(`Tool: search_files`));
    assert.ok(message.includes(LEAF_FIXTURES[2]?.description ?? ''));
  });

  it('returns details for get_tool_info itself', async () => {
    const result = await callCatalog(context.tools, context.root, { tool: 'get_tool_info' });
    const message = String(result.message);
    const data = result.data as CatalogDetailData;

    assert.equal(result.status, 'success');
    assert.equal(data.name, 'get_tool_info');
    assert.ok(message.includes(`Tool: get_tool_info`));
    assert.ok(message.includes('Parameters Schema:'));
  });

  it('returns details for a synthetic tool', async () => {
    const result = await callCatalog(context.tools, context.root, { tool: SYNTHETIC_NAME });
    const data = result.data as CatalogDetailData;

    assert.equal(result.status, 'success');
    assert.equal(data.name, SYNTHETIC_NAME);
    assert.equal(data.description, SYNTHETIC_DESCRIPTION);
    assert.deepEqual(data.parametersSchema, SYNTHETIC_SCHEMA);
  });

  it('prints the pretty-printed schema in detail mode', async () => {
    const result = await callCatalog(context.tools, context.root, { tool: SYNTHETIC_NAME });

    assert.ok(
      String(result.message).includes(JSON.stringify(SYNTHETIC_SCHEMA, null, 2)),
      'detail must carry the two-space JSON schema',
    );
  });

  it('prints owner and official status in detail mode', async () => {
    const result = await callCatalog(context.tools, context.root, { tool: SYNTHETIC_NAME });

    assert.ok(String(result.message).includes('Owner: test.synthetic'));
    assert.ok(String(result.message).includes('Official: false'));
  });

  it('returns the registry projection as detail data', async () => {
    const result = await callCatalog(context.tools, context.root, { tool: SYNTHETIC_NAME });
    const data = result.data as CatalogDetailData;
    const registered = context.tools.getTool(SYNTHETIC_NAME);

    assert.deepEqual(data, registered);
  });

  it('returns a structured TOOL_NOT_FOUND failure for an unknown tool', async () => {
    const result = await callCatalog(context.tools, context.root, { tool: 'does_not_exist' });
    const data = result.data as { code: string; tool: string };

    assert.equal(result.status, 'failed');
    assert.equal(data.code, 'TOOL_NOT_FOUND');
    assert.equal(data.tool, 'does_not_exist');
    assert.match(String(result.error), /^TOOL_NOT_FOUND: /u);
  });

  it('does not throw for an unknown tool', async () => {
    await assert.doesNotReject(
      callCatalog(context.tools, context.root, { tool: 'not_registered' }),
    );
  });

  it('returns the full list for an empty tool name (legacy truthiness policy)', async () => {
    const result = await callCatalog(context.tools, context.root, { tool: '' });

    assert.equal(result.status, 'success');
    assert.match(String(result.message), /^Available tools:\n/u);
  });

  it('returns TOOL_NOT_FOUND for a whitespace-only tool name (no trimming)', async () => {
    const result = await callCatalog(context.tools, context.root, { tool: '   ' });
    const data = result.data as { code: string; tool: string };

    assert.equal(result.status, 'failed');
    assert.equal(data.code, 'TOOL_NOT_FOUND');
    assert.equal(data.tool, '   ');
  });

  it('does not trim surrounding whitespace from a real tool name', async () => {
    const result = await callCatalog(context.tools, context.root, { tool: ` ${SYNTHETIC_NAME} ` });

    assert.equal(result.status, 'failed');
    assert.equal((result.data as { code: string }).code, 'TOOL_NOT_FOUND');
  });

  it('rejects a non-string tool value at the schema gate', async () => {
    for (const value of [42, null, true, { name: SYNTHETIC_NAME }, [SYNTHETIC_NAME]]) {
      const result = await callCatalog(context.tools, context.root, { tool: value });

      assert.equal(result.status, 'failed');
      assert.match(String(result.error), /TOOL_VALIDATION_ERROR/u);
    }
  });

  it('uses case-sensitive detail lookup', async () => {
    const result = await callCatalog(context.tools, context.root, { tool: 'SYNTHETIC_DETAIL_TOOL' });

    assert.equal(result.status, 'failed');
    assert.equal((result.data as { code: string }).code, 'TOOL_NOT_FOUND');
  });

  it('preserves registry insertion order in the full list', async () => {
    const result = await callCatalog(context.tools, context.root, {});
    const listed = (result.data as CatalogListData).tools.map((tool) => tool.name);
    const registered = context.tools.listTools().map((tool) => tool.name);

    assert.deepEqual(listed, registered);
    assert.equal(listed[0], 'get_tool_info');
  });

  it('returns stable results across repeated calls', async () => {
    const first = await callCatalog(context.tools, context.root, { tool: SYNTHETIC_NAME });
    const second = await callCatalog(context.tools, context.root, { tool: SYNTHETIC_NAME });

    assert.deepEqual(first.data, second.data);
    assert.equal(first.message, second.message);
  });
});