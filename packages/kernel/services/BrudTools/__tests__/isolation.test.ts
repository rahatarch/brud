import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { OperationResult } from '../../../src/contracts/handler.js';
import type { ToolRegistrationOptions } from '../contracts/IBrudToolsService.js';
import { BrudToolsService } from '../orchestrator/BrudToolsService.js';

const CONTEXT = { workspaceRoot: '/workspace', callerId: 'test' };

function tool(name: string, marker: string): ToolRegistrationOptions {
  return {
    name,
    description: `${name} description`,
    parametersSchema: { type: 'object' },
    execute: async (): Promise<OperationResult> => ({ status: 'success', data: marker }),
  };
}

describe('BrudToolsService isolation', () => {
  it('keeps two instances fully independent', async () => {
    const first = new BrudToolsService();
    const second = new BrudToolsService();

    first.registerTool('brud.a', true, tool('shared_name', 'first'));

    assert.ok(first.getTool('shared_name'));
    assert.strictEqual(second.getTool('shared_name'), undefined);
    assert.strictEqual(second.listTools().length, 0);

    second.registerTool('@vendor/b', false, tool('second_only', 'second'));

    assert.strictEqual(first.listTools().length, 1);
    assert.strictEqual(first.getTool('second_only'), undefined);

    const firstResult = await first.executeTool('shared_name', {}, CONTEXT);
    assert.strictEqual(firstResult.data, 'first');

    const missing = await second.executeTool('shared_name', {}, CONTEXT);
    assert.strictEqual(missing.status, 'failed');
    assert.match(String(missing.error), /^TOOL_NOT_FOUND: /);
  });

  it('allows the same tool name in both registries', () => {
    const first = new BrudToolsService();
    const second = new BrudToolsService();

    first.registerTool('brud.a', true, tool('read_file', 'first'));
    second.registerTool('brud.a', true, tool('read_file', 'second'));

    assert.strictEqual(first.getTool('read_file')?.ownerPluginId, 'brud.a');
    assert.strictEqual(second.getTool('read_file')?.ownerPluginId, 'brud.a');
  });

  it('disposing one instance leaves the other usable', async () => {
    const first = new BrudToolsService();
    const second = new BrudToolsService();
    first.registerTool('brud.a', true, tool('read_file', 'first'));
    second.registerTool('brud.a', true, tool('read_file', 'second'));

    await first.dispose();

    assert.strictEqual(first.getTool('read_file'), undefined);
    assert.strictEqual(first.listTools().length, 0);
    const disposed = await first.executeTool('read_file', {}, CONTEXT);
    assert.strictEqual(disposed.status, 'failed');
    assert.match(String(disposed.error), /^TOOL_DISPOSED: /);

    assert.ok(second.getTool('read_file'));
    const result = await second.executeTool('read_file', {}, CONTEXT);
    assert.strictEqual(result.data, 'second');
  });
});
