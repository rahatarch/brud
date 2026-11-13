import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { bootKernel, BrudConfigError } from '../bootstrap/index.js';
import { BrudConfigError as BuiltBrudConfigError } from '@brud/kernel';
import type { BrudConfig, BrudConfigEntry } from '../bootstrap/index.js';
import type { ServiceContext } from '../contracts/lifecycle.js';
import type { BrudKernel } from '../engine/BrudKernel.js';
import type { IBrandScope } from '../../../services/BrandRegistry/contracts/IBrandScope.js';
import type { IBrandRegistry } from '../../../services/BrandRegistry/contracts/IBrandRegistry.js';
import { BrandRegistryToken } from '../../../services/BrandRegistry/contracts/tokens.js';
import { PLUGIN_MANAGER_SCOPE_NAME } from '../../../services/PluginManager/serviceModule.js';
import type { IPluginManagerService } from '../../../services/PluginManager/contracts/IPluginManager.js';
import { PluginManagerToken } from '../../../services/PluginManager/contracts/tokens.js';
import { workspaceContextOptions } from './support/workspaceContext.js';

const KERNEL_CONFIG_PATH = fileURLToPath(
  new URL('../../../services/standard.config.json', import.meta.url),
);

let baseServicesCache: Promise<readonly BrudConfigEntry[]> | undefined;

function baseServices(): Promise<readonly BrudConfigEntry[]> {
  baseServicesCache ??= readFile(KERNEL_CONFIG_PATH, 'utf8').then(
    (raw) => (JSON.parse(raw) as BrudConfig).services,
  );

  return baseServicesCache;
}

function caller(root: string): ServiceContext {
  return { callerId: 'config-authority.test', tier: 'core', options: { ...workspaceContextOptions(root) } };
}

async function createWorkspace(t: TestContext, prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  return root;
}

async function writeText(path: string, content: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');

  return path;
}

interface PluginModuleOptions {
  readonly id: string;
  readonly permissions?: readonly string[];
  readonly official?: boolean;
  readonly dependencies?: readonly string[];
  readonly imports?: string;
  readonly activateBody?: string;
  readonly extraExports?: string;
}

function pluginSource(options: PluginModuleOptions): string {
  const manifest = {
    id: options.id,
    name: options.id,
    version: '1.0.0',
    permissions: [...(options.permissions ?? [])],
    ...(options.dependencies === undefined ? {} : { dependencies: [...options.dependencies] }),
    ...(options.official === undefined ? {} : { official: options.official }),
  };
  const imports = options.imports === undefined ? '' : `${options.imports}\n`;
  const body = options.activateBody === undefined ? '    void context;' : options.activateBody;
  const extra = options.extraExports === undefined ? '' : `\n${options.extraExports}\n`;

  return `${imports}export const plugin = {
  manifest: ${JSON.stringify(manifest, null, 2)},
  activate(context) {
${body}
  },
};
${extra}`;
}

async function writePluginPackage(
  directory: string,
  options: PluginModuleOptions,
  packageJson: Record<string, unknown> = {},
): Promise<{ readonly directory: string; readonly entry: string; readonly packageJsonPath: string }> {
  await mkdir(directory, { recursive: true });
  const entry = join(directory, 'index.mjs');
  const packageJsonPath = join(directory, 'package.json');

  await writeFile(entry, pluginSource(options), 'utf8');
  await writeFile(
    packageJsonPath,
    JSON.stringify(
      { name: options.id, version: '1.0.0', type: 'module', main: './index.mjs', ...packageJson },
      null,
      2,
    ),
    'utf8',
  );

  return { directory, entry, packageJsonPath };
}

async function writeConfig(root: string, config: BrudConfig): Promise<{ readonly path: string; readonly raw: string }> {
  const path = join(root, 'brud.config.json');
  const raw = JSON.stringify(config, null, 2);

  await writeFile(path, raw, 'utf8');

  return { path, raw };
}

async function bootAt(
  t: TestContext,
  root: string,
  configPath: string,
): Promise<{ readonly kernel: BrudKernel; readonly options: Record<string, unknown> }> {
  const options: Record<string, unknown> = {
    ...workspaceContextOptions(root),
    'pluginManager.configPath': configPath,
    history: { inMemory: true },
  };
  const kernel = await bootKernel(configPath, { options });

  t.after(async () => {
    if (kernel.lifecycleState === 'RUNNING') {
      await kernel.shutdown().catch(() => undefined);
    }
  });

  return { kernel, options };
}

async function bootConfig(
  t: TestContext,
  root: string,
  config: BrudConfig,
): Promise<{ readonly kernel: BrudKernel; readonly configPath: string }> {
  const written = await writeConfig(root, config);
  const { kernel } = await bootAt(t, root, written.path);

  return { kernel, configPath: written.path };
}

function brandScope(kernel: BrudKernel, root: string): IBrandScope {
  const registry = kernel.requestAccess<IBrandRegistry>(caller(root), BrandRegistryToken);
  const scope = registry.getScope(PLUGIN_MANAGER_SCOPE_NAME);

  assert.ok(scope, 'plugin manager brand scope must exist after boot');

  return scope;
}

async function isCertified(
  kernel: BrudKernel,
  root: string,
  moduleFile: string,
  exportName = 'plugin',
): Promise<boolean> {
  const namespace = await import(pathToFileURL(moduleFile).href) as Record<string, unknown>;

  return brandScope(kernel, root).verify(namespace[exportName]);
}

function loadedPluginIds(kernel: BrudKernel, root: string): readonly string[] {
  const manager = kernel.requestAccess<IPluginManagerService>(caller(root), PluginManagerToken);

  return manager.listPlugins().map((record) => record.plugin.manifest.id).sort();
}

describe('config authority attacks', () => {
  it('attack 1a: a dependency config claiming itself official is ignored', async (t) => {
    const root = await createWorkspace(t, 'brud-authority-1a-');
    const sentinel = join(root, 'vendor-config-read.sentinel');
    const vendor = await writePluginPackage(join(root, 'vendor-plugin'), { id: 'vendor.plugin' });

    await writeText(
      join(vendor.directory, 'vendor-config-service.mjs'),
      `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(sentinel)}, 'read');
export function createService() {
  return undefined;
}
`,
    );
    await writeText(
      join(vendor.directory, 'brud.config.json'),
      JSON.stringify(
        {
          services: [{ path: './vendor-config-service.mjs', official: true }],
          plugins: [{ path: './index.mjs', official: true }],
        },
        null,
        2,
      ),
    );
    await writeText(
      vendor.packageJsonPath,
      JSON.stringify(
        { name: 'vendor-plugin', version: '1.0.0', type: 'module', main: './index.mjs', brud: { official: true } },
        null,
        2,
      ),
    );

    const { kernel } = await bootConfig(t, root, {
      services: [...await baseServices()],
      plugins: [{ path: vendor.entry }],
    });

    assert.equal(kernel.lifecycleState, 'RUNNING');
    assert.deepEqual(loadedPluginIds(kernel, root), ['vendor.plugin']);
    assert.equal(await isCertified(kernel, root, vendor.entry), false);
    assert.equal(existsSync(sentinel), false, 'vendor package config was read');
  });

  it('attack 1b: an undeclared dependency is refused entirely', async (t) => {
    const root = await createWorkspace(t, 'brud-authority-1b-');
    const vendor = await writePluginPackage(join(root, 'vendor-plugin'), { id: 'vendor.plugin' });

    await writeText(
      join(vendor.directory, 'brud.config.json'),
      JSON.stringify({ services: [], plugins: [{ path: './index.mjs', official: true }] }, null, 2),
    );

    const { kernel } = await bootConfig(t, root, {
      services: [...await baseServices()],
      plugins: [],
    });

    assert.deepEqual(loadedPluginIds(kernel, root), []);
    assert.equal(await isCertified(kernel, root, vendor.entry), false);
  });

  it('attack 2: a dependency cannot certify a sibling dependency', async (t) => {
    const root = await createWorkspace(t, 'brud-authority-2-');
    const siblingDirectory = join(root, 'node_modules', 'another-vendor-lib');
    const sibling = await writePluginPackage(siblingDirectory, { id: 'another.vendor.lib' });
    const vendor = await writePluginPackage(
      join(root, 'vendor-plugin'),
      { id: 'vendor.plugin', dependencies: ['another.vendor.lib'] },
      { dependencies: { 'another-vendor-lib': '1.0.0' } },
    );

    await writeText(
      join(vendor.directory, 'brud.config.json'),
      JSON.stringify(
        {
          services: [],
          plugins: [
            { path: '../node_modules/another-vendor-lib/index.mjs', official: true },
            { path: './index.mjs', official: true },
          ],
        },
        null,
        2,
      ),
    );

    const { kernel } = await bootConfig(t, root, {
      services: [...await baseServices()],
      plugins: [{ path: vendor.entry }, { path: sibling.entry }],
    });

    assert.deepEqual(loadedPluginIds(kernel, root), ['another.vendor.lib', 'vendor.plugin']);
    assert.equal(await isCertified(kernel, root, vendor.entry), false);
    assert.equal(await isCertified(kernel, root, sibling.entry), false);
  });

  it('attack 3: a dependency cannot demote a root-declared official plugin', async (t) => {
    const root = await createWorkspace(t, 'brud-authority-3-');
    const catalog = await writePluginPackage(join(root, 'brud-catalog'), {
      id: 'brud.catalog',
      official: true,
    });
    const vendor = await writePluginPackage(join(root, 'vendor-plugin'), { id: 'vendor.plugin' });

    await writeText(
      join(vendor.directory, 'brud.config.json'),
      JSON.stringify(
        {
          services: [],
          plugins: [
            { path: '../brud-catalog/index.mjs', official: false },
            { path: './index.mjs', official: true },
          ],
        },
        null,
        2,
      ),
    );

    const { kernel } = await bootConfig(t, root, {
      services: [...await baseServices()],
      plugins: [{ path: catalog.entry, official: true }, { path: vendor.entry }],
    });

    assert.equal(await isCertified(kernel, root, catalog.entry), true);
    assert.equal(await isCertified(kernel, root, vendor.entry), false);
    assert.deepEqual(loadedPluginIds(kernel, root), ['brud.catalog', 'vendor.plugin']);
  });

  it('attack 4: a dependency cannot rewrite the root config at runtime', async (t) => {
    const root = await createWorkspace(t, 'brud-authority-4-');
    const configPath = join(root, 'brud.config.json');
    const statusPath = join(root, 'rewrite-status.txt');
    const vendor = await writePluginPackage(join(root, 'vendor-plugin'), {
      id: 'vendor.rewriter',
      imports: 'import { readFileSync, writeFileSync } from \'node:fs\';',
      activateBody: `    let status;
    try {
      const parsed = JSON.parse(readFileSync(${JSON.stringify(configPath)}, 'utf8'));
      parsed.plugins = [{ path: ${JSON.stringify(join(root, 'vendor-plugin', 'index.mjs'))}, official: true }];
      writeFileSync(${JSON.stringify(configPath)}, JSON.stringify(parsed, null, 2));
      status = 'write-succeeded';
    } catch (error) {
      status = 'write-blocked:' + String(error && error.code ? error.code : error);
    }
    writeFileSync(${JSON.stringify(statusPath)}, status);`,
    });

    const { kernel } = await bootConfig(t, root, {
      services: [...await baseServices()],
      plugins: [{ path: vendor.entry }],
    });

    const status = existsSync(statusPath) ? await readFile(statusPath, 'utf8') : 'not-run';

    assert.match(
      status,
      /^write-blocked:/u,
      `dependency's config rewrite was not refused before the write (status=${status})`,
    );
    assert.equal(kernel.lifecycleState, 'RUNNING');
    assert.equal(await isCertified(kernel, root, vendor.entry), false);

    await kernel.shutdown();

    // Simulate a modification that reached the file outside the guarded
    // runtime APIs. The next boot of the same path must reject it.
    await writeText(configPath, JSON.stringify({
      services: [...await baseServices()],
      plugins: [{ path: vendor.entry, official: true }],
    }, null, 2));

    await assert.rejects(
      bootKernel(configPath, {
        options: {
          ...workspaceContextOptions(root),
          'pluginManager.configPath': configPath,
          history: { inMemory: true },
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof BrudConfigError);
        assert.equal(error.code, 'CONFIG_INTEGRITY');
        assert.match(error.message, /changed since it was first read/u);
        return true;
      },
    );
  });

  it('attack 5a: a hash-pinned official entry is not expressible in the current schema', async (t) => {
    const root = await createWorkspace(t, 'brud-authority-5a-');
    const written = await writeConfig(root, {
      services: [...await baseServices()],
      plugins: [
        {
          path: 'official-helper@1.0.0',
          official: true,
          hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        } as unknown as BrudConfigEntry,
      ],
    });

    await assert.rejects(
      bootKernel(written.path, {
        options: {
          ...workspaceContextOptions(root),
          'pluginManager.configPath': written.path,
          history: { inMemory: true },
        },
      }),
      (error: unknown) => {
        // Plugin config validation now belongs to the plugin manager, which
        // imports the public kernel contract through the package. Accept the
        // same contract class from either module instance.
        assert.ok(
          error instanceof BrudConfigError || error instanceof BuiltBrudConfigError,
          'plugin config errors must carry the kernel BrudConfigError contract',
        );
        assert.equal(error.code, 'CONFIG_SCHEMA');
        assert.match(error.message, /unknown key "hash"/u);
        return true;
      },
    );
  });

  it('attack 5b: a workspace imposter cannot shadow a bare official package name', async (t) => {
    const root = await createWorkspace(t, 'brud-authority-5b-');
    const imposter = await writePluginPackage(join(root, 'node_modules', 'official-helper'), {
      id: 'official.helper',
      official: true,
    });
    const written = await writeConfig(root, {
      services: [...await baseServices()],
      plugins: [{ path: 'official-helper', official: true }],
    });

    await assert.rejects(
      bootKernel(written.path, {
        options: {
          ...workspaceContextOptions(root),
          'pluginManager.configPath': written.path,
          history: { inMemory: true },
        },
      }),
      (error: unknown) => {
        assert.ok(
          error instanceof BrudConfigError || error instanceof BuiltBrudConfigError,
          'plugin module errors must carry the kernel BrudConfigError contract',
        );
        assert.equal(error.code, 'MODULE_RESOLVE');
        assert.match(error.message, /official-helper/u);
        return true;
      },
    );

    assert.equal(existsSync(imposter.entry), true);
  });

  it('attack 6: a self-declared loader may reach the manager but cannot certify children', async (t) => {
    const root = await createWorkspace(t, 'brud-authority-6-');
    const statusPath = join(root, 'loader-status.json');
    const childPlainSource = `export const childPlugin = {
  manifest: { id: 'vendor.child', name: 'vendor child', version: '1.0.0', permissions: [] },
  activate() {},
};`;
    const claimedChildSource = `export const claimedChild = {
  manifest: { id: 'vendor.claimed', name: 'claimed child', version: '1.0.0', permissions: [], official: true },
  activate() {},
};`;
    const reservedChildSource = `export const reservedChild = {
  manifest: { id: 'brud.shadow', name: 'shadow child', version: '1.0.0', permissions: [], official: true },
  activate() {},
};`;
    const vendor = await writePluginPackage(
      join(root, 'vendor-plugin'),
      {
        id: 'vendor.loader',
        permissions: ['plugins:manage'],
        imports: 'import { writeFileSync } from \'node:fs\';',
        activateBody: `    const manager = context.resolve('pluginManager');
    const result = {
      resolved: manager !== null,
      plain: 'not-attempted',
      claimed: 'not-attempted',
      reserved: 'not-attempted',
    };
    if (manager !== null) {
      try {
        manager.register(childPlugin);
        result.plain = 'registered';
      } catch (error) {
        result.plain = 'refused:' + String(error && error.name);
      }
      try {
        manager.register(claimedChild);
        result.claimed = 'registered';
      } catch (error) {
        result.claimed = 'refused:' + String(error && error.name);
      }
      try {
        manager.register(reservedChild);
        result.reserved = 'registered';
      } catch (error) {
        result.reserved = 'refused:' + String(error && error.name);
      }
    }
    writeFileSync(${JSON.stringify(statusPath)}, JSON.stringify(result));`,
        extraExports: `${childPlainSource}\n${claimedChildSource}\n${reservedChildSource}`,
      },
      {
        brud: { kind: 'code-loader', capabilities: ['loadChildren'], official: true },
        requiresOfficial: true,
      },
    );

    const { kernel } = await bootConfig(t, root, {
      services: [...await baseServices()],
      plugins: [{ path: vendor.entry }],
    });

    const status = JSON.parse(await readFile(statusPath, 'utf8')) as Record<string, unknown>;
    const namespace = await import(pathToFileURL(vendor.entry).href) as Record<string, unknown>;
    const scope = brandScope(kernel, root);

    assert.equal(await isCertified(kernel, root, vendor.entry), false);
    assert.equal(status.resolved, true, 'observed: a self-declared plugins:manage permission resolves the loader');
    assert.equal(status.claimed, 'refused:PluginAuthorizationError');
    assert.equal(status.reserved, 'refused:PluginAuthorizationError');
    assert.equal(loadedPluginIds(kernel, root).includes('vendor.claimed'), false);
    assert.equal(loadedPluginIds(kernel, root).includes('brud.shadow'), false);

    if (status.plain === 'registered') {
      assert.equal(scope.verify(namespace['childPlugin']), false);
    } else {
      assert.match(String(status.plain), /^refused:/u);
    }
  });

  it('attack 7: package.json metadata cannot grant official status', async (t) => {
    const root = await createWorkspace(t, 'brud-authority-7-');
    const vendor = await writePluginPackage(
      join(root, 'vendor-plugin'),
      { id: 'vendor.metadata' },
      {
        brud: { official: true, requiresOfficial: true },
        requiresOfficial: true,
      },
    );
    await writeText(
      join(vendor.directory, 'brud.config.json'),
      JSON.stringify({ services: [], plugins: [{ path: './index.mjs', official: true }] }, null, 2),
    );

    const { kernel } = await bootConfig(t, root, {
      services: [...await baseServices()],
      plugins: [{ path: vendor.entry }],
    });

    assert.deepEqual(loadedPluginIds(kernel, root), ['vendor.metadata']);
    assert.equal(await isCertified(kernel, root, vendor.entry), false);
  });

  it('attack 8: official status does not flow transitively through a dependency chain', async (t) => {
    const root = await createWorkspace(t, 'brud-authority-8-');
    const a = await writePluginPackage(join(root, 'plugins', 'a'), { id: 'chain.a' });
    const b = await writePluginPackage(join(root, 'plugins', 'b'), {
      id: 'chain.b',
      dependencies: ['chain.a'],
    });
    const c = await writePluginPackage(join(root, 'plugins', 'c'), {
      id: 'chain.c',
      dependencies: ['chain.b'],
    });

    await writeText(
      join(c.directory, 'brud.config.json'),
      JSON.stringify({ services: [], plugins: [{ path: './index.mjs', official: true }] }, null, 2),
    );

    const { kernel } = await bootConfig(t, root, {
      services: [...await baseServices()],
      plugins: [
        { path: a.entry, official: true },
        { path: b.entry },
        { path: c.entry },
      ],
    });

    assert.equal(await isCertified(kernel, root, a.entry), true);
    assert.equal(await isCertified(kernel, root, b.entry), false);
    assert.equal(await isCertified(kernel, root, c.entry), false);
    assert.deepEqual(loadedPluginIds(kernel, root), ['chain.a', 'chain.b', 'chain.c']);
  });

  it('attack 8b: a manifest-level official claim in the chain is refused at registration', async (t) => {
    const root = await createWorkspace(t, 'brud-authority-8b-');
    const a = await writePluginPackage(join(root, 'plugins', 'a'), { id: 'chain.a' });
    const c = await writePluginPackage(join(root, 'plugins', 'c'), {
      id: 'chain.c',
      dependencies: ['chain.a'],
      official: true,
    });
    const written = await writeConfig(root, {
      services: [...await baseServices()],
      plugins: [{ path: a.entry, official: true }, { path: c.entry }],
    });

    await assert.rejects(
      bootKernel(written.path, {
        options: {
          ...workspaceContextOptions(root),
          'pluginManager.configPath': written.path,
          history: { inMemory: true },
        },
      }),
      (error: unknown) => {
        const candidate = error as { readonly code?: unknown; readonly reason?: unknown };

        assert.equal(candidate.code, 'PLUGIN_AUTHORIZATION');
        assert.equal(candidate.reason, 'OFFICIAL_STATUS');
        return true;
      },
    );
  });

  it('attack 9: a config inside a package becomes authority when the host points at it', async (t) => {
    const root = await createWorkspace(t, 'brud-authority-9-');
    const vendor = await writePluginPackage(join(root, 'vendor-plugin'), {
      id: 'vendor.plugin',
      official: true,
    });
    const packageConfigPath = join(vendor.directory, 'brud.config.json');

    await writeText(
      packageConfigPath,
      JSON.stringify(
        {
          services: [...await baseServices()],
          plugins: [{ path: './index.mjs', official: true }],
        },
        null,
        2,
      ),
    );

    const { kernel } = await bootAt(t, root, packageConfigPath);

    assert.equal(kernel.lifecycleState, 'RUNNING');
    assert.equal(await isCertified(kernel, root, vendor.entry), true);
    assert.deepEqual(loadedPluginIds(kernel, root), ['vendor.plugin']);
  });

  it('attack 10: two package-level configs are never read', async (t) => {
    const root = await createWorkspace(t, 'brud-authority-10-');
    const sentinelA = join(root, 'vendor-a-read.sentinel');
    const vendorA = await writePluginPackage(join(root, 'vendor-a'), { id: 'vendor.a' });
    const vendorB = await writePluginPackage(join(root, 'vendor-b'), { id: 'vendor.b' });

    await writeText(
      join(vendorA.directory, 'should-not-load.mjs'),
      `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(sentinelA)}, 'read');
export function createService() {
  throw new Error('vendor-a config was read');
}
`,
    );
    await writeText(
      join(vendorA.directory, 'brud.config.json'),
      JSON.stringify(
        {
          services: [{ path: './should-not-load.mjs', official: true }],
          plugins: [{ path: './index.mjs', official: true }],
        },
        null,
        2,
      ),
    );
    await writeText(join(vendorB.directory, 'brud.config.json'), '{ this is not valid json');

    const { kernel } = await bootConfig(t, root, {
      services: [...await baseServices()],
      plugins: [],
    });

    assert.equal(kernel.lifecycleState, 'RUNNING');
    assert.deepEqual(loadedPluginIds(kernel, root), []);
    assert.equal(existsSync(sentinelA), false, 'vendor-a package config was read');
    assert.equal(existsSync(join(vendorA.entry)), true);
    assert.equal(existsSync(join(vendorB.entry)), true);
  });
});