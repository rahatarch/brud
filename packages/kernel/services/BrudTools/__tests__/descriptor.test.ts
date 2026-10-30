import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createStandardKernel } from '../../../src/bootstrap/createKernel.js';
import type { OperationResult } from '../../../src/contracts/handler.js';
import type { ServiceContext } from '../../../src/contracts/lifecycle.js';
import { InMemoryStorageDriver } from '../../../drivers/memory/index.js';
import { ValidationToken } from '../../ValidationService/descriptor/tokens.js';
import type { IBrudToolsService, ToolRegistrationOptions } from '../contracts/IBrudToolsService.js';
import {
  BRUD_TOOLS_SERVICE_TIER,
  createBrudToolsDescriptor,
} from '../descriptor/BrudToolsDescriptor.js';
import { BrudToolsToken } from '../descriptor/tokens.js';

const CALLER: ServiceContext = { callerId: 'test', tier: 'core', workspaceRoot: '/workspace' };

function tool(name: string, schema = 'object'): ToolRegistrationOptions {
  return {
    name,
    description: `${name} description`,
    parametersSchema: { type: 'object', title: schema },
    execute: async (input): Promise<OperationResult> => ({ status: 'success', data: input }),
  };
}

describe('BrudTools descriptor', () => {
  it('uses the brud.core.tools token id', () => {
    assert.strictEqual(BrudToolsToken.id, 'brud.core.tools');
  });

  it('declares the validation dependency and core tier', () => {
    const descriptor = createBrudToolsDescriptor();

    assert.strictEqual(descriptor.token, BrudToolsToken);
    assert.strictEqual(descriptor.tier, BRUD_TOOLS_SERVICE_TIER);
    assert.strictEqual(descriptor.tier, 'core');
    assert.ok(descriptor.dependencies.includes(ValidationToken));
    assert.deepStrictEqual(descriptor.accessPolicy, { deniedCallers: [] });
  });

  it('boots after validation and resolves through the kernel', async () => {
    const kernel = createStandardKernel({
      storageDriver: new InMemoryStorageDriver(),
      history: { inMemory: true },
    });

    await kernel.boot({ workspaceRoot: '/workspace' });

    const tools = kernel.requestAccess<IBrudToolsService>(CALLER, BrudToolsToken);

    assert.deepStrictEqual(tools.listTools(), []);

    const disposable = tools.registerTool('brud.a', true, tool('read_file', 'read_file'));
    const result = await tools.executeTool('read_file', { index: '1', path: 'a.ts' }, {
      workspaceRoot: '/workspace',
      callerId: 'test',
    });

    assert.strictEqual(result.status, 'success');
    assert.deepStrictEqual(result.data, { index: '1', path: 'a.ts' });

    await disposable.dispose();
    assert.strictEqual(tools.getTool('read_file'), undefined);

    await kernel.shutdown();
  });

  it('admits a non-frozen tool name through the standard kernel gate', async () => {
    const kernel = createStandardKernel({
      storageDriver: new InMemoryStorageDriver(),
      history: { inMemory: true },
    });

    await kernel.boot({ workspaceRoot: '/workspace' });

    const tools = kernel.requestAccess<IBrudToolsService>(CALLER, BrudToolsToken);
    const disposable = tools.registerTool('brud.a', true, tool('synthetic_probe_tool'));
    const result = await tools.executeTool('synthetic_probe_tool', { value: 'hello' }, {
      workspaceRoot: '/workspace',
      callerId: 'test',
    });

    assert.strictEqual(result.status, 'success');
    assert.deepStrictEqual(result.data, { value: 'hello' });

    await disposable.dispose();
    await kernel.shutdown();
  });

  it('rejects a payload the boot validation policy refuses', async () => {    const kernel = createStandardKernel({
      storageDriver: new InMemoryStorageDriver(),
      history: { inMemory: true },
    });

    await kernel.boot({ workspaceRoot: '/workspace' });

    const tools = kernel.requestAccess<IBrudToolsService>(CALLER, BrudToolsToken);
    tools.registerTool('brud.a', true, tool('read_file', 'read_file'));
    const result = await tools.executeTool('read_file', { path: 'a.ts' }, {
      workspaceRoot: '/workspace',
      callerId: 'test',
    });

    assert.strictEqual(result.status, 'failed');
    assert.match(String(result.error), /^TOOL_VALIDATION_ERROR: /);

    await kernel.shutdown();
  });

  it('reports TOOL_NOT_FOUND for unknown tools', async () => {
    const kernel = createStandardKernel({
      storageDriver: new InMemoryStorageDriver(),
      history: { inMemory: true },
    });

    await kernel.boot({ workspaceRoot: '/workspace' });

    const tools = kernel.requestAccess<IBrudToolsService>(CALLER, BrudToolsToken);
    const result = await tools.executeTool('nope', {}, {
      workspaceRoot: '/workspace',
      callerId: 'test',
    });

    assert.strictEqual(result.status, 'failed');
    assert.match(String(result.error), /^TOOL_NOT_FOUND: /);

    await kernel.shutdown();
  });

  it('gates payloads through the injected validator', async () => {
    const descriptor = createBrudToolsDescriptor();
    const service = descriptor.factory(
      { callerId: 'kernel', tier: 'kernel', workspaceRoot: '/workspace' },
      {
        requestAccess: () => ({
          validateInput: (_schema: string, input: unknown) => (input === undefined
            ? { ok: true as const }
            : { ok: false as const, code: 'INVALID_FIELD', friendly: 'field rejected' }),
        }),
      } as never,
    );

    service.registerTool('brud.a', true, tool('read_file'));
    const result = await service.executeTool('read_file', { path: 'a.ts' }, {
      workspaceRoot: '/workspace',
      callerId: 'test',
    });

    assert.strictEqual(result.status, 'failed');
    assert.match(String(result.error), /^TOOL_VALIDATION_ERROR: /);
  });
});
