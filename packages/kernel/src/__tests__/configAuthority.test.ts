/**
 * Config authority attacks against the kernel's own composition file: what a
 * workspace or a config entry can and cannot claim. (The plugin-config variants
 * of these attacks moved with the plugin manager; see deprecated/.)
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { bootKernel, BrudConfigError } from '../bootstrap/index.js';
import type { BrudConfig, BrudConfigEntry } from '../bootstrap/index.js';
import { workspaceContextOptions } from './support/workspaceContext.js';

const HARDCORES: readonly BrudConfigEntry[] = ['identityRegistry', 'exposedApiRegistry', 'parser', 'router', 'wasmCage', 'events', 'interception']
  .map((name) => ({ path: `kernel:serviceModules/${name}.js`, official: true }));

async function createWorkspace(t: TestContext, prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  return root;
}

async function writeConfig(root: string, config: BrudConfig): Promise<string> {
  const path = join(root, 'brud.config.json');

  await writeFile(path, JSON.stringify(config, null, 2), 'utf8');

  return path;
}

describe('config authority attacks', () => {
  it('attack 5a: a hash-pinned official entry is not expressible in the current schema', async (t) => {
    const root = await createWorkspace(t, 'brud-authority-5a-');
    const configPath = await writeConfig(root, {
      services: [
        ...HARDCORES,
        {
          path: 'official-helper@1.0.0',
          official: true,
          hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        } as unknown as BrudConfigEntry,
      ],
      plugins: [],
    });

    await assert.rejects(
      bootKernel(configPath, { options: { ...workspaceContextOptions(root) } }),
      (error: unknown) => {
        assert.ok(error instanceof BrudConfigError);
        assert.equal(error.code, 'CONFIG_SCHEMA');
        assert.match(error.message, /unknown key "hash"/u);
        return true;
      },
    );
  });

  it('attack 5b: a workspace imposter cannot shadow a bare official package name', async (t) => {
    const root = await createWorkspace(t, 'brud-authority-5b-');
    const imposterDirectory = join(root, 'node_modules', 'official-helper');

    await mkdir(imposterDirectory, { recursive: true });
    await writeFile(join(imposterDirectory, 'index.mjs'), 'export const createService = () => { throw new Error("imposter ran"); };\n', 'utf8');
    await writeFile(
      join(imposterDirectory, 'package.json'),
      JSON.stringify({ name: 'official-helper', version: '1.0.0', type: 'module', main: './index.mjs' }),
      'utf8',
    );

    const configPath = await writeConfig(root, {
      services: [...HARDCORES, { path: 'official-helper', official: true }],
      plugins: [],
    });

    await assert.rejects(
      bootKernel(configPath, { options: { ...workspaceContextOptions(root) } }),
      (error: unknown) => {
        assert.ok(error instanceof BrudConfigError);
        assert.equal(error.code, 'MODULE_RESOLVE');
        assert.match(error.message, /official-helper/u);
        assert.doesNotMatch(error.message, /imposter ran/u);
        return true;
      },
    );
  });
});
