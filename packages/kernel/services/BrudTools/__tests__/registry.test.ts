import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { OperationResult } from '../../../src/contracts/handler.js';
import { ToolDuplicateError, ToolNotFoundError } from '../contracts/errors.js';
import type { IPluginExecutionContext, ToolRegistrationOptions } from '../contracts/IBrudToolsService.js';
import { ToolRegistry } from '../registry/ToolRegistry.js';

const CONTEXT: IPluginExecutionContext = { workspaceRoot: '/workspace', callerId: 'test' };

function tool(name: string, overrides: Partial<ToolRegistrationOptions> = {}): ToolRegistrationOptions {
  return {
    name,
    description: `${name} description`,
    parametersSchema: { type: 'object', properties: { path: { type: 'string' } } },
    requiredPermissions: ['fs:read'],
    execute: async (input): Promise<OperationResult> => ({ status: 'success', data: input }),
    ...overrides,
  };
}

describe('ToolRegistry registration', () => {
  it('registers a tool and exposes its projection', () => {
    const registry = new ToolRegistry();
    registry.registerTool('brud.tools.reader', true, tool('read_file'));

    const info = registry.getTool('read_file');

    assert.ok(info);
    assert.strictEqual(info.name, 'read_file');
    assert.strictEqual(info.description, 'read_file description');
    assert.strictEqual(info.ownerPluginId, 'brud.tools.reader');
    assert.strictEqual(info.isOfficial, true);
    assert.deepStrictEqual(info.requiredPermissions, ['fs:read']);
    assert.strictEqual(registry.size, 1);
  });

  it('rejects duplicate names without shadowing the first registration', () => {
    const registry = new ToolRegistry();
    registry.registerTool('brud.a', true, tool('read_file'));

    assert.throws(
      () => registry.registerTool('brud.b', false, tool('read_file')),
      (error: unknown) => {
        assert.ok(error instanceof ToolDuplicateError);
        assert.strictEqual(error.code, 'TOOL_DUPLICATE');
        assert.strictEqual(error.ownerPluginId, 'brud.a');

        return true;
      },
    );
    assert.strictEqual(registry.getTool('read_file')?.ownerPluginId, 'brud.a');
    assert.strictEqual(registry.size, 1);
  });

  it('strips the raw execute closure from getTool and listTools', async () => {
    const registry = new ToolRegistry();
    registry.registerTool('brud.a', true, tool('read_file'));

    const fromGet = registry.getTool('read_file') as unknown as Record<string, unknown>;
    const [fromList] = registry.listTools() as unknown as Record<string, unknown>[];

    assert.strictEqual('execute' in fromGet, false);
    assert.strictEqual('execute' in fromList, false);
    assert.ok(Object.isFrozen(fromGet));
    assert.ok(Object.isFrozen(fromList));

    const executable = registry.getExecutable('read_file');
    const result = await executable.execute({}, CONTEXT);

    assert.strictEqual(result.status, 'success');
  });

  it('filters listTools by official status', () => {
    const registry = new ToolRegistry();
    registry.registerTool('brud.a', true, tool('official_tool'));
    registry.registerTool('@vendor/git', false, tool('git_status'));

    assert.strictEqual(registry.listTools().length, 2);
    assert.deepStrictEqual(
      registry.listTools({ officialOnly: true }).map((entry) => entry.name),
      ['official_tool'],
    );
  });

  it('throws ToolNotFoundError from getExecutable for unknown names', () => {
    const registry = new ToolRegistry();

    assert.throws(
      () => registry.getExecutable('missing'),
      (error: unknown) => error instanceof ToolNotFoundError && error.code === 'TOOL_NOT_FOUND',
    );
  });
});

describe('ToolRegistry disposal', () => {
  it('removes the entry when its disposable is disposed', async () => {
    const registry = new ToolRegistry();
    const disposable = registry.registerTool('brud.a', true, tool('read_file'));

    assert.ok(registry.getTool('read_file'));
    await disposable.dispose();
    assert.strictEqual(registry.getTool('read_file'), undefined);
    assert.strictEqual(registry.size, 0);
    assert.strictEqual(registry.listTools().length, 0);
  });

  it('is idempotent and never removes a newer registration', async () => {
    const registry = new ToolRegistry();
    const first = registry.registerTool('brud.a', true, tool('read_file'));
    await first.dispose();
    registry.registerTool('brud.b', false, tool('read_file'));

    await first.dispose();
    assert.strictEqual(registry.getTool('read_file')?.ownerPluginId, 'brud.b');
  });

  it('removes every tool of one owner atomically', () => {
    const registry = new ToolRegistry();
    registry.registerTool('brud.a', true, tool('a1'));
    registry.registerTool('brud.a', true, tool('a2'));
    registry.registerTool('brud.b', false, tool('b1'));

    registry.removeByOwner('brud.a');

    assert.deepStrictEqual(registry.listTools().map((entry) => entry.name), ['b1']);
  });

  it('clears every registration', () => {
    const registry = new ToolRegistry();
    registry.registerTool('brud.a', true, tool('a1'));

    registry.clear();

    assert.strictEqual(registry.size, 0);
    assert.strictEqual(registry.getTool('a1'), undefined);
  });
});
