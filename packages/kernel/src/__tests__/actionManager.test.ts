import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServiceContext } from '../contracts/lifecycle.js';
import type { BrudKernel } from '../engine/BrudKernel.js';
import type { IBrudPlugin } from '../../services/PluginManager/contracts/IBrudPlugin.js';
import { AllowlistViolationError } from '../contracts/policy.js';
import { PluginPermissionError } from '../../services/PluginManager/contracts/errors.js';
import { PluginManagerToken } from '../../services/PluginManager/contracts/tokens.js';
import type { PluginManagerService } from '../../services/PluginManager/orchestrator/PluginManagerService.js';
import { ActionManagerToken } from '../../services/ActionManager/descriptor/tokens.js';
import type { IActionManager } from '../../services/ActionManager/contracts/index.js';
import {
  ECHO_ACTION_NAME,
  ECHO_ACTION_PLUGIN_ID,
  createActionProbePlugin,
  createEchoActionPlugin,
} from './fixtures/actionPlugin.js';
import { bootRealKernel } from './support/realKernel.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ACTION_MANAGER_ROOT = resolve(HERE, '../../services/ActionManager');

function caller(root: string, callerId = 'kernel'): ServiceContext {
  return { callerId, tier: 'core', workspaceRoot: root };
}

function actionManager(kernel: BrudKernel, root: string): IActionManager {
  return kernel.requestAccess(caller(root), ActionManagerToken);
}

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolute = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(absolute));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(absolute);
    }
  }

  return files.sort();
}

describe('ActionManager end-to-end pipeline', () => {
  it('registers a plugin action and executes it through the UI-facing service', async (t) => {
    const plugin = createEchoActionPlugin();
    const { kernel, root } = await bootRealKernel(t, {
      prefix: 'brud-action-manager-e2e-',
      initialPlugins: [plugin],
    });
    const actions = actionManager(kernel, root);

    const listed = actions.listActions();
    assert.deepEqual(listed.map((action) => action.name), [ECHO_ACTION_NAME]);
    assert.equal(listed[0]?.ownerPluginId, ECHO_ACTION_PLUGIN_ID);
    assert.equal('execute' in (listed[0] ?? {}), false);

    const result = await actions.executeAction(
      ECHO_ACTION_NAME,
      { message: 'hello ui' },
      { workspaceRoot: root, callerId: 'c_ui', origin: 'daemon-rpc' },
    );

    assert.equal(result.status, 'success');
    assert.deepEqual(result.data, {
      message: 'hello ui',
      pluginId: ECHO_ACTION_PLUGIN_ID,
      callerId: 'c_ui',
      workspaceRoot: root,
      origin: 'daemon-rpc',
    });
  });

  it('rejects a payload that fails the registered schema', async (t) => {
    const { kernel, root } = await bootRealKernel(t, {
      prefix: 'brud-action-manager-schema-',
      initialPlugins: [createEchoActionPlugin()],
    });
    const actions = actionManager(kernel, root);

    const result = await actions.executeAction(
      ECHO_ACTION_NAME,
      {},
      { workspaceRoot: root, callerId: 'c_ui', origin: 'daemon-rpc' },
    );

    assert.equal(result.status, 'failed');
    assert.match(String(result.error), /ACTION_VALIDATION_ERROR/u);
  });

  it('removes the action when the owning plugin deactivates', async (t) => {
    const { kernel, root } = await bootRealKernel(t, {
      prefix: 'brud-action-manager-dispose-',
      initialPlugins: [createEchoActionPlugin()],
    });
    const manager = kernel.requestAccess(
      caller(root),
      PluginManagerToken,
    ) as PluginManagerService;
    const actions = actionManager(kernel, root);

    assert.equal(actions.listActions().length, 1);

    await manager.deactivatePlugin(ECHO_ACTION_PLUGIN_ID);

    assert.deepEqual(actions.listActions(), []);
  });
});

describe('ActionManager unidirectional boundary', () => {
  it('rejects registration from a plugin without actions:register', async (t) => {
    const probe: Parameters<typeof createActionProbePlugin>[2] = {};
    const plugin = createActionProbePlugin('acme.test.no-actions', [], probe);
    const { kernel, root } = await bootRealKernel(t, {
      prefix: 'brud-action-manager-permission-',
      initialPlugins: [plugin],
    });

    assert.ok(probe.registerError instanceof PluginPermissionError);
    assert.equal(
      (probe.registerError as PluginPermissionError).operation,
      'registerAction',
    );
    assert.deepEqual(actionManager(kernel, root).listActions(), []);
  });

  it('never exposes execution, lookup, or the manager to the plugin context', async (t) => {
    const probe: Parameters<typeof createActionProbePlugin>[2] = {};
    const plugin = createActionProbePlugin('acme.test.action-probe', ['actions:register'], probe);
    const { kernel, root } = await bootRealKernel(t, {
      prefix: 'brud-action-manager-surface-',
      initialPlugins: [plugin],
    });

    assert.equal(probe.executeActionExposed, false);
    assert.equal(probe.getActionManagerExposed, false);
    assert.equal(probe.listActionsExposed, false);
    assert.equal(probe.registerError, undefined);
    assert.deepEqual(
      actionManager(kernel, root).listActions().map((action) => action.name),
      ['acme.test.action-probe_probe'],
    );
  });

  it('allows the UI daemon caller id to resolve the manager', async (t) => {
    const { kernel, root } = await bootRealKernel(t, {
      prefix: 'brud-action-manager-daemon-',
    });

    const actions = kernel.requestAccess(
      caller(root, 'brud.host.daemon'),
      ActionManagerToken,
    );

    assert.deepEqual(actions.listActions(), []);
  });

  it('rejects an internal caller that is not on the ActionManager allowlist', async (t) => {
    const { kernel, root } = await bootRealKernel(t, {
      prefix: 'brud-action-manager-allowlist-',
    });

    assert.throws(
      () => kernel.requestAccess(caller(root, 'acme.test.rogue'), ActionManagerToken),
      (error: unknown) => {
        assert.ok(error instanceof AllowlistViolationError);
        assert.equal(error.code, 'NOT_IN_ALLOWLIST');
        return true;
      },
    );
  });

  it('keeps ActionManager source free of PluginManager and plugin imports', async () => {
    const files = await collectSourceFiles(ACTION_MANAGER_ROOT);
    const importPattern =
      /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"][^'"]*(?:PluginManager|packages\/plugins|\/plugins\/)[^'"]*['"]/u;

    assert.ok(files.length > 0, 'ActionManager must contain source files');

    for (const file of files) {
      const source = await readFile(file, 'utf8');

      assert.equal(
        importPattern.test(source),
        false,
        `${file} must not import PluginManager or a plugin package`,
      );
    }
  });
});