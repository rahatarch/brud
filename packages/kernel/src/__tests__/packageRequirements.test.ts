import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { bootKernel } from '../bootstrap/index.js';
import { BrudConfigError } from '../bootstrap/config/index.js';
import { provisionIdentityRegistryStorage } from '../../services/IdentityRegistry/index.js';
import { safeRm } from './support/cleanup.js';

const HARDCORES = ['identityRegistry', 'exposedApiRegistry', 'parser', 'router', 'wasmCage', 'events', 'interception']
  .map((name) => ({ path: `kernel:serviceModules/${name}.js`, official: true }));
const CONTRACTS = pathToFileURL(join(import.meta.dirname, '..', 'contracts', 'index.js')).href;

const NATIVE_SOURCE = `import { createServiceToken } from ${JSON.stringify(CONTRACTS)};
const token = createServiceToken('trial.fs', 'A participant that needs host powers');
export function createService() {
  return { token, tier: 'userland', dependencies: [], manifest: { requests: { capabilities: [] } }, factory: () => ({}) };
}
`;

/** Boots a composition holding one package entry with the given `requires` and officialness. */
async function bootPackage(t: TestContext, requires: unknown, official: boolean) {
  const dir = await mkdtemp(join(tmpdir(), 'brud-requires-'));
  let booted: Awaited<ReturnType<typeof bootKernel>> | undefined;
  t.after(async () => {
    if (booted?.lifecycleState === 'RUNNING') {
      await booted.shutdown();
    }

    await safeRm(dir);
  });
  await writeFile(join(dir, 'native.mjs'), NATIVE_SOURCE);
  await writeFile(join(dir, 'participant.wasm'), Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
  await writeFile(join(dir, 'brud.participant.json'), JSON.stringify({
    format: 1,
    id: 'trial.fs',
    manifest: { requests: { capabilities: [] } },
    cage: { module: 'participant.wasm', sha256: '0'.repeat(64) },
    native: 'native.mjs',
    ...(requires === undefined ? {} : { requires }),
  }));
  await writeFile(join(dir, 'brud.config.json'), JSON.stringify({
    services: [...HARDCORES, { path: './brud.participant.json', official }],
  }));
  const registry = join(dir, 'identity.json');
  provisionIdentityRegistryStorage(registry);

  booted = await bootKernel(join(dir, 'brud.config.json'), { options: { 'identity.registry.path': registry } });

  return booted;
}

describe('package requirements: a package can refuse to load unless it is official', () => {
  it('leaves out an entry the owner left unofficial, naming the powers it uses', async (t) => {
    const kernel = await bootPackage(t, { official: true, powers: ['process', 'filesystem', 'process'] }, false);
    const left = kernel.abandoned[0];

    assert.equal(left?.code, 'PARTICIPANT_REQUIRES_OFFICIAL');
    assert.ok(left?.reason.includes('It uses: filesystem, process.'));
    assert.ok(left?.reason.includes('"official": true'));
  });

  it('leaves it out even when the package also ships a caged build', async (t) => {
    const kernel = await bootPackage(t, { official: true }, false);

    assert.equal(kernel.abandoned[0]?.code, 'PARTICIPANT_REQUIRES_OFFICIAL');
  });

  it('loads its native build once the owner declares the entry official', async (t) => {
    const kernel = await bootPackage(t, { official: true, powers: ['filesystem'] }, true);
    assert.equal(kernel.lifecycleState, 'RUNNING');
  });

  it('never grants officialness: a package without `requires` is left out for its own reason', async (t) => {
    const kernel = await bootPackage(t, undefined, false);

    assert.equal(kernel.abandoned.length, 1);
    assert.notEqual(kernel.abandoned[0]?.code, 'PARTICIPANT_REQUIRES_OFFICIAL');
  });

  it('rejects a malformed requires section with a coded error', async (t) => {
    for (const requires of [{ official: false }, { official: true, powers: ['root'] }, { official: true, extra: 1 }, 'yes']) {
      await assert.rejects(
        bootPackage(t, requires, true),
        (error: unknown) => error instanceof BrudConfigError && error.code === 'MODULE_RESOLVE' && error.message.includes('requires'),
      );
    }
  });
});
