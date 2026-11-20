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




describe('config authority attacks', () => {

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
});