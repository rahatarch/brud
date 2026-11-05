import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IBrudToolsService } from '@brud/kernel';
import {
  CATALOG_MANDATE,
  LEGACY_MANDATE,
  LEGACY_OPERATIONS,
  LEGACY_TOOL_KINDS,
  LEGACY_TO_NEW,
  bootCatalogKernel,
  callCatalog,
  newToolsService,
  registerFixture,
  registerLeafFixtures,
} from './catalog-test-helpers.js';
import { formatToolDetails, formatToolList } from '../plugin.js';

function listNames(service: IBrudToolsService): string[] {
  return [...formatToolList(service.listTools()).matchAll(/^- ([^:\n]+):/gmu)].map((match) => match[1] ?? '');
}

describe('Catalog legacy parity', () => {
  it('starts the full list with the legacy Available tools header', () => {
    assert.match(formatToolList([]), /^Available tools:\n/u);
  });

  it('ends the full list with a blank-line-prefixed critical mandate', () => {
    const tools = newToolsService();
    registerFixture(tools, { name: 'parity_tool', pluginId: 'parity.owner' });

    assert.match(formatToolList(tools.listTools()), /\n\n\*\*CRITICAL MANDATE:\*\* /u);
  });

  it('contains the critical mandate exactly once per list', () => {
    const tools = newToolsService();
    registerFixture(tools, { name: 'parity_tool', pluginId: 'parity.owner' });
    const occurrences = formatToolList(tools.listTools()).split('**CRITICAL MANDATE:**').length - 1;

    assert.equal(occurrences, 1);
  });

  it('uses the intentional Phase 7 mandate, not the legacy text', () => {
    const message = formatToolList([]);
    const mandate = message.slice(message.indexOf('\n\n**CRITICAL MANDATE:**'));

    assert.equal(mandate, `\n\n${CATALOG_MANDATE}`);
    assert.notEqual(mandate, LEGACY_MANDATE);
    // Divergence is recorded in
    // `.internal_docs/decisions/2026-11-05_mandate_text_divergence.md`.
  });

  it('documents the current mandate text', () => {
    const message = formatToolList([]);

    assert.ok(message.endsWith(CATALOG_MANDATE));
    assert.equal(CATALOG_MANDATE.split('\n').length, 1);
  });

  it('documents the mandate divergence from legacy', () => {
    assert.notEqual(CATALOG_MANDATE, LEGACY_MANDATE.replace(/^\n\n/u, ''));
    assert.ok(CATALOG_MANDATE.includes('Each tool has a registered schema'));
    assert.ok(CATALOG_MANDATE.includes('Do not invent tools or parameters'));
    assert.ok(!CATALOG_MANDATE.includes('You have NOT been provided'));
    assert.ok(LEGACY_MANDATE.includes('You have NOT been provided'));
    assert.ok(LEGACY_MANDATE.includes('Tool: <kind>'));
    assert.ok(CATALOG_MANDATE.includes('Tool: <name>'));
  });

  it('documents the list entry format change from one line to two lines', () => {
    const tools = newToolsService();
    registerFixture(tools, {
      name: 'two_line_tool',
      description: 'Two line entry',
      schema: { type: 'object', properties: {} },
      pluginId: 'parity.owner',
    });
    const list = formatToolList(tools.listTools());
    const entry = list.split('\n').filter((line) =>
      line.startsWith(`- two_line_tool:`));

    assert.equal(entry.length, 1);
    assert.ok(list.includes('\n  schema: '));
  });

  it('documents the empty-registry placeholder as a legacy divergence', () => {
    const legacyEmpty = `Available tools:\n${LEGACY_MANDATE}`;
    const catalogEmpty = formatToolList([]);

    assert.notEqual(catalogEmpty, legacyEmpty);
    assert.ok(catalogEmpty.includes('(no tools registered)'));
    assert.ok(!legacyEmpty.includes('(no tools registered)'));
  });

  it('maps legacy detail fields onto the new detail shape', () => {
    const tools = newToolsService();
    registerFixture(tools, {
      name: 'detail_parity',
      description: 'Detail parity tool',
      schema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      pluginId: 'parity.owner',
    });
    const detail = formatToolDetails(tools.getTool('detail_parity')!);

    assert.ok(detail.startsWith(`Tool: detail_parity\n`));
    assert.ok(detail.includes('Description: Detail parity tool'));
    assert.ok(detail.includes('Owner: parity.owner'));
    assert.ok(detail.includes('Official: false'));
    assert.ok(detail.includes('Parameters Schema:'));
  });

  it('does not render the legacy Marker, Parameters, Rules or Example sections', () => {
    const tools = newToolsService();
    registerFixture(tools, { name: 'detail_parity', pluginId: 'parity.owner' });
    const detail = formatToolDetails(tools.getTool('detail_parity')!);

    assert.ok(!detail.includes('Marker:'));
    assert.ok(!detail.includes('\nParameters:\n'));
    assert.ok(!detail.includes('\nRules:\n'));
    assert.ok(!detail.includes('\nExample:\n'));
  });

  it('returns a structured TOOL_NOT_FOUND for an unknown tool instead of throwing', async () => {
    const context = await bootCatalogKernel();

    try {
      const result = await callCatalog(context.tools, context.root, { tool: 'legacy_unknown' });
      const data = result.data as { code: string; tool: string };

      assert.equal(result.status, 'failed');
      assert.equal(data.code, 'TOOL_NOT_FOUND');
      assert.equal(data.tool, 'legacy_unknown');
      assert.match(String(result.error), /^TOOL_NOT_FOUND: /u);
    } finally {
      await context.cleanup();
    }
  });

  it('returns the full list for an empty tool name, matching legacy truthiness', async () => {
    const context = await bootCatalogKernel();

    try {
      const result = await callCatalog(context.tools, context.root, { tool: '' });

      assert.equal(result.status, 'success');
      assert.match(String(result.message), /^Available tools:\n/u);
    } finally {
      await context.cleanup();
    }
  });

  it('treats a whitespace-only name as truthy and returns TOOL_NOT_FOUND', async () => {
    const context = await bootCatalogKernel();

    try {
      const result = await callCatalog(context.tools, context.root, { tool: ' ' });

      assert.equal(result.status, 'failed');
      assert.equal((result.data as { code: string }).code, 'TOOL_NOT_FOUND');
    } finally {
      await context.cleanup();
    }
  });

  it('preserves legacy insertion order instead of sorting alphabetically', () => {
    const tools = newToolsService();
    const registrationOrder = ['zulu', 'alpha', 'mike', 'bravo'];

    for (const name of registrationOrder) {
      registerFixture(tools, { name, pluginId: 'parity.order' });
    }

    assert.deepEqual(listNames(tools), registrationOrder);
    assert.notDeepEqual(listNames(tools), [...registrationOrder].sort());
  });

  it('enumerates the legacy 20 registry tools plus get_tool_info as 21 operations', () => {
    assert.equal(LEGACY_TOOL_KINDS.length, 20);
    assert.equal(LEGACY_OPERATIONS.length, 21);
    assert.ok(LEGACY_OPERATIONS.includes('get_tool_info'));
  });

  it('maps four legacy operations to new registered tools', () => {
    const mapped = Object.entries(LEGACY_TO_NEW)
      .filter(([, replacement]) => replacement !== null)
      .map(([legacy]) => legacy)
      .sort();

    assert.deepEqual(mapped, [
      'codebase_metadata',
      'extract_structure',
      'get_tool_info',
      'search_files',
    ]);
  });

  it('documents the seventeen legacy operations without a new equivalent', () => {
    const unmapped = Object.entries(LEGACY_TO_NEW)
      .filter(([, replacement]) => replacement === null)
      .map(([legacy]) => legacy)
      .sort();

    assert.equal(unmapped.length, 17);
    assert.ok(unmapped.includes('search_replace'));
    assert.ok(unmapped.includes('terminal_command'));
  });

  it('serves details for all four mapped tools', async () => {
    const context = await bootCatalogKernel();
    registerLeafFixtures(context.tools);

    try {
      for (const name of ['extract_structure', 'codebase_metadata', 'search_files', 'get_tool_info']) {
        const result = await callCatalog(context.tools, context.root, { tool: name });

        assert.equal(result.status, 'success', `${name} should resolve`);
        assert.ok(String(result.message).includes(`Tool: ${name}`));
      }
    } finally {
      await context.cleanup();
    }
  });

  it('returns TOOL_NOT_FOUND for each unmapped legacy operation', async () => {
    const context = await bootCatalogKernel();
    registerLeafFixtures(context.tools);

    try {
      for (const [legacy, replacement] of Object.entries(LEGACY_TO_NEW)) {
        if (replacement !== null) {
          continue;
        }

        const result = await callCatalog(context.tools, context.root, { tool: legacy });

        assert.equal(result.status, 'failed', `${legacy} should not be registered`);
        assert.equal((result.data as { code: string }).code, 'TOOL_NOT_FOUND');
      }
    } finally {
      await context.cleanup();
    }
  });

  it('documents the schema rendering change from parameter lines to JSON', () => {
    const tools = newToolsService();
    registerFixture(tools, {
      name: 'schema_parity',
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          position: { type: 'string', description: 'Where to append', default: 'end' },
        },
        required: ['path'],
      },
      pluginId: 'parity.owner',
    });
    const detail = formatToolDetails(tools.getTool('schema_parity')!);

    assert.ok(detail.includes(JSON.stringify(tools.getTool('schema_parity')!.parametersSchema, null, 2)));
    assert.ok(!detail.includes('  - path (string) [required]: File path'));
    assert.ok(!detail.includes('(default: end)'));
  });

  it('documents the list line change from kind-name-description to name-description', () => {
    const tools = newToolsService();
    registerFixture(tools, { name: 'line_parity', description: 'Line parity', pluginId: 'parity.owner' });
    const list = formatToolList(tools.listTools());

    assert.ok(list.includes(`- line_parity: Line parity`));
    assert.ok(!list.includes('line_parity - line_parity: Line parity'));
  });

  it('documents that the legacy Marker field has no new equivalent', () => {
    const tools = newToolsService();
    registerFixture(tools, { name: 'marker_parity', pluginId: 'parity.owner' });
    const tool = tools.getTool('marker_parity');

    assert.ok(tool !== undefined);
    assert.equal('marker' in tool, false);
    assert.equal('rules' in tool, false);
    assert.equal('example' in tool, false);
  });

  it('documents that get_tool_info is now a registry tool, not a special operation', async () => {
    const context = await bootCatalogKernel();

    try {
      const registered = context.tools.getTool('get_tool_info');

      assert.ok(registered !== undefined);
      assert.equal(registered.ownerPluginId, 'akkhar-labs.plugin.catalog');
      assert.equal(registered.isOfficial, false);
    } finally {
      await context.cleanup();
    }
  });

  it('documents that the mandate text length and wording differ from legacy', () => {
    assert.notEqual(Buffer.byteLength(CATALOG_MANDATE), Buffer.byteLength(LEGACY_MANDATE.replace(/^\n\n/u, '')));
    assert.ok(LEGACY_MANDATE.includes('parameter schemas or block syntax'));
    assert.ok(!CATALOG_MANDATE.includes('parameter schemas or block syntax'));
    assert.ok(CATALOG_MANDATE.includes('has a registered schema'));
    assert.ok(CATALOG_MANDATE.includes('get_tool_info'));
  });

  it('documents that no pagination exists in either implementation', () => {
    const tools = newToolsService();

    for (let index = 0; index < 150; index += 1) {
      registerFixture(tools, {
        name: `unpaginated_${index}`,
        pluginId: `parity.pagination.${Math.floor(index / 100)}`,
      });
    }

    const names = listNames(tools);
    assert.equal(names.length, 150);
    assert.equal(tools.listTools().length, 150);
  });
});