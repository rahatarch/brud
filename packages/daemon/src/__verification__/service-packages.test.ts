import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BrudKernel } from '@brud/kernel' with { 'resolution-mode': 'import' };
import type { IBrudToolsService } from '@brud/service-tools' with { 'resolution-mode': 'import' };
import type { IPluginManagerService } from '@brud/service-plugin-manager' with { 'resolution-mode': 'import' };
import type { IUtilityService } from '@brud/service-utility' with { 'resolution-mode': 'import' };
import {
  DEFAULT_BRUD_CONFIG_PATH,
  createKernel,
  createWorkspaceContextOptions,
  loadKernelModule,
} from '../kernelRuntime.js';

interface ConfigEntry {
  readonly path: string;
  readonly official?: boolean;
}

interface ConfigDocument {
  readonly services: readonly ConfigEntry[];
  readonly plugins: readonly ConfigEntry[];
}

const SERVICE_IDS = [
  'brud.core.identityRegistry',
  'brud.core.settings',
  'brud.core.settings.reader',
  'brud.core.utils',
  'brud.core.exposedApiRegistry',
  'brud.core.brandRegistry',
  'brud.core.workspace',
  'brud.core.filesystem',
  'brud.core.validation',
  'brud.core.terminal',
  'brud.core.parser',
  'brud.core.router',
  'brud.core.tools',
  'brud.core.actions',
  'brud.core.history',
  'brud.core.universalHistory',
  'PluginManager',
] as const;

function readConfig(path: string): ConfigDocument {
  return JSON.parse(readFileSync(path, 'utf8')) as ConfigDocument;
}

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('non-hardcore service packages through the production boot path', () => {
  it('references every non-hardcore service by its package and only identity by kernel shim', () => {
    const config = readConfig(DEFAULT_BRUD_CONFIG_PATH);
    const kernelEntries = config.services.filter((entry) =>
      entry.path.startsWith('kernel:'));

    assert.deepEqual(
      kernelEntries.map((entry) => entry.path),
      ['kernel:serviceModules/identityRegistry.js'],
      'only the hardcore identity registry may use a kernel-internal path',
    );

    const packages = config.services
      .filter((entry) => !entry.path.startsWith('kernel:'))
      .map((entry) => entry.path.split('/').slice(0, 2).join('/'));

    assert.deepEqual(packages, [
      '@brud/service-settings',
      '@brud/service-settings',
      '@brud/service-utility',
      '@brud/service-exposed-api-registry',
      '@brud/service-brand-registry',
      '@brud/service-workspace',
      '@brud/service-filesystem',
      '@brud/service-validation',
      '@brud/service-terminal',
      '@brud/service-parser',
      '@brud/service-router',
      '@brud/service-tools',
      '@brud/service-actions',
      '@brud/service-history',
      '@brud/service-history',
      '@brud/service-plugin-manager',
    ]);
  });

  it('boots the real kernel from the on-disk daemon config with the real packages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brud-service-packages-'));
    roots.push(root);

    const kernel: BrudKernel = await createKernel({ workspaceRoot: root });

    try {
      assert.equal(kernel.lifecycleState, 'RUNNING');

      const ids = kernel.listServices().map((service) => service.id).sort();
      assert.deepEqual(ids, [...SERVICE_IDS].sort());

      const caller = {
        callerId: 'brud.verification.servicePackages',
        tier: 'core' as const,
        options: createWorkspaceContextOptions(root),
      };

      const { UtilityToken } = await import('@brud/service-utility');
      const utility = kernel.requestAccess<IUtilityService>(caller, UtilityToken);
      assert.equal(typeof utility.resolveImports, 'function');

      const { BrudToolsToken } = await import('@brud/service-tools');
      const tools = kernel.requestAccess<IBrudToolsService>(caller, BrudToolsToken);
      assert.equal(typeof tools.listTools, 'function');
      assert.ok(tools.listTools().length > 0, 'the official plugins registered tools');

      const { PluginManagerToken } = await import('@brud/service-plugin-manager');
      const manager = kernel.requestAccess<IPluginManagerService>(caller, PluginManagerToken);
      const plugins = manager.listPlugins();

      assert.ok(plugins.length >= 9, 'the daemon config activated the real plugins');
      assert.ok(plugins.every((plugin) => plugin.state === 'active'));
    } finally {
      await kernel.shutdown();
    }
  });

  it('still refuses to boot without the hardcore identity registry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brud-service-packages-'));
    roots.push(root);

    const config = readConfig(DEFAULT_BRUD_CONFIG_PATH);
    const withoutIdentity = {
      ...config,
      services: config.services.filter((entry) =>
        entry.path !== 'kernel:serviceModules/identityRegistry.js'),
    };
    const configPath = join(root, 'brud.config.json');
    writeFileSync(configPath, JSON.stringify(withoutIdentity, null, 2));

    const kernelModule = await loadKernelModule();

    await assert.rejects(
      kernelModule.bootKernel(configPath, {
        options: createWorkspaceContextOptions(root),
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, 'HardcoreServiceError', error.message);
        assert.match(error.message, /identityRegistry.*presence/iu);
        return true;
      },
    );
  });

  it('still refuses a substituted identity registry package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brud-service-packages-'));
    roots.push(root);

    const kernelRoot = resolve(__dirname, '../../../kernel/dist');
    const copyRoot = join(root, 'kernel-copy');
    cpSync(kernelRoot, copyRoot, { recursive: true });
    appendFileSync(
      join(copyRoot, 'services', 'IdentityRegistry', 'serviceModule.js'),
      '\n// substituted package\n',
    );

    const config = readConfig(DEFAULT_BRUD_CONFIG_PATH);
    const substituted = {
      ...config,
      services: config.services.map((entry) =>
        entry.path === 'kernel:serviceModules/identityRegistry.js'
          ? { ...entry, path: join(copyRoot, 'serviceModules', 'identityRegistry.js') }
          : entry),
    };
    const configPath = join(root, 'brud.config.json');
    writeFileSync(configPath, JSON.stringify(substituted, null, 2));

    const kernelModule = await loadKernelModule();

    await assert.rejects(
      kernelModule.bootKernel(configPath, {
        options: createWorkspaceContextOptions(root),
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, 'HardcoreServiceError', error.message);
        assert.match(error.message, /identityRegistry.*content-hash/iu);
        return true;
      },
    );
  });

  it('still refuses an identity registry with the wrong contract', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brud-service-packages-'));
    roots.push(root);

    const wrongContract = join(root, 'wrongIdentity.mjs');
    writeFileSync(
      wrongContract,
      `const token = { id: 'brud.core.identityRegistry', description: 'wrong contract', _brand: [] };

export function createService() {
  return {
    token,
    tier: 'core',
    dependencies: [],
    contract: { version: '0.0.0', methods: ['issue', 'resolve', 'retire', 'revoke'] },
    factory: () => ({
      initialize() {},
      start() {},
      stop() {},
      dispose() {},
    }),
  };
}
`,
    );

    const config = readConfig(DEFAULT_BRUD_CONFIG_PATH);
    const wrong = {
      ...config,
      services: config.services.map((entry) =>
        entry.path === 'kernel:serviceModules/identityRegistry.js'
          ? { ...entry, path: wrongContract }
          : entry),
    };
    const configPath = join(root, 'brud.config.json');
    writeFileSync(configPath, JSON.stringify(wrong, null, 2));

    const kernelModule = await loadKernelModule();

    await assert.rejects(
      kernelModule.bootKernel(configPath, {
        options: createWorkspaceContextOptions(root),
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, 'HardcoreServiceError', error.message);
        assert.match(error.message, /identityRegistry.*contract/iu);
        return true;
      },
    );
  });
});