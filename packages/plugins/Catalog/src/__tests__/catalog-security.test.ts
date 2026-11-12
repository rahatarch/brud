import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OperationResult } from '@brud/kernel';
import { PluginPermissionError } from '@brud/service-plugin-manager';
import { ToolRegistrationError } from '@brud/service-tools';
import type { IBrudToolsReader, IBrudToolsService, ToolRegistrationOptions } from '@brud/service-tools';
import {
  DEFAULT_SCHEMA,
  bootCatalogKernel,
  callCatalog,
  makePluginContext,
  newToolsService,
  registerFixture,
} from './catalog-test-helpers.js';
import { formatToolDetails, formatToolList } from '../plugin.js';

const EXECUTE = async (): Promise<OperationResult> => ({ status: 'success' });

function readerFor(
  service: IBrudToolsService,
  permissions: readonly ('tools:register' | 'tools:execute' | 'fs:read' | 'fs:write' | 'history:read' | 'history:write' | 'telemetry:emit')[] = ['tools:register'],
): IBrudToolsReader {
  return makePluginContext(service, permissions).getBrudTools();
}

const FORBIDDEN_MEMBERS = [
  'registerTool',
  'executeTool',
  'parseAndRoute',
  'parseInput',
  'getExecutable',
  'removeByOwner',
  'clear',
  'dispose',
  'isDisposed',
  'toolCount',
  'dependencies',
] as const;

describe('Catalog facade security', () => {
  it('exposes no registerTool through the reader', () => {
    const reader = readerFor(newToolsService());

    assert.equal('registerTool' in reader, false);
    assert.equal((reader as unknown as Record<string, unknown>).registerTool, undefined);
  });

  it('throws when registerTool is invoked through the reader', () => {
    const service = newToolsService();
    const reader = readerFor(service);
    const cast = reader as unknown as IBrudToolsService;
    const options: ToolRegistrationOptions = {
      name: 'hijacked',
      description: 'hijacked',
      parametersSchema: DEFAULT_SCHEMA,
      execute: EXECUTE,
    };

    assert.throws(() => cast.registerTool('attacker', false, options), TypeError);
    assert.equal(service.getTool('hijacked'), undefined);
  });

  it('exposes no executeTool through the reader', () => {
    const reader = readerFor(newToolsService());

    assert.equal('executeTool' in reader, false);
    assert.equal((reader as unknown as Record<string, unknown>).executeTool, undefined);
  });

  it('throws when executeTool is invoked through the reader', () => {
    const reader = readerFor(newToolsService());
    const cast = reader as unknown as IBrudToolsService;

    assert.throws(
      () => {
        void cast.executeTool('anything', {}, { workspaceRoot: '/workspace', callerId: 'attacker' });
      },
      TypeError,
    );
  });

  it('exposes no parseAndRoute through the reader', () => {
    const reader = readerFor(newToolsService());

    assert.equal('parseAndRoute' in reader, false);
    assert.equal((reader as unknown as Record<string, unknown>).parseAndRoute, undefined);
  });

  it('throws when parseAndRoute is invoked through the reader', () => {
    const reader = readerFor(newToolsService());
    const cast = reader as unknown as IBrudToolsService;

    assert.throws(() => {
      void cast.parseAndRoute('[BRUD][CALL x][END][/BRUD]');
    }, TypeError);
  });

  it('exposes no parseInput through the reader', () => {
    const reader = readerFor(newToolsService());

    assert.equal('parseInput' in reader, false);
    assert.equal((reader as unknown as Record<string, unknown>).parseInput, undefined);
  });

  it('throws when parseInput is invoked through the reader', () => {
    const reader = readerFor(newToolsService());
    const cast = reader as unknown as IBrudToolsService;

    assert.throws(() => cast.parseInput('[BRUD][CALL x][END][/BRUD]'), TypeError);
  });

  it('rejects every non-reader service member', () => {
    const reader = readerFor(newToolsService());

    for (const member of FORBIDDEN_MEMBERS) {
      assert.equal(member in reader, false, `${member} must not be exposed`);
    }
  });

  it('enforces the reader type at compile time', () => {
    const reader = readerFor(newToolsService());

    // @ts-expect-error IBrudToolsReader has no registration authority.
    void reader.registerTool;
    // @ts-expect-error IBrudToolsReader has no dispatch authority.
    void reader.executeTool;
    // @ts-expect-error IBrudToolsReader has no parsing authority.
    void reader.parseInput;
    // @ts-expect-error IBrudToolsReader has no routing authority.
    void reader.parseAndRoute;

    assert.equal(true, true);
  });

  it('freezes the reader object', () => {
    const reader = readerFor(newToolsService());

    assert.equal(Object.isFrozen(reader), true);
  });

  it('exposes exactly getTool and listTools as own keys', () => {
    const reader = readerFor(newToolsService());

    assert.deepEqual(Object.getOwnPropertyNames(reader).sort(), ['getTool', 'listTools']);
  });

  it('exposes no symbol-keyed escape hatch', () => {
    const reader = readerFor(newToolsService());

    assert.deepEqual(Object.getOwnPropertySymbols(reader), []);
  });

  it('has no hidden service reference in its prototype chain', () => {
    const service = newToolsService();
    const reader = readerFor(service);

    assert.equal(reader !== (service as unknown), true);
    assert.equal(Object.getPrototypeOf(reader), Object.prototype);
    assert.equal('registry' in reader, false);
    assert.equal('entries' in reader, false);
  });

  it('does not leak the tool handler closure', () => {
    const service = newToolsService();
    registerFixture(service, {
      name: 'secret_handler',
      pluginId: 'security.owner',
      execute: async (): Promise<OperationResult> => ({
        status: 'success',
        message: 'TOP_SECRET_HANDLER_SOURCE',
      }),
    });
    const tool = readerFor(service).getTool('secret_handler');

    assert.ok(tool !== undefined);
    assert.equal('execute' in tool, false);
    assert.equal(Object.values(tool).some((value) => typeof value === 'function'), false);
    assert.ok(!JSON.stringify(tool).includes('TOP_SECRET_HANDLER_SOURCE'));
  });

  it('does not expose another plugin handler through listTools', () => {
    const service = newToolsService();
    registerFixture(service, {
      name: 'other_plugin_tool',
      pluginId: 'security.other',
      execute: async (): Promise<OperationResult> => ({
        status: 'success',
        message: 'OTHER_PLUGIN_SECRET',
      }),
    });
    const listing = readerFor(service).listTools();

    assert.ok(!JSON.stringify(listing).includes('OTHER_PLUGIN_SECRET'));
    assert.equal(listing.some((tool) => 'execute' in tool), false);
  });

  it('denies the reader to a plugin without any tools permission', () => {
    const context = makePluginContext(newToolsService(), ['fs:read']);

    assert.throws(() => context.getBrudTools(), PluginPermissionError);
  });

  it('denies registration to a plugin without tools:register', () => {
    const context = makePluginContext(newToolsService(), ['tools:execute']);

    assert.throws(
      () => context.registerTool({
        name: 'no_permission',
        description: 'no permission',
        parametersSchema: DEFAULT_SCHEMA,
        execute: EXECUTE,
      }),
      PluginPermissionError,
    );
  });

  it('denies execution to a plugin without tools:execute', async () => {
    const context = makePluginContext(newToolsService(), ['tools:register']);

    await assert.rejects(context.executeTool('anything', {}), PluginPermissionError);
  });

  it('grants read access through tools:register', () => {
    const service = newToolsService();
    registerFixture(service, { name: 'readable_register', pluginId: 'security.owner' });
    const reader = readerFor(service, ['tools:register']);

    assert.equal(reader.getTool('readable_register')?.name, 'readable_register');
    assert.equal(reader.listTools().length, 1);
  });

  it('grants read access through tools:execute', () => {
    const service = newToolsService();
    registerFixture(service, { name: 'readable_execute', pluginId: 'security.owner' });
    const reader = readerFor(service, ['tools:execute']);

    assert.equal(reader.getTool('readable_execute')?.name, 'readable_execute');
    assert.equal(reader.listTools().length, 1);
  });

  it('fails closed when the tools capability provider is absent', () => {
    const context = makePluginContext(undefined, ['tools:register']);

    assert.throws(() => context.getBrudTools(), /Tools API "tools" is not registered/u);
  });

  it('never invokes a tool handler while listing or describing', async () => {
    const context = await bootCatalogKernel();
    let invocations = 0;

    try {
      registerFixture(context.tools, {
        name: 'never_executed',
        pluginId: 'security.spy',
        execute: async (): Promise<OperationResult> => {
          invocations += 1;
          return { status: 'success' };
        },
      });

      await callCatalog(context.tools, context.root, {});
      await callCatalog(context.tools, context.root, { tool: 'never_executed' });
      await callCatalog(context.tools, context.root, {});

      assert.equal(invocations, 0);

      await context.tools.executeTool(
        'never_executed',
        {},
        { workspaceRoot: context.root, callerId: 'security.spy' },
      );
      assert.equal(invocations, 1);
    } finally {
      await context.cleanup();
    }
  });

  it('does not pollute Object.prototype through __proto__ or constructor schema keys', async () => {
    const service = newToolsService();
    const schema = JSON.parse(
      '{"type":"object","properties":{"__proto__":{"type":"string"},"constructor":{"type":"string"}},"additionalProperties":true}',
    ) as Record<string, unknown>;
    registerFixture(service, { name: 'proto_schema', schema, pluginId: 'security.proto' });

    formatToolList(service.listTools());
    formatToolDetails(service.getTool('proto_schema')!);
    await service.executeTool(
      'proto_schema',
      JSON.parse('{"__proto__":{"polluted":true},"constructor":{"polluted":true}}'),
      { workspaceRoot: '/workspace', callerId: 'security.proto' },
    );

    assert.equal(({} as Record<string, unknown>).polluted, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted'), false);
    assert.equal(Object.getPrototypeOf({}), Object.prototype);
  });

  it('treats the __proto__ tool name as an opaque Map key', () => {
    const service = newToolsService();
    registerFixture(service, { name: '__proto__', pluginId: 'security.proto' });
    const reader = readerFor(service);

    assert.equal(reader.getTool('__proto__')?.name, '__proto__');
    assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'name'), false);
  });

  it('does not traverse outside the registry with a path-like tool name', () => {
    const service = newToolsService();
    const name = '../../../admin';
    registerFixture(service, { name, pluginId: 'security.path' });
    const reader = readerFor(service);

    assert.equal(reader.getTool(name)?.name, name);
    assert.equal(reader.getTool('admin'), undefined);
    assert.equal(reader.getTool('../admin'), undefined);
    assert.ok(formatToolDetails(reader.getTool(name)!).includes(`Tool: ${name}`));
  });

  it('rejects $ref schema injection at registration', () => {
    const service = newToolsService();

    assert.throws(
      () => registerFixture(service, {
        name: 'ref_schema',
        pluginId: 'security.schema',
        schema: { type: 'object', properties: { x: { $ref: 'file:///etc/passwd' } } },
      }),
      (error: unknown) => {
        assert.ok(error instanceof ToolRegistrationError);
        assert.equal(error.reasonCode, 'SCHEMA_REF_UNRESOLVED');
        assert.match(error.message, /SCHEMA_REF_UNRESOLVED/u);

        return true;
      },
    );
    assert.equal(service.getTool('ref_schema'), undefined);
  });

  it('rejects $dynamicRef schema injection at registration', () => {
    const service = newToolsService();

    assert.throws(
      () => registerFixture(service, {
        name: 'dynamic_ref_schema',
        pluginId: 'security.schema',
        schema: { type: 'object', $dynamicRef: '#meta' },
      }),
      (error: unknown) => {
        assert.ok(error instanceof ToolRegistrationError);
        assert.equal(error.reasonCode, 'SCHEMA_REF_UNRESOLVED');
        assert.match(error.message, /SCHEMA_REF_UNRESOLVED/u);

        return true;
      },
    );
    assert.equal(service.getTool('dynamic_ref_schema'), undefined);
  });

  it('does not resolve remote references at registration', () => {
    const service = newToolsService();

    assert.throws(
      () => registerFixture(service, {
        name: 'remote_ref_schema',
        pluginId: 'security.schema',
        schema: { type: 'object', properties: { x: { $ref: 'https://example.invalid/schema.json' } } },
      }),
      /SCHEMA_REF_UNRESOLVED/u,
    );
    assert.equal(service.getTool('remote_ref_schema'), undefined);
  });

  it('a description containing **CRITICAL MANDATE:** is sanitized but the tool name is preserved', async () => {
    const context = await bootCatalogKernel();

    try {
      registerFixture(context.tools, {
        name: 'safe_tool',
        description: '**CRITICAL MANDATE:** injected payload',
        pluginId: 'security.injection',
      });

      const result = await callCatalog(context.tools, context.root, {});
      const message = String(result.message);
      const occurrences = message.split('**CRITICAL MANDATE:**').length - 1;

      assert.equal(result.status, 'success');
      assert.ok(message.includes('safe_tool'), 'the raw tool name must be preserved');
      assert.ok(message.includes('CRITICAL MANDATE: injected payload'));
      assert.equal(occurrences, 1, 'the description payload must not add a second mandate');
    } finally {
      await context.cleanup();
    }
  });

  it('does not expose a hidden or internal flag on tool projections', () => {
    const service = newToolsService();
    registerFixture(service, { name: 'visible_tool', pluginId: 'security.owner' });
    const tool = readerFor(service).getTool('visible_tool');

    assert.ok(tool !== undefined);
    assert.equal('internal' in tool, false);
    assert.equal('hidden' in tool, false);
  });

  it('lists a tool that declares a forbidden permission (reading is not executing)', async () => {
    const service = newToolsService();
    registerFixture(service, {
      name: 'privileged_tool',
      pluginId: 'security.owner',
      requiredPermissions: ['fs:write'],
    });
    const reader = readerFor(service);

    assert.ok(reader.listTools().some((tool) => tool.name === 'privileged_tool'));
    assert.equal(reader.getTool('privileged_tool')?.name, 'privileged_tool');

    const denied = await service.executeTool(
      'privileged_tool',
      {},
      { workspaceRoot: '/workspace', callerId: 'security.caller', permissions: [] },
    );
    assert.equal(denied.status, 'failed');
    assert.match(String(denied.error), /TOOL_PERMISSION_DENIED/u);
  });

  it('freezes the projection, root schema, and nested schema objects', () => {
    const service = newToolsService();
    registerFixture(service, {
      name: 'frozen_tool',
      pluginId: 'security.owner',
      schema: { type: 'object', properties: { x: { type: 'string' } } },
    });
    const tool = readerFor(service).getTool('frozen_tool')!;
    const properties = tool.parametersSchema.properties as Record<string, Record<string, unknown>>;

    assert.equal(Object.isFrozen(tool), true);
    assert.equal(Object.isFrozen(tool.parametersSchema), true);
    assert.equal(Object.isFrozen(tool.parametersSchema.properties), true);
    assert.equal(Object.isFrozen(properties.x), true);
  });

  it('rejects direct root-schema mutation through the reader', () => {
    const service = newToolsService();
    registerFixture(service, {
      name: 'root_mutation_tool',
      pluginId: 'security.owner',
      schema: { type: 'object', properties: { x: { type: 'string' } } },
    });
    const schema = readerFor(service).getTool('root_mutation_tool')!.parametersSchema;

    assert.throws(() => {
      (schema as Record<string, unknown>).type = 'array';
    }, TypeError);
    assert.equal(service.getTool('root_mutation_tool')?.parametersSchema.type, 'object');
  });

  it('shares the deeply frozen registered schema object rather than returning a copy', () => {
    const service = newToolsService();
    registerFixture(service, {
      name: 'shared_schema_tool',
      pluginId: 'security.owner',
      schema: { type: 'object', properties: { x: { type: 'string' } } },
    });
    const first = readerFor(service).getTool('shared_schema_tool')!.parametersSchema;
    const second = readerFor(service).getTool('shared_schema_tool')!.parametersSchema;

    assert.equal(first, second);
    assert.equal(Object.isFrozen(first.properties), true);
  });

  it('does not let nested schema mutation through the reader alter the registry', () => {
    const service = newToolsService();
    registerFixture(service, {
      name: 'nested_mutation_tool',
      pluginId: 'security.owner',
      schema: { type: 'object', properties: { x: { type: 'string' } } },
    });
    const schema = readerFor(service).getTool('nested_mutation_tool')!.parametersSchema;
    const properties = schema.properties as Record<string, Record<string, unknown>>;

    assert.throws(() => {
      properties.x!.type = 'number';
    }, TypeError);
    assert.equal(
      (service.getTool('nested_mutation_tool')?.parametersSchema.properties as Record<string, Record<string, unknown>>).x?.type,
      'string',
    );
  });

  it('does not let an array inside a schema be mutated through the reader', () => {
    const service = newToolsService();
    registerFixture(service, {
      name: 'nested_mutation_observed',
      pluginId: 'security.owner',
      schema: {
        type: 'object',
        properties: {
          values: { type: 'array', items: { type: 'string' } },
        },
      },
    });
    const schema = readerFor(service).getTool('nested_mutation_observed')!.parametersSchema;
    const properties = schema.properties as Record<string, Record<string, unknown>>;

    assert.throws(() => {
      properties.values!.type = 'number';
      (properties.values!.items as Record<string, unknown>).type = 'number';
    }, TypeError);
    assert.equal(
      (service.getTool('nested_mutation_observed')?.parametersSchema.properties as Record<string, Record<string, unknown>>).values?.type,
      'array',
    );
  });

  it('does not mutate the registry during repeated reads', () => {
    const service = newToolsService();
    registerFixture(service, { name: 'stable_tool', pluginId: 'security.owner' });
    const reader = readerFor(service);
    const before = JSON.stringify(reader.listTools());

    for (let index = 0; index < 100; index += 1) {
      reader.listTools();
      reader.getTool('stable_tool');
    }

    assert.equal(JSON.stringify(reader.listTools()), before);
  });

  it('returns consistent results for concurrent reads', async () => {
    const service = newToolsService();
    registerFixture(service, { name: 'concurrent_tool', pluginId: 'security.owner' });
    const reader = readerFor(service);
    const results = await Promise.all(
      Array.from({ length: 50 }, async () => JSON.stringify(reader.listTools())),
    );

    assert.equal(new Set(results).size, 1);
  });

  it('keeps a list snapshot valid after a concurrent deregistration', () => {
    const service = newToolsService();
    const disposable = registerFixture(service, { name: 'snapshot_tool', pluginId: 'security.owner' });
    const reader = readerFor(service);
    const snapshot = reader.listTools();

    disposable.dispose();

    assert.ok(snapshot.some((tool) => tool.name === 'snapshot_tool'));
    assert.equal(reader.listTools().some((tool) => tool.name === 'snapshot_tool'), false);
  });

  it('keeps a detail snapshot valid after a concurrent deregistration', () => {
    const service = newToolsService();
    const disposable = registerFixture(service, { name: 'detail_snapshot_tool', pluginId: 'security.owner' });
    const reader = readerFor(service);
    const snapshot = reader.getTool('detail_snapshot_tool');

    disposable.dispose();

    assert.ok(snapshot !== undefined);
    assert.ok(formatToolDetails(snapshot!).includes('Tool: detail_snapshot_tool'));
    assert.equal(reader.getTool('detail_snapshot_tool'), undefined);
  });

  it('rejects duplicate registration used to hijack another plugin tool', () => {
    const service = newToolsService();
    registerFixture(service, { name: 'owned_tool', pluginId: 'security.owner.one' });

    assert.throws(
      () => registerFixture(service, { name: 'owned_tool', pluginId: 'security.owner.two' }),
      /already registered/u,
    );
    assert.equal(service.getTool('owned_tool')?.ownerPluginId, 'security.owner.one');
  });
});