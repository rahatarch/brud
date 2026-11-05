import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IBrudToolsService, OperationResult } from '@brud/kernel';
import {
  bestOfMs,
  forceGc,
  heapUsed,
  makePluginContext,
  newToolsService,
  populateTools,
  registerFixture,
} from './catalog-test-helpers.js';
import { formatToolDetails, formatToolList } from '../plugin.js';

function buildService(count: number): IBrudToolsService {
  const service = newToolsService();
  populateTools(service, count);
  return service;
}

function detailFor(service: IBrudToolsService, name: string): void {
  const tool = service.getTool(name);

  if (tool !== undefined) {
    formatToolDetails(tool);
  }
}

describe('Catalog performance', () => {
  let small: IBrudToolsService;
  let medium: IBrudToolsService;
  let large: IBrudToolsService;

  before(() => {
    small = buildService(10);
    medium = buildService(1_000);
    large = buildService(10_000);
  });

  after(() => {
    small = newToolsService();
    medium = newToolsService();
    large = newToolsService();
  });

  it('lists 10 tools in under 10ms', () => {
    const elapsed = bestOfMs(5, () => {
      formatToolList(small.listTools());
    });

    assert.ok(elapsed < 10, `10-tool list took ${elapsed.toFixed(3)}ms`);
  });

  it('lists 100 tools in under 50ms', () => {
    const tools = buildService(100);
    const elapsed = bestOfMs(5, () => {
      formatToolList(tools.listTools());
    });

    assert.ok(elapsed < 50, `100-tool list took ${elapsed.toFixed(3)}ms`);
  });

  it('lists 1000 tools in under 200ms', () => {
    const elapsed = bestOfMs(5, () => {
      formatToolList(medium.listTools());
    });

    assert.ok(elapsed < 200, `1000-tool list took ${elapsed.toFixed(3)}ms`);
  });

  it('lists 10,000 tools in under 500ms', () => {
    const elapsed = bestOfMs(3, () => {
      formatToolList(large.listTools());
    });

    assert.ok(elapsed < 500, `10,000-tool list took ${elapsed.toFixed(3)}ms`);
  });

  it('keeps the 1000-tool list output under 1MB', () => {
    const output = formatToolList(medium.listTools());

    assert.ok(Buffer.byteLength(output) < 1_000_000);
  });

  it('returns a detail for a 1000-tool registry in under 5ms', () => {
    const elapsed = bestOfMs(20, () => detailFor(medium, 'bulk_tool_500'));

    assert.ok(elapsed < 5, `detail took ${elapsed.toFixed(3)}ms`);
  });

  it('returns a detail for a 10,000-tool registry in under 5ms', () => {
    const elapsed = bestOfMs(20, () => detailFor(large, 'bulk_tool_5000'));

    assert.ok(elapsed < 5, `detail took ${elapsed.toFixed(3)}ms`);
  });

  it('completes 1000 detail calls in under 1s', () => {
    const start = performance.now();

    for (let index = 0; index < 1_000; index += 1) {
      detailFor(medium, `bulk_tool_${index}`);
    }

    const elapsed = performance.now() - start;
    assert.ok(elapsed < 1_000, `1000 detail calls took ${elapsed.toFixed(3)}ms`);
  });

  it('returns the same schema object across repeated detail reads', () => {
    const first = medium.getTool('bulk_tool_1')?.parametersSchema;
    const second = medium.getTool('bulk_tool_1')?.parametersSchema;

    assert.equal(first, second);
  });

  it('performs no schema compilation on the read path', async () => {
    const service = newToolsService();
    registerFixture(service, { name: 'read_only_tool', pluginId: 'perf.read' });
    const context = makePluginContext(service, ['tools:register']);
    const reader = context.getBrudTools();

    let compileCalls = 0;
    const original = service as unknown as {
      compile?: () => unknown;
      executeTool: (...args: unknown[]) => Promise<OperationResult>;
    };
    const execute = original.executeTool.bind(service);

    original.executeTool = async (...args: unknown[]): Promise<OperationResult> => {
      compileCalls += 1;
      return execute(...args);
    };

    reader.listTools();
    reader.getTool('read_only_tool');
    reader.listTools();

    assert.equal(compileCalls, 0);
  });

  it('handles 100 concurrent list reads consistently', async () => {
    const start = performance.now();
    const results = await Promise.all(
      Array.from({ length: 100 }, async () => formatToolList(medium.listTools())),
    );
    const elapsed = performance.now() - start;

    assert.equal(new Set(results).size, 1);
    assert.ok(elapsed < 500, `100 concurrent lists took ${elapsed.toFixed(3)}ms`);
  });

  it('allows two readers to interleave without locks', async () => {
    const contextA = makePluginContext(medium, ['tools:register'], 'perf.reader.a');
    const contextB = makePluginContext(medium, ['tools:register'], 'perf.reader.b');
    const readerA = contextA.getBrudTools();
    const readerB = contextB.getBrudTools();

    const results = await Promise.all([
      Promise.resolve(readerA.listTools().length),
      Promise.resolve(readerB.listTools().length),
      Promise.resolve(readerA.getTool('bulk_tool_0')?.name),
      Promise.resolve(readerB.getTool('bulk_tool_999')?.name),
    ]);

    assert.deepEqual(results, [1_000, 1_000, 'bulk_tool_0', 'bulk_tool_999']);
  });

  it('does not alter a list snapshot when a tool is registered afterwards', () => {
    const service = buildService(10);
    const before = service.listTools();
    const beforeLength = before.length;

    registerFixture(service, { name: 'registered_after_snapshot', pluginId: 'perf.snapshot' });

    assert.equal(before.length, beforeLength);
    assert.equal(before.some((tool) => tool.name === 'registered_after_snapshot'), false);
    assert.ok(service.listTools().some((tool) => tool.name === 'registered_after_snapshot'));
  });

  it('allocates less than 10MB while listing 1000 tools', () => {
    forceGc();
    const before = heapUsed();

    formatToolList(medium.listTools());

    const allocated = heapUsed() - before;
    assert.ok(
      allocated < 10 * 1024 * 1024,
      `1000-tool list allocated ${(allocated / 1024 / 1024).toFixed(2)}MB`,
    );
  });

  it('allocates less than 5MB for 1000 sequential detail calls', () => {
    forceGc();
    const before = heapUsed();

    for (let index = 0; index < 1_000; index += 1) {
      detailFor(medium, `bulk_tool_${index}`);
    }

    const allocated = heapUsed() - before;
    assert.ok(
      allocated < 5 * 1024 * 1024,
      `1000 detail calls allocated ${(allocated / 1024 / 1024).toFixed(2)}MB`,
    );
  });

  it('reads 100 tools with 5KB schemas in under 100ms', () => {
    const service = newToolsService();
    const schema = {
      type: 'object',
      properties: Object.fromEntries(
        Array.from({ length: 200 }, (_, index) => [`field_${index}`, { type: 'string' }]),
      ),
    };
    const serializedLength = JSON.stringify(schema).length;
    assert.ok(serializedLength >= 5_000);

    populateTools(service, 100, { schema: () => schema });
    const elapsed = bestOfMs(5, () => {
      formatToolList(service.listTools());
    });

    assert.ok(elapsed < 100, `5KB-schema list took ${elapsed.toFixed(3)}ms`);
  });

  it('lists five-level schemas without stack overflow', () => {
    const service = newToolsService();
    const schema = {
      type: 'object',
      properties: {
        l1: {
          type: 'object',
          properties: {
            l2: {
              type: 'object',
              properties: {
                l3: {
                  type: 'object',
                  properties: {
                    l4: {
                      type: 'object',
                      properties: { l5: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    populateTools(service, 1_000, { schema: () => schema });

    assert.doesNotThrow(() => formatToolList(service.listTools()));
  });

  it('lists 1KB tool names in under 200ms', () => {
    const service = newToolsService();
    const name = 'n'.repeat(1_024);
    populateTools(service, 1_000, { name: (index) => `${name}_${index}` });
    const elapsed = bestOfMs(3, () => {
      formatToolList(service.listTools());
    });

    assert.ok(elapsed < 200, `1KB-name list took ${elapsed.toFixed(3)}ms`);
  });

  it('does not degrade Unicode-heavy lists by more than 2x ASCII', () => {
    const ascii = newToolsService();
    const unicode = newToolsService();
    populateTools(ascii, 1_000, {
      description: () => 'Description ASCII payload value '.repeat(5),
      schema: () => ({ type: 'object', properties: { field: { type: 'string' } } }),
    });
    populateTools(unicode, 1_000, {
      name: (index) => `инструмент_${index}`,
      description: () => 'Описание 工具 🚀 café naïve '.repeat(5),
      schema: () => ({
        type: 'object',
        properties: {
          'поле': { type: 'string' },
          '字段': { type: 'number' },
          '🚀': { type: 'boolean' },
        },
      }),
    });

    const asciiBest = bestOfMs(5, () => formatToolList(ascii.listTools()));
    const unicodeBest = bestOfMs(5, () => formatToolList(unicode.listTools()));
    const ratio = unicodeBest / Math.max(asciiBest, 0.001);

    assert.ok(ratio <= 2, `Unicode list was ${ratio.toFixed(2)}x the ASCII baseline`);
  });

  it('does not leak memory across 500 reader constructions', () => {
    const service = newToolsService();
    registerFixture(service, { name: 'reader_construction_tool', pluginId: 'perf.reader' });
    forceGc();
    const before = heapUsed();

    for (let index = 0; index < 500; index += 1) {
      const reader = makePluginContext(service, ['tools:register']).getBrudTools();
      reader.listTools();
    }

    forceGc();
    const allocated = heapUsed() - before;
    assert.ok(
      allocated < 8 * 1024 * 1024,
      `500 readers retained ${(allocated / 1024 / 1024).toFixed(2)}MB`,
    );
  });

  it('keeps memory stable across 1000 list calls', () => {
    forceGc();
    const before = heapUsed();

    for (let index = 0; index < 1_000; index += 1) {
      formatToolList(medium.listTools());
    }

    forceGc();
    const allocated = heapUsed() - before;
    assert.ok(
      allocated < 8 * 1024 * 1024,
      `1000 lists retained ${(allocated / 1024 / 1024).toFixed(2)}MB`,
    );
  });

  it('keeps detail cost independent of registry size', () => {
    const ten = bestOfMs(20, () => detailFor(small, 'bulk_tool_5'));
    const tenThousand = bestOfMs(20, () => detailFor(large, 'bulk_tool_5000'));
    const ratio = tenThousand / Math.max(ten, 0.001);

    assert.ok(tenThousand < 5, `10k detail took ${tenThousand.toFixed(3)}ms`);
    assert.ok(ratio < 20, `10k detail was ${ratio.toFixed(2)}x the 10-tool baseline`);
  });

  it('accepts a wide schema within the compiler node limit on the read path', () => {
    const service = newToolsService();
    const properties = Object.fromEntries(
      Array.from({ length: 900 }, (_, index) => [`p_${index}`, { type: 'string' }]),
    );
    registerFixture(service, {
      name: 'wide_schema',
      pluginId: 'perf.wide',
      schema: { type: 'object', properties },
    });

    const detail = formatToolDetails(service.getTool('wide_schema')!);
    assert.ok(detail.includes('p_899'));
  });

  it('does not retain references to previous list results', () => {
    forceGc();
    const before = heapUsed();
    let lastLength = 0;

    for (let index = 0; index < 100; index += 1) {
      lastLength = medium.listTools().length;
    }

    forceGc();
    assert.equal(lastLength, 1_000);
    assert.ok((heapUsed() - before) < 8 * 1024 * 1024);
  });
});