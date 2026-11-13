import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { bootKernel, BrudConfigError } from '../bootstrap/index.js';
import type { BrudConfig } from '../bootstrap/index.js';
import type { ServiceContext } from '../contracts/lifecycle.js';
import type { BrudKernel } from '../engine/BrudKernel.js';
import type { IBrudPlugin } from '../../../services/PluginManager/contracts/IBrudPlugin.js';
import type { IBrandRegistry } from '../../../services/BrandRegistry/contracts/IBrandRegistry.js';
import { BrandRegistryToken } from '../../../services/BrandRegistry/contracts/tokens.js';
import { PLUGIN_MANAGER_SCOPE_NAME } from '../../../services/PluginManager/serviceModule.js';
import type { IPluginManagerService } from '../../../services/PluginManager/contracts/IPluginManager.js';
import { PluginManagerToken } from '../../../services/PluginManager/contracts/tokens.js';
import type { IBrudToolsService } from '../../../services/BrudTools/contracts/IBrudToolsService.js';
import { BrudToolsToken } from '../../../services/BrudTools/descriptor/tokens.js';
import type { IUtilityService } from '../../../services/UtilityService/contracts/IUtilityService.js';
import { UtilityToken } from '../../../services/UtilityService/descriptor/tokens.js';
import { workspaceContextOptions } from './support/workspaceContext.js';

const KERNEL_CONFIG_PATH = fileURLToPath(
  new URL('../../../services/standard.config.json', import.meta.url),
);
const DAEMON_CONFIG_PATH = fileURLToPath(
  new URL('../../../daemon/brud.config.json', import.meta.url),
);

function caller(root: string): ServiceContext {
  return { callerId: 'kernel', tier: 'core', options: {...workspaceContextOptions(root)} };
}

async function workspace(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'brud-boot-config-'));

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  return root;
}

async function writeConfig(root: string, config: unknown): Promise<string> {
  const configPath = join(root, 'brud.config.json');

  await writeFile(configPath, JSON.stringify(config, null, 2));

  return configPath;
}

async function boot(
  t: TestContext,
  config: unknown,
): Promise<{ kernel: BrudKernel; root: string }> {
  const root = await workspace(t);
  const configPath = await writeConfig(root, config);
  const kernel = await bootKernel(configPath, {
    options: {...workspaceContextOptions(root),
      history: { inMemory: true },
    },
  });

  t.after(async () => {
    if (kernel.lifecycleState === 'RUNNING') {
      await kernel.shutdown().catch(() => undefined);
    }
  });

  return { kernel, root };
}

function writePluginModule(
  root: string,
  id: string,
): Promise<string> {
  const modulePath = join(root, `${id}.mjs`);

  return writeFile(modulePath, `export const plugin = {
  manifest: { id: '${id}', name: '${id}', version: '1.0.0', permissions: [] },
  activate() {},
};
`).then(() => modulePath);
}

describe('bootKernel config composition', () => {
  it('boots a minimal config with one service and no plugins', async (t) => {
    const { kernel, root } = await boot(t, {
      services: [
        { path: 'kernel:serviceModules/identityRegistry.js', official: true },
        { path: 'kernel:serviceModules/exposedApiRegistry.js', official: true },
        { path: '@brud/service-utility/serviceModule.js', official: true },
      ],
      plugins: [],
    });

    assert.equal(kernel.lifecycleState, 'RUNNING');
    assert.ok(
      kernel.requestAccess<IUtilityService>(caller(root), UtilityToken),
    );
  });

  it('fails with the missing module and config position', async (t) => {
    const root = await workspace(t);
    const configPath = await writeConfig(root, {
      services: [{ path: 'kernel:serviceModules/doesNotExist.js' }],
      plugins: [],
    });

    await assert.rejects(
      bootKernel(configPath, { options: {...workspaceContextOptions(root)} }),
      (error: unknown) => {
        assert.ok(error instanceof BrudConfigError);
        assert.equal(error.code, 'MODULE_RESOLVE');
        assert.match(error.message, /doesNotExist/u);
        assert.match(error.message, /services\[0\]/u);
        assert.match(error.message, /line \d+/u);
        return true;
      },
    );
  });

  it('rejects a malformed schema', async (t) => {
    const root = await workspace(t);
    const configPath = await writeConfig(root, {
      services: {},
      plugins: [],
    });

    await assert.rejects(
      bootKernel(configPath, { options: {...workspaceContextOptions(root)} }),
      (error: unknown) => {
        assert.ok(error instanceof BrudConfigError);
        assert.equal(error.code, 'CONFIG_SCHEMA');
        assert.match(error.message, /"services" must be an array/u);
        return true;
      },
    );
  });

  it('boots the daemon default config with the same services and plugins', async (t) => {
    const root = await workspace(t);
    const kernel = await bootKernel(DAEMON_CONFIG_PATH, {
      options: {...workspaceContextOptions(root),
        history: { inMemory: true },
      },
    });

    t.after(async () => {
      if (kernel.lifecycleState === 'RUNNING') {
        await kernel.shutdown().catch(() => undefined);
      }
    });

    assert.equal(kernel.lifecycleState, 'RUNNING');

    const tools = kernel.requestAccess<IBrudToolsService>(caller(root), BrudToolsToken);

    assert.ok(tools.listTools().length > 0);

    const plugins = kernel.requestAccess<IPluginManagerService>(
      caller(root),
      PluginManagerToken,
    );

    assert.equal(plugins.listPlugins().length, 9);
  });

  it('certifies a plugin declared official', async (t) => {
    const root = await workspace(t);
    const pluginPath = await writePluginModule(root, 'test.config.official');
    const base = JSON.parse(await readFile(KERNEL_CONFIG_PATH, 'utf8')) as BrudConfig;
    const configPath = await writeConfig(root, {
      services: base.services,
      plugins: [{ path: pluginPath, official: true }],
    });
    const kernel = await bootKernel(configPath, {
      options: {...workspaceContextOptions(root),
        history: { inMemory: true },
      },
    });

    t.after(async () => {
      if (kernel.lifecycleState === 'RUNNING') {
        await kernel.shutdown().catch(() => undefined);
      }
    });

    const module = await import(pathToFileURL(pluginPath).href) as {
      readonly plugin: IBrudPlugin;
    };

    const registry = kernel.requestAccess<IBrandRegistry>(caller(root), BrandRegistryToken);

    assert.equal(
      registry.getScope(PLUGIN_MANAGER_SCOPE_NAME)?.verify(module.plugin),
      true,
    );
  });

  it('does not certify a plugin without the official flag', async (t) => {
    const root = await workspace(t);
    const pluginPath = await writePluginModule(root, 'test.config.unofficial');
    const base = JSON.parse(await readFile(KERNEL_CONFIG_PATH, 'utf8')) as BrudConfig;
    const configPath = await writeConfig(root, {
      services: base.services,
      plugins: [{ path: pluginPath, official: false }],
    });
    const kernel = await bootKernel(configPath, {
      options: {...workspaceContextOptions(root),
        history: { inMemory: true },
      },
    });

    t.after(async () => {
      if (kernel.lifecycleState === 'RUNNING') {
        await kernel.shutdown().catch(() => undefined);
      }
    });

    const module = await import(pathToFileURL(pluginPath).href) as {
      readonly plugin: IBrudPlugin;
    };

    const registry = kernel.requestAccess<IBrandRegistry>(caller(root), BrandRegistryToken);

    assert.equal(
      registry.getScope(PLUGIN_MANAGER_SCOPE_NAME)?.verify(module.plugin),
      false,
    );
  });

  it('does not load a service omitted from the config and fails its dependents', async (t) => {
    const root = await workspace(t);
    const configPath = await writeConfig(root, {
      services: [
        { path: 'kernel:serviceModules/identityRegistry.js', official: true },
        { path: 'kernel:serviceModules/exposedApiRegistry.js', official: true },
        { path: '@brud/service-router/serviceModule.js' },
      ],
      plugins: [],
    });

    await assert.rejects(
      bootKernel(configPath, { options: {...workspaceContextOptions(root)} }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);

        assert.match(message, /parser|brud\.core\.parser/iu);
        return true;
      },
    );
  });
});
