import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IBrudToolsService, OperationResult } from '@brud/kernel';
import {
  bootCatalogKernel,
  callCatalog,
  deferred,
  fdCount,
  forceGc,
  heapUsed,
  makeFailingActivationPlugin,
  makeToolPlugin,
  newToolsService,
  populateTools,
  registerFixture,
} from './catalog-test-helpers.js';
import { formatToolDetails, formatToolList } from '../plugin.js';

const EXECUTE = async (): Promise<OperationResult> => ({ status: 'success' });

function registerMany(
  service: IBrudToolsService,
  count: number,
  pluginId = 'scale.owner',
): void {
  for (let index = 0; index < count; index += 1) {
    service.registerTool(pluginId, false, {
      name: `scale_tool_${index}`,
      description: `Scale tool ${index}`,
      parametersSchema: { type: 'object', properties: {} },
      execute: EXECUTE,
    });
  }
}

describe('Catalog scalability', () => {
  it('lists 1000 tools with no crash and bounded output', () => {
    const service = newToolsService();
    populateTools(service, 1_000);
    const output = formatToolList(service.listTools());

    assert.equal(service.listTools().length, 1_000);
    assert.ok(Buffer.byteLength(output) < 1_000_000);
  });

  it('lists 10,000 tools without pagination and with bounded output', () => {
    const service = newToolsService();
    populateTools(service, 10_000);
    const start = performance.now();
    const output = formatToolList(service.listTools());
    const elapsed = performance.now() - start;

    assert.equal(service.listTools().length, 10_000);
    assert.ok(elapsed < 2_000, `10,000-tool list took ${elapsed.toFixed(3)}ms`);
    assert.ok(Buffer.byteLength(output) < 2_000_000);
    assert.equal((output.match(/^- bulk_tool_\d+:/gmu) ?? []).length, 10_000);
  });

  it('registers 10,000 tools within a bounded time', () => {
    const service = newToolsService();
    const start = performance.now();
    populateTools(service, 10_000);
    const elapsed = performance.now() - start;

    assert.equal(service.listTools().length, 10_000);
    assert.ok(elapsed < 2_000, `10,000 registrations took ${elapsed.toFixed(3)}ms`);
  });

  it('returns a detail from a 10,000-tool registry in under 5ms', () => {
    const service = newToolsService();
    populateTools(service, 10_000);
    const start = performance.now();
    const detail = formatToolDetails(service.getTool('bulk_tool_5000')!);
    const elapsed = performance.now() - start;

    assert.ok(detail.includes(`Tool: bulk_tool_5000`));
    assert.ok(elapsed < 5, `10,000-tool detail took ${elapsed.toFixed(3)}ms`);
  });

  it('survives 100 concurrent registrations and list calls without corruption', async () => {
    const service = newToolsService();
    registerMany(service, 10, 'scale.base');

    await Promise.all(
      Array.from({ length: 100 }, async (_, index) => {
        registerFixture(service, { name: `concurrent_reg_${index}`, pluginId: 'scale.concurrent' });
        formatToolList(service.listTools());
      }),
    );

    assert.equal(service.listTools().length, 110);
    assert.equal(new Set(service.listTools().map((tool) => tool.name)).size, 110);
  });

  it('survives 100 concurrent deregistrations and list calls without corruption', async () => {
    const service = newToolsService();
    const disposables = Array.from({ length: 100 }, (_, index) =>
      registerFixture(service, { name: `concurrent_dereg_${index}`, pluginId: 'scale.concurrent' }),
    );

    await Promise.all(
      disposables.map(async (disposable) => {
        disposable.dispose();
        formatToolList(service.listTools());
      }),
    );

    assert.equal(service.listTools().length, 0);
  });

  it('keeps two kernels with 500 tools each independent', async () => {
    const first = await bootCatalogKernel();
    const second = await bootCatalogKernel();

    try {
      populateTools(first.tools, 500);
      populateTools(second.tools, 500, {
        name: (index) => `second_tool_${index}`,
      });

      const firstList = await callCatalog(first.tools, first.root, {});
      const secondList = await callCatalog(second.tools, second.root, {});
      const firstNames = (firstList.data as { tools: { name: string }[] }).tools.map((tool) => tool.name);
      const secondNames = (secondList.data as { tools: { name: string }[] }).tools.map((tool) => tool.name);

      assert.equal(firstNames.length, 501);
      assert.equal(secondNames.length, 501);
      assert.ok(firstNames.includes('bulk_tool_0'));
      assert.ok(!firstNames.includes('second_tool_0'));
      assert.ok(secondNames.includes('second_tool_0'));
      assert.ok(!secondNames.includes('bulk_tool_0'));
    } finally {
      await first.cleanup();
      await second.cleanup();
    }
  });

  it('keeps the registry consistent across 100 activation and deactivation cycles', async () => {
    const context = await bootCatalogKernel();
    const pluginId = 'scale.cycle.plugin';
    const plugin = makeToolPlugin(pluginId, [{ name: 'cycle_tool' }]);

    try {
      context.manager.register(plugin);

      for (let cycle = 0; cycle < 100; cycle += 1) {
        await context.manager.activatePlugin(pluginId);
        assert.ok(context.tools.listTools().some((tool) => tool.name === 'cycle_tool'));

        await context.manager.deactivatePlugin(pluginId);
        assert.equal(context.tools.listTools().some((tool) => tool.name === 'cycle_tool'), false);
      }

      assert.deepEqual(context.tools.listTools().map((tool) => tool.name), ['get_tool_info']);
    } finally {
      await context.cleanup();
    }
  });

  it('survives a 50-plugin activation and deactivation storm without leaking file handles', async () => {
    const context = await bootCatalogKernel();
    const beforeFds = fdCount();

    try {
      for (let index = 0; index < 50; index += 1) {
        context.manager.register(
          makeToolPlugin(`storm.plugin.${index}`, [{ name: `storm_tool_${index}` }]),
        );
      }

      for (let index = 0; index < 50; index += 1) {
        await context.manager.activatePlugin(`storm.plugin.${index}`);
      }

      assert.equal(context.tools.listTools().length, 51);

      for (let index = 0; index < 50; index += 1) {
        await context.manager.deactivatePlugin(`storm.plugin.${index}`);
      }

      assert.deepEqual(context.tools.listTools().map((tool) => tool.name), ['get_tool_info']);

      const afterFds = fdCount();

      if (beforeFds !== undefined && afterFds !== undefined) {
        assert.ok(
          afterFds <= beforeFds + 16,
          `file descriptors grew from ${beforeFds} to ${afterFds}`,
        );
      }
    } finally {
      await context.cleanup();
    }
  });

  it('keeps memory stable across 1000 list calls', () => {
    const service = newToolsService();
    populateTools(service, 1_000);
    forceGc();
    const before = heapUsed();

    for (let index = 0; index < 1_000; index += 1) {
      formatToolList(service.listTools());
    }

    forceGc();
    const retained = heapUsed() - before;
    assert.ok(retained < 8 * 1024 * 1024, `retained ${(retained / 1024 / 1024).toFixed(2)}MB`);
  });

  it('returns TOOL_NOT_FOUND after a plugin deactivates', async () => {
    const context = await bootCatalogKernel();
    const pluginId = 'scale.deactivated.plugin';

    try {
      context.manager.register(makeToolPlugin(pluginId, [{ name: 'deactivated_tool' }]));
      await context.manager.activatePlugin(pluginId);
      await context.manager.deactivatePlugin(pluginId);

      const result = await callCatalog(context.tools, context.root, { tool: 'deactivated_tool' });

      assert.equal(result.status, 'failed');
      assert.equal((result.data as { code: string }).code, 'TOOL_NOT_FOUND');
    } finally {
      await context.cleanup();
    }
  });

  it('returns either a complete tool or TOOL_NOT_FOUND during deactivation', async () => {
    const context = await bootCatalogKernel();
    const pluginId = 'scale.deactivating.plugin';
    const gate = deferred();

    try {
      context.manager.register(
        makeToolPlugin(pluginId, [{ name: 'deactivating_tool' }], {
          onDeactivate: () => gate.promise,
        }),
      );
      await context.manager.activatePlugin(pluginId);

      const deactivation = context.manager.deactivatePlugin(pluginId);
      assert.equal(context.manager.getPlugin(pluginId)?.state, 'deactivating');

      const during = await callCatalog(context.tools, context.root, { tool: 'deactivating_tool' });
      assert.equal(during.status, 'success');
      assert.equal((during.data as { name: string }).name, 'deactivating_tool');

      gate.resolve();
      await deactivation;

      const after = await callCatalog(context.tools, context.root, { tool: 'deactivating_tool' });
      assert.equal(after.status, 'failed');
      assert.equal((after.data as { code: string }).code, 'TOOL_NOT_FOUND');
    } finally {
      gate.resolve();
      await context.cleanup();
    }
  });

  it('details a wide schema within the compiler node limit without stack overflow', () => {
    const service = newToolsService();
    const properties = Object.fromEntries(
      Array.from({ length: 900 }, (_, index) => [`property_${index}`, { type: 'string' }]),
    );
    registerFixture(service, {
      name: 'wide_property_tool',
      pluginId: 'scale.schema',
      schema: { type: 'object', properties },
    });

    const detail = formatToolDetails(service.getTool('wide_property_tool')!);
    assert.ok(detail.includes('property_899'));
  });

  it('rejects a deeply recursive $ref schema at registration (required invariant)', () => {
    const service = newToolsService();
    const schema: Record<string, unknown> = {
      type: 'object',
      properties: {
        node: { $ref: '#/properties/node' },
      },
    };

    assert.throws(
      () => registerFixture(service, {
        name: 'recursive_ref_tool',
        pluginId: 'scale.schema',
        schema,
      }),
      /SCHEMA_REF_UNRESOLVED/u,
    );
    assert.equal(service.getTool('recursive_ref_tool'), undefined);
  });

  it('does not leave a recursive $ref tool visible in the catalog after rejection', async () => {
    const service = newToolsService();
    const schema: Record<string, unknown> = {
      type: 'object',
      properties: {
        node: { $ref: '#/properties/node' },
      },
    };

    assert.throws(
      () => registerFixture(service, {
        name: 'recursive_ref_tool',
        pluginId: 'scale.schema',
        schema,
      }),
      /SCHEMA_REF_UNRESOLVED/u,
    );

    const result = await service.executeTool(
      'recursive_ref_tool',
      { node: {} },
      { workspaceRoot: '/workspace', callerId: 'scale' },
    );

    assert.equal(result.status, 'failed');
    assert.match(String(result.error), /TOOL_NOT_FOUND/u);
  });

  it('enforces the 100-tool per-plugin quota', () => {
    const service = newToolsService();
    registerMany(service, 100, 'scale.quota.owner');

    assert.throws(
      () => registerMany(service, 1, 'scale.quota.owner'),
      /exceeded the tool registration quota/u,
    );
    assert.equal(service.listTools().length, 100);
  });

  it('lists 1000 tools registered through ten plugins', () => {
    const service = newToolsService();
    populateTools(service, 1_000);
    const start = performance.now();
    const output = formatToolList(service.listTools());
    const elapsed = performance.now() - start;

    assert.equal(service.listTools().length, 1_000);
    assert.ok(elapsed < 200, `1000-tool list took ${elapsed.toFixed(3)}ms`);
    assert.equal((output.match(/^- bulk_tool_\d+:/gmu) ?? []).length, 1_000);
  });

  it('leaves the registry unaffected when a plugin crashes during activation', async () => {
    const context = await bootCatalogKernel();

    try {
      registerFixture(context.tools, { name: 'activation_survivor', pluginId: 'scale.survivor' });
      context.manager.register(
        makeFailingActivationPlugin('scale.crash.plugin', [{ name: 'crash_tool' }]),
      );

      await assert.rejects(context.manager.activatePlugin('scale.crash.plugin'));
      assert.equal(context.manager.getPlugin('scale.crash.plugin')?.state, 'failed');
      assert.equal(context.tools.getTool('crash_tool'), undefined);
      assert.ok(context.tools.getTool('activation_survivor') !== undefined);

      const result = await callCatalog(context.tools, context.root, {});
      assert.equal(result.status, 'success');
    } finally {
      await context.cleanup();
    }
  });

  it('does not list tools from a registered but inactive plugin', async () => {
    const context = await bootCatalogKernel();
    const pluginId = 'scale.inactive.plugin';

    try {
      context.manager.register(makeToolPlugin(pluginId, [{ name: 'inactive_tool' }]));
      assert.equal(context.tools.getTool('inactive_tool'), undefined);

      await context.manager.activatePlugin(pluginId);
      assert.ok(context.tools.getTool('inactive_tool') !== undefined);
    } finally {
      await context.cleanup();
    }
  });

  it('keeps cross-kernel isolation under concurrent load', async () => {
    const first = await bootCatalogKernel();
    const second = await bootCatalogKernel();

    try {
      populateTools(first.tools, 500);
      populateTools(second.tools, 500, { name: (index) => `second_tool_${index}` });

      const results = await Promise.all(
        Array.from({ length: 50 }, async (_, index) => {
          const target = index % 2 === 0 ? first : second;
          const result = await callCatalog(target.tools, target.root, {});
          const names = (result.data as { tools: { name: string }[] }).tools.map((tool) => tool.name);

          return { target, names };
        }),
      );

      for (const { target, names } of results) {
        assert.equal(names.length, 501);

        if (target === first) {
          assert.ok(names.includes('bulk_tool_0'));
          assert.ok(!names.includes('second_tool_0'));
        } else {
          assert.ok(names.includes('second_tool_0'));
          assert.ok(!names.includes('bulk_tool_0'));
        }
      }
    } finally {
      await first.cleanup();
      await second.cleanup();
    }
  });

  it('does not leak file handles across repeated kernel boots', async () => {
    const beforeFds = fdCount();

    for (let index = 0; index < 5; index += 1) {
      const context = await bootCatalogKernel();
      await context.cleanup();
    }

    const afterFds = fdCount();

    if (beforeFds !== undefined && afterFds !== undefined) {
      assert.ok(
        afterFds <= beforeFds + 16,
        `file descriptors grew from ${beforeFds} to ${afterFds}`,
      );
    }
  });
});