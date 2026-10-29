import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OperationResult } from '../../../src/contracts/handler.js';
import { BrudToolsService } from '../../BrudTools/orchestrator/BrudToolsService.js';
import { certifyOfficialPlugin } from '../contracts/branding.js';
import { PluginPermissionError } from '../contracts/errors.js';
import type { IBrudPlugin } from '../contracts/IBrudPlugin.js';
import type { IPluginContext } from '../contracts/IPluginContext.js';
import type { PluginManifest } from '../contracts/manifest.js';
import type { PluginPermission } from '../contracts/permissions.js';
import type { PluginManagerRuntimeDependencies } from './types.js';
import { PluginManagerService } from './PluginManagerService.js';

const WORKSPACE_ROOT = '/workspace';

const ECHO_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: { message: { type: 'string' } },
  required: ['message'],
};

function echoResult(input: Record<string, unknown>): OperationResult {
  return { status: 'success', data: { echoed: input.message } };
}

function createPlugin(
  id: string,
  permissions: readonly PluginPermission[],
  onActivate?: (context: IPluginContext) => void | Promise<void>,
): IBrudPlugin {
  const manifest: PluginManifest = {
    id,
    name: id,
    version: '1.0.0',
    permissions: [...permissions],
  };

  return {
    manifest,
    activate: async (context: IPluginContext): Promise<void> => {
      await onActivate?.(context);
    },
  };
}

function createManager(
  brudTools: () => BrudToolsService,
): PluginManagerService {
  const dependencies: PluginManagerRuntimeDependencies = {
    workspaceRoot: WORKSPACE_ROOT,
    fileSystem: (): never => {
      throw new Error('filesystem is not used in this test');
    },
    brudTools,
  };

  return new PluginManagerService(dependencies);
}

function createTools(): BrudToolsService {
  return new BrudToolsService();
}

describe('PluginManagerService tool capabilities', () => {
  it('denies registerTool without the tools:register permission', async () => {
    const tools = createTools();
    const manager = createManager(() => tools);
    let denied: unknown;

    manager.register(
      createPlugin('acme.tools.restricted', [], (context): void => {
        try {
          context.registerTool({
            name: 'acme_echo',
            description: 'Echo',
            parametersSchema: ECHO_SCHEMA,
            execute: async (input): Promise<OperationResult> => echoResult(input),
          });
        } catch (error: unknown) {
          denied = error;
        }
      }),
    );

    await manager.activatePlugin('acme.tools.restricted');

    assert.ok(denied instanceof PluginPermissionError);
    assert.equal(denied.code, 'PLUGIN_PERMISSION');
    assert.equal(denied.pluginId, 'acme.tools.restricted');
    assert.deepEqual(denied.requiredPermissions, ['tools:register']);
    assert.equal(tools.listTools().length, 0);
  });

  it('denies executeTool without the tools:execute permission', async () => {
    const tools = createTools();
    const manager = createManager(() => tools);
    let pending: Promise<OperationResult> | undefined;

    manager.register(
      createPlugin('acme.tools.register-only', ['tools:register'], (context): void => {
        context.registerTool({
          name: 'acme_echo',
          description: 'Echo',
          parametersSchema: ECHO_SCHEMA,
          execute: async (input): Promise<OperationResult> => echoResult(input),
        });

        pending = context.executeTool('acme_echo', { message: 'hi' });
      }),
    );

    await manager.activatePlugin('acme.tools.register-only');

    await assert.rejects(pending ?? Promise.resolve(), (error: unknown) => {
      assert.ok(error instanceof PluginPermissionError);
      assert.equal(error.code, 'PLUGIN_PERMISSION');
      assert.equal(error.pluginId, 'acme.tools.register-only');
      assert.equal(error.operation, 'executeTool');
      return true;
    });
    assert.equal(tools.getTool('acme_echo')?.ownerPluginId, 'acme.tools.register-only');
  });

  it('denies executeTool for a plugin holding only tools:register', async () => {
    const tools = createTools();
    const manager = createManager(() => tools);
    let seen: IPluginContext | undefined;

    manager.register(
      createPlugin('acme.tools.register-only', ['tools:register'], (context): void => {
        seen = context;
      }),
    );

    await manager.activatePlugin('acme.tools.register-only');

    assert.ok(seen !== undefined);
    await assert.rejects(
      seen.executeTool('acme_missing', {}),
      (error: unknown) => {
        assert.ok(error instanceof PluginPermissionError);
        assert.equal(error.operation, 'executeTool');
        assert.deepEqual(error.requiredPermissions, ['tools:execute']);
        return true;
      },
    );
  });

  it('denies registerTool for a plugin holding only tools:execute', async () => {
    const tools = createTools();
    const manager = createManager(() => tools);
    let seen: IPluginContext | undefined;

    manager.register(
      createPlugin('acme.tools.execute-only', ['tools:execute'], (context): void => {
        seen = context;
      }),
    );

    await manager.activatePlugin('acme.tools.execute-only');

    assert.ok(seen !== undefined);
    assert.throws(
      () =>
        seen?.registerTool({
          name: 'acme_denied',
          description: 'Denied',
          parametersSchema: ECHO_SCHEMA,
          execute: async (input): Promise<OperationResult> => echoResult(input),
        }),
      (error: unknown) => {
        assert.ok(error instanceof PluginPermissionError);
        assert.equal(error.operation, 'registerTool');
        assert.deepEqual(error.requiredPermissions, ['tools:register']);
        return true;
      },
    );
    assert.equal(tools.listTools().length, 0);
  });

  it('removes a registered tool automatically when the plugin deactivates', async () => {
    const tools = createTools();
    const manager = createManager(() => tools);

    manager.register(
      createPlugin('acme.tools.lifecycle', ['tools:register'], (context): void => {
        context.registerTool({
          name: 'acme_echo',
          description: 'Echo',
          parametersSchema: ECHO_SCHEMA,
          execute: async (input): Promise<OperationResult> => echoResult(input),
        });
      }),
    );

    await manager.activatePlugin('acme.tools.lifecycle');

    assert.equal(tools.getTool('acme_echo')?.ownerPluginId, 'acme.tools.lifecycle');

    await manager.deactivatePlugin('acme.tools.lifecycle');

    assert.equal(tools.getTool('acme_echo'), undefined);
    assert.deepEqual(tools.listTools(), []);
    assert.equal(manager.getPlugin('acme.tools.lifecycle')?.state, 'unloaded');
  });

  it('propagates the derived official status to the registry', async () => {
    const tools = createTools();
    const manager = createManager(() => tools);
    const registerOnActivate = (context: IPluginContext): void => {
      context.registerTool({
        name: `echo_${context.pluginId.replaceAll('.', '_')}`,
        description: 'Echo',
        parametersSchema: ECHO_SCHEMA,
        execute: async (input): Promise<OperationResult> => echoResult(input),
      });
    };

    manager.register(
      certifyOfficialPlugin(
        createPlugin('brud.tools.official', ['tools:register'], registerOnActivate),
      ),
    );
    manager.register(
      createPlugin('acme.tools.third-party', ['tools:register'], registerOnActivate),
    );

    await manager.activateAll();

    const recorded = Object.fromEntries(
      tools.listTools().map((tool) => [tool.ownerPluginId, tool.isOfficial]),
    );

    assert.deepEqual(recorded, {
      'brud.tools.official': true,
      'acme.tools.third-party': false,
    });
  });

  it('ignores forged official fields on the registration options', async () => {
    const tools = createTools();
    const manager = createManager(() => tools);

    manager.register(
      createPlugin('acme.tools.forger', ['tools:register'], (context): void => {
        const options = {
          name: 'acme_forged',
          description: 'Forged',
          parametersSchema: ECHO_SCHEMA,
          ownerPluginId: 'brud.tools.other',
          isOfficial: true,
          execute: async (input: Record<string, unknown>): Promise<OperationResult> =>
            echoResult(input),
        };

        context.registerTool(options);
      }),
    );

    await manager.activateAll();

    const tool = tools.getTool('acme_forged');

    assert.ok(tool !== undefined);
    assert.equal(tool.ownerPluginId, 'acme.tools.forger');
    assert.equal(tool.isOfficial, false);
  });

  it('executes a registered tool through the context and returns OperationResult', async () => {
    const tools = createTools();
    const manager = createManager(() => tools);
    const calls: { workspaceRoot: string; callerId: string }[] = [];
    let result: OperationResult | undefined;

    manager.register(
      createPlugin(
        'acme.tools.executor',
        ['tools:register', 'tools:execute'],
        async (context) => {
          context.registerTool({
            name: 'acme_echo',
            description: 'Echo',
            parametersSchema: ECHO_SCHEMA,
            execute: async (input, executionContext): Promise<OperationResult> => {
              calls.push({
                workspaceRoot: executionContext.workspaceRoot,
                callerId: executionContext.callerId,
              });

              return echoResult(input);
            },
          });

          result = await context.executeTool('acme_echo', { message: 'hello' });
        },
      ),
    );

    await manager.activatePlugin('acme.tools.executor');

    assert.deepEqual(result, { status: 'success', data: { echoed: 'hello' } });
    assert.deepEqual(calls, [{ workspaceRoot: WORKSPACE_ROOT, callerId: 'acme.tools.executor' }]);
  });

  it('forwards the cancellation signal supplied by the caller', async () => {
    const tools = createTools();
    const manager = createManager(() => tools);
    const controller = new AbortController();
    let observed: AbortSignal | undefined;

    manager.register(
      createPlugin(
        'acme.tools.signals',
        ['tools:register', 'tools:execute'],
        async (context) => {
          context.registerTool({
            name: 'acme_signal',
            description: 'Signal',
            parametersSchema: {},
            execute: async (_input, executionContext): Promise<OperationResult> => {
              observed = executionContext.signal;
              return { status: 'success' };
            },
          });

          await context.executeTool('acme_signal', {}, { signal: controller.signal });
        },
      ),
    );

    await manager.activatePlugin('acme.tools.signals');

    assert.equal(observed, controller.signal);
  });

  it('reports a friendly failure when the tools service is unavailable', async () => {
    const manager = new PluginManagerService({
      workspaceRoot: WORKSPACE_ROOT,
      fileSystem: (): never => {
        throw new Error('filesystem is not used in this test');
      },
    });
    let failure: unknown;

    manager.register(
      createPlugin('acme.tools.orphan', ['tools:register'], (context): void => {
        try {
          context.registerTool({
            name: 'acme_orphan',
            description: 'Orphan',
            parametersSchema: {},
            execute: async (): Promise<OperationResult> => ({ status: 'success' }),
          });
        } catch (error: unknown) {
          failure = error;
        }
      }),
    );

    await manager.activatePlugin('acme.tools.orphan');

    assert.ok(failure instanceof Error);
    assert.match(failure.message, /Tools service is unavailable for plugin "acme.tools.orphan"/);
  });
});
