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
import { workspaceContextOptions } from './support/workspaceContext.js';

/** The kernel package's own composition: the seven hardcore services and nothing else. */
const KERNEL_CONFIG_PATH = fileURLToPath(new URL('../../brud.config.json', import.meta.url));

const HARDCORES = ['identityRegistry', 'exposedApiRegistry', 'parser', 'router', 'wasmCage', 'events', 'interception']
  .map((name) => ({ path: `kernel:serviceModules/${name}.js`, official: true }));

function caller(root: string): ServiceContext {
  return { callerId: 'kernel', tier: 'core', options: {...workspaceContextOptions(root)} };
}

/** Kernels to stop before their workspace is removed (the root config is protected while running). */
const running = new WeakMap<TestContext, BrudKernel[]>();

async function workspace(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'brud-boot-config-'));

  t.after(async () => {
    for (const kernel of running.get(t) ?? []) {
      if (kernel.lifecycleState === 'RUNNING') {
        await kernel.shutdown().catch(() => undefined);
      }
    }

    await rm(root, { recursive: true, force: true });
  });

  return root;
}

function track(t: TestContext, kernel: BrudKernel): void {
  running.set(t, [...(running.get(t) ?? []), kernel]);
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
  const kernel = await bootKernel(configPath, { options: { ...workspaceContextOptions(root) } });

  track(t, kernel);

  return { kernel, root };
}

describe('bootKernel config composition', () => {
  it('boots a composition of only the hardcore services', async (t) => {
    const { kernel } = await boot(t, { services: HARDCORES, plugins: [] });

    assert.equal(kernel.lifecycleState, 'RUNNING');
  });

  it('fails with the missing module and config position', async (t) => {
    const root = await workspace(t);
    const configPath = await writeConfig(root, {
      services: [{ path: 'kernel:serviceModules/doesNotExist.js', official: true }],
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

  it('boots the kernel package\'s own composition to RUNNING', async (t) => {
    const root = await workspace(t);
    const kernel = await bootKernel(KERNEL_CONFIG_PATH, { options: { ...workspaceContextOptions(root) } });

    track(t, kernel);

    assert.equal(kernel.lifecycleState, 'RUNNING');
  });

  it('refuses a composition that omits a hardcore service, naming it', async (t) => {
    const root = await workspace(t);
    const configPath = await writeConfig(root, {
      services: HARDCORES.filter((entry) => !entry.path.endsWith('/parser.js')),
      plugins: [],
    });

    await assert.rejects(
      bootKernel(configPath, { options: { ...workspaceContextOptions(root) } }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);

        assert.match(message, /parser|brud\.core\.parser/iu);
        return true;
      },
    );
  });

  it('refuses a native module that is not declared official', async (t) => {
    const root = await workspace(t);
    const configPath = await writeConfig(root, {
      services: [{ path: 'kernel:serviceModules/router.js' }],
      plugins: [],
    });

    await assert.rejects(
      bootKernel(configPath, { options: { ...workspaceContextOptions(root) } }),
      (error: unknown) => {
        assert.ok(error instanceof BrudConfigError);
        assert.equal(error.code, 'PARTICIPANT_TIER');
        assert.match(error.message, /not declared official/u);
        return true;
      },
    );
  });
});
