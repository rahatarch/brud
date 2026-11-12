import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStandardKernel } from '@brud/kernel';
import type { OperationResult } from '@brud/kernel';
import type { ServiceContext } from '@brud/kernel';
import type { IBrudToolsService, ToolRegistrationOptions } from '../contracts/IBrudToolsService.js';
import {
  BRUD_TOOLS_SERVICE_TIER,
  createBrudToolsDescriptor,
} from '../descriptor/BrudToolsDescriptor.js';
import { BrudToolsToken } from '../descriptor/tokens.js';
import { workspaceContextOptions } from '../../../kernel/src/__tests__/support/workspaceContext.js';

let workspaceRoot = '';

before(async () => {
  workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), 'brud-tools-descriptor-')));
});

after(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

function caller(): ServiceContext {
  return { callerId: 'test', tier: 'core', options: {...workspaceContextOptions(workspaceRoot)} };
}

function tool(
  name: string,
  schema: string | Record<string, unknown> = 'object',
): ToolRegistrationOptions {
  return {
    name,
    description: `${name} description`,
    parametersSchema: typeof schema === 'string' ? { type: 'object', title: schema } : schema,
    execute: async (input): Promise<OperationResult> => ({ status: 'success', data: input }),
  };
}

describe('BrudTools descriptor', () => {
  it('uses the brud.core.tools token id', () => {
    assert.strictEqual(BrudToolsToken.id, 'brud.core.tools');
  });

  it('declares the core tier and no validation-service dependency', () => {
    const descriptor = createBrudToolsDescriptor();

    assert.strictEqual(descriptor.token, BrudToolsToken);
    assert.strictEqual(descriptor.tier, BRUD_TOOLS_SERVICE_TIER);
    assert.strictEqual(descriptor.tier, 'core');
    assert.deepStrictEqual(descriptor.dependencies, []);
    assert.deepStrictEqual(descriptor.accessPolicy, { deniedCallers: [] });
  });

  it('boots and resolves through the kernel', async () => {
    const kernel = createStandardKernel({
      history: { inMemory: true },
    });

    await kernel.boot({ options: {...workspaceContextOptions(workspaceRoot)} });

    const tools = kernel.requestAccess<IBrudToolsService>(caller(), BrudToolsToken);

    assert.deepStrictEqual(tools.listTools(), []);

    const disposable = tools.registerTool('brud.a', true, tool('read_file', {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    }));
    const result = await tools.executeTool('read_file', { path: 'a.ts' }, {
      workspaceRoot,
      callerId: 'test',
    });

    assert.strictEqual(result.status, 'success');
    assert.deepStrictEqual(result.data, { path: 'a.ts' });

    await disposable.dispose();
    assert.strictEqual(tools.getTool('read_file'), undefined);

    await kernel.shutdown();
  });

  it('admits a non-frozen tool name through the standard kernel gate', async () => {
    const kernel = createStandardKernel({
      history: { inMemory: true },
    });

    await kernel.boot({ options: {...workspaceContextOptions(workspaceRoot)} });

    const tools = kernel.requestAccess<IBrudToolsService>(caller(), BrudToolsToken);
    const disposable = tools.registerTool('brud.a', true, tool('synthetic_probe_tool'));
    const result = await tools.executeTool('synthetic_probe_tool', { value: 'hello' }, {
      workspaceRoot,
      callerId: 'test',
    });

    assert.strictEqual(result.status, 'success');
    assert.deepStrictEqual(result.data, { value: 'hello' });

    await disposable.dispose();
    await kernel.shutdown();
  });

  it('denies a tool whose requiredPermissions the caller lacks', async () => {
    const kernel = createStandardKernel({
      history: { inMemory: true },
    });

    await kernel.boot({ options: {...workspaceContextOptions(workspaceRoot)} });

    const tools = kernel.requestAccess<IBrudToolsService>(caller(), BrudToolsToken);
    tools.registerTool('brud.a', true, {
      ...tool('synthetic_probe_tool'),
      requiredPermissions: ['fs:read'],
    });
    const result = await tools.executeTool('synthetic_probe_tool', { value: 'hello' }, {
      workspaceRoot,
      callerId: 'test',
    });

    assert.strictEqual(result.status, 'failed');
    assert.match(String(result.error), /^TOOL_PERMISSION_DENIED: /);

    await kernel.shutdown();
  });

  it('rejects a payload that violates the registered schema', async () => {
    const kernel = createStandardKernel({
      history: { inMemory: true },
    });

    await kernel.boot({ options: {...workspaceContextOptions(workspaceRoot)} });

    const tools = kernel.requestAccess<IBrudToolsService>(caller(), BrudToolsToken);
    tools.registerTool('brud.a', true, tool('read_file', {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    }));
    const result = await tools.executeTool('read_file', {}, {
      workspaceRoot,
      callerId: 'test',
    });

    assert.strictEqual(result.status, 'failed');
    assert.match(String(result.error), /^TOOL_VALIDATION_ERROR: /);
    assert.match(String(result.error), /required/u);

    await kernel.shutdown();
  });

  it('reports TOOL_NOT_FOUND for unknown tools', async () => {
    const kernel = createStandardKernel({
      history: { inMemory: true },
    });

    await kernel.boot({ options: {...workspaceContextOptions(workspaceRoot)} });

    const tools = kernel.requestAccess<IBrudToolsService>(caller(), BrudToolsToken);
    const result = await tools.executeTool('nope', {}, {
      workspaceRoot,
      callerId: 'test',
    });

    assert.strictEqual(result.status, 'failed');
    assert.match(String(result.error), /^TOOL_NOT_FOUND: /);

    await kernel.shutdown();
  });

  it('validates against the registered schema without a validator service', async () => {
    const descriptor = createBrudToolsDescriptor();
    const service = descriptor.factory(
      { callerId: 'kernel', tier: 'kernel', options: {...workspaceContextOptions(workspaceRoot)} },
      {} as never,
    );

    service.registerTool('brud.a', true, tool('strict_tool', {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    }));

    const rejected = await service.executeTool('strict_tool', {}, {
      workspaceRoot,
      callerId: 'test',
    });

    assert.strictEqual(rejected.status, 'failed');
    assert.match(String(rejected.error), /^TOOL_VALIDATION_ERROR: /);

    const accepted = await service.executeTool('strict_tool', { path: 'a.ts' }, {
      workspaceRoot,
      callerId: 'test',
    });

    assert.strictEqual(accepted.status, 'success');
    assert.deepStrictEqual(accepted.data, { path: 'a.ts' });
  });
});