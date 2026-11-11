import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OperationResult } from '../../src/contracts/handler.js';
import type { ServiceContext } from '../../src/contracts/lifecycle.js';
import type { IBrudToolsService } from '../../services/BrudTools/contracts/IBrudToolsService.js';
import { BrudToolsToken } from '../../services/BrudTools/descriptor/tokens.js';
import type { IBrudPlugin } from '../../services/PluginManager/contracts/IBrudPlugin.js';
import { PluginManagerToken } from '../../services/PluginManager/contracts/tokens.js';
import type { IPluginManagerService } from '../../services/PluginManager/contracts/IPluginManager.js';
import type { PluginManagerService } from '../../services/PluginManager/orchestrator/PluginManagerService.js';
import { bootRealKernel } from './support/realKernel.js';

const PLUGIN_PERMISSIONS = ['tools:register', 'tools:execute', 'fs:read', 'fs:write'] as const;

function toolName(plugin: string, index: number): string {
  return `acme.${plugin}.tool.${index}`;
}

function plugin(id: string, count: number): IBrudPlugin {
  return {
    manifest: {
      id: `acme.${id}`,
      name: id,
      version: '1.0.0',
      permissions: [...PLUGIN_PERMISSIONS],
    },
    activate: (context): void => {
      for (let index = 0; index < count; index += 1) {
        const name = toolName(id, index);

        context.registerTool({
          name,
          description: `${name} description`,
          parametersSchema: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
          },
          requiredPermissions: ['fs:read', 'fs:write'],
          execute: async (input): Promise<OperationResult> => {
            const fs = context.getFileSystem();
            await fs.writeAtomic(`out-${name}.txt`, String(input.value));
            return { status: 'success', data: { name, value: input.value } };
          },
        });
      }
    },
  };
}

function plugins(): readonly IBrudPlugin[] {
  return [plugin('alpha', 34), plugin('beta', 33), plugin('gamma', 33)];
}

function expectedNames(): readonly string[] {
  return [
    ...Array.from({ length: 34 }, (_, index) => toolName('alpha', index)),
    ...Array.from({ length: 33 }, (_, index) => toolName('beta', index)),
    ...Array.from({ length: 33 }, (_, index) => toolName('gamma', index)),
  ];
}

function caller(root: string): ServiceContext {
  return { callerId: 'scalability', tier: 'core', options: { workspaceRoot: root } };
}

describe('100 tools from 3 plugins', () => {
  it('all 100 tools register', async (t) => {
    const { kernel, root } = await bootRealKernel(t, {
      prefix: 'brud-scalability-register-',
      initialPlugins: plugins(),
    });
    const tools = kernel.requestAccess<IBrudToolsService>(caller(root), BrudToolsToken);
    const names = tools.listTools().map((tool) => tool.name).sort();

    assert.equal(names.length, 100);
    assert.deepEqual(names, [...expectedNames()].sort());
  });

  it('ownership is correct', async (t) => {
    const { kernel, root } = await bootRealKernel(t, {
      prefix: 'brud-scalability-ownership-',
      initialPlugins: plugins(),
    });
    const tools = kernel.requestAccess<IBrudToolsService>(caller(root), BrudToolsToken);

    for (const tool of tools.listTools()) {
      const owner = tool.name.split('.').slice(0, 2).join('.');
      assert.equal(tool.ownerPluginId, owner);
    }

    assert.equal(tools.listTools({ officialOnly: true }).length, 0);
  });

  it("every plugin's tools execute", async (t) => {
    const { kernel, root } = await bootRealKernel(t, {
      prefix: 'brud-scalability-execute-',
      initialPlugins: plugins(),
    });
    const tools = kernel.requestAccess<IBrudToolsService>(caller(root), BrudToolsToken);
    const context = {
      workspaceRoot: root,
      callerId: 'scalability',
      permissions: ['fs:read', 'fs:write'],
    };

    for (const name of [toolName('alpha', 0), toolName('beta', 0), toolName('gamma', 0)]) {
      const result = await tools.executeTool(name, { value: `value-${name}` }, context);

      assert.equal(result.status, 'success');
      assert.equal(await readFile(join(root, `out-${name}.txt`), 'utf8'), `value-${name}`);
    }
  });

  it('permissions are respected at scale', async (t) => {
    const { kernel, root } = await bootRealKernel(t, {
      prefix: 'brud-scalability-permissions-',
      initialPlugins: plugins(),
    });
    const tools = kernel.requestAccess<IBrudToolsService>(caller(root), BrudToolsToken);
    const name = toolName('alpha', 1);
    const result = await tools.executeTool(name, { value: 'denied' }, {
      workspaceRoot: root,
      callerId: 'scalability',
      permissions: [],
    });

    assert.equal(result.status, 'failed');
    assert.match(String(result.error), /^TOOL_PERMISSION_DENIED: /);
    await assert.rejects(access(join(root, `out-${name}.txt`)), /ENOENT/);
  });

  it('deactivating one plugin removes only its tools', async (t) => {
    const { kernel, root } = await bootRealKernel(t, {
      prefix: 'brud-scalability-deactivate-',
      initialPlugins: plugins(),
    });
    const tools = kernel.requestAccess<IBrudToolsService>(caller(root), BrudToolsToken);
    const manager = kernel.requestAccess<IPluginManagerService>(caller(root), PluginManagerToken) as PluginManagerService;

    await manager.deactivatePlugin('acme.alpha');

    assert.equal(tools.getTool(toolName('alpha', 0)), undefined);
    assert.equal(tools.listTools().length, 66);
    assert.ok(tools.getTool(toolName('beta', 0)) !== undefined);
    assert.ok(tools.getTool(toolName('gamma', 0)) !== undefined);
  });

  it('the real history database exists', async (t) => {
    const { dbPath } = await bootRealKernel(t, {
      prefix: 'brud-scalability-database-',
      initialPlugins: plugins(),
    });

    await access(dbPath);

    const db = new DatabaseSync(dbPath);
    try {
      const row = db.prepare('PRAGMA integrity_check').get() as Record<string, unknown>;
      assert.equal(Object.values(row)[0], 'ok');
    } finally {
      db.close();
    }
  });

  it('shutdown leaves the workspace files on disk', async (t) => {
    const { kernel, root } = await bootRealKernel(t, {
      prefix: 'brud-scalability-shutdown-',
      initialPlugins: plugins(),
    });
    const tools = kernel.requestAccess<IBrudToolsService>(caller(root), BrudToolsToken);
    const name = toolName('gamma', 2);

    await tools.executeTool(name, { value: 'persisted' }, {
      workspaceRoot: root,
      callerId: 'scalability',
      permissions: ['fs:read', 'fs:write'],
    });
    await kernel.shutdown();

    assert.equal(await readFile(join(root, `out-${name}.txt`), 'utf8'), 'persisted');
  });
});
