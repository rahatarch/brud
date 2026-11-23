import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { bootKernel, type BrudConfig } from '../bootstrap/index.js';
import { provisionIdentityRegistryStorage } from '../../services/IdentityRegistry/index.js';
import { workspaceContextOptions } from './support/workspaceContext.js';

const KERNEL_CONFIG = fileURLToPath(new URL('../../brud.config.json', import.meta.url));

describe('a second boot in the same process after the root config changed', () => {
  it('is refused with CONFIG_INTEGRITY, because the config digest lives for the whole process', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'brud-reboot-'));
    const workspaceRoot = join(root, 'workspace');
    const registryPath = join(root, 'registry.json');
    const configPath = join(root, 'brud.config.json');

    await mkdir(workspaceRoot, { recursive: true });
    provisionIdentityRegistryStorage(registryPath);
    t.after(() => rm(root, { recursive: true, force: true }));

    const base = JSON.parse(await readFile(KERNEL_CONFIG, 'utf8')) as BrudConfig;
    const options = { ...workspaceContextOptions(workspaceRoot), 'identity.registry.path': registryPath, history: { inMemory: true } };
    const attempt = async (): Promise<string> => {
      try {
        await (await bootKernel(configPath, { options })).shutdown();

        return 'booted';
      } catch (error) {
        return (error as { code?: string }).code ?? 'failed';
      }
    };

    await writeFile(configPath, JSON.stringify({ services: base.services, plugins: [] }, null, 2));
    assert.equal(await attempt(), 'booted');
    assert.equal(await attempt(), 'booted', 'an unchanged config boots again');

    await writeFile(configPath, JSON.stringify({ services: base.services, plugins: [] }, null, 4));

    assert.equal(await attempt(), 'CONFIG_INTEGRITY', 'a changed config is refused until the process restarts');
  });
});
