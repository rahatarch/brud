import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootKernel, provisionIdentityRegistryStorage } from '../../index.js';

const HARDCORES = ['identityRegistry', 'exposedApiRegistry', 'parser', 'router', 'wasmCage', 'events', 'interception']
  .map((name) => ({ path: `kernel:serviceModules/${name}.js`, official: true }));

/** A giver whose token is restricted to `kernel` and `acme.host`. */
const GUARDED = `
const token = { id: 'acme.guarded', description: 'guarded', _brand: undefined };
export function createService() {
  return { token, tier: 'core', dependencies: [], accessPolicy: { allowedCallers: ['kernel', 'acme.host'] },
    manifest: { requests: { capabilities: [] }, exposures: [], events: [] },
    factory: () => ({ secret: () => 'secret' }) };
}`;

/** A participant with no capabilities that tries to claim other identities. */
const IMPOSTOR = `
const token = { id: 'acme.impostor', description: 'impostor', _brand: undefined };
const attempt = (fn) => { try { return { ok: typeof fn() }; } catch (error) { return { code: error.code ?? error.name }; } };
export function createService() {
  return { token, tier: 'userland', dependencies: [],
    manifest: { requests: { capabilities: [] }, exposures: [], events: [] },
    factory: () => ({ async onRunning(broker) {
      const guarded = { id: 'acme.guarded', description: '', _brand: undefined };
      const cage = { id: 'brud.core.wasmCage', description: '', _brand: undefined };
      globalThis.__brokerBinding = {
        asKernel: attempt(() => broker.requestAccess({ callerId: 'kernel', tier: 'kernel', options: {} }, guarded)),
        asHost: attempt(() => broker.requestAccess({ callerId: 'acme.host', tier: 'core', options: {} }, guarded)),
        asSelf: attempt(() => broker.requestAccess({ callerId: 'acme.impostor', tier: 'userland', options: {} }, guarded)),
        cage: attempt(() => broker.requestAccess({ callerId: 'kernel', tier: 'kernel', options: {} }, cage)),
      };
    } }) };
}`;

describe('access broker binds caller ids to the kernel call chain', () => {
  it('refuses a participant that claims another identity, and keeps the cage kernel-only', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'brud-broker-binding-'));
    const guarded = join(root, 'guarded.mjs');
    const impostor = join(root, 'impostor.mjs');
    await writeFile(guarded, GUARDED, 'utf8');
    await writeFile(impostor, IMPOSTOR, 'utf8');
    const identity = join(root, 'identity.json');
    provisionIdentityRegistryStorage(identity);
    const config = join(root, 'brud.config.json');
    await writeFile(config, JSON.stringify({ services: [...HARDCORES, { path: guarded, official: true }, { path: impostor, official: true }] }), 'utf8');

    const kernel = await bootKernel(config, { options: { 'identity.registry.path': identity, 'router.root': root } });
    t.after(async () => {
      await kernel.shutdown();
      await rm(root, { recursive: true, force: true });
    });

    const report = (globalThis as { __brokerBinding?: Record<string, { ok?: string; code?: string }> }).__brokerBinding;

    assert.deepEqual(report, {
      asKernel: { code: 'CALLER_IDENTITY_MISMATCH' },
      asHost: { code: 'CALLER_IDENTITY_MISMATCH' },
      asSelf: { code: 'NOT_IN_ALLOWLIST' },
      cage: { code: 'CALLER_IDENTITY_MISMATCH' },
    });
    // Host process code outside any chain keeps its explicit path.
    assert.equal(kernel.requestAccess({ callerId: 'acme.host', tier: 'core', options: {} }, { id: 'acme.guarded', description: '', _brand: undefined } as never) !== undefined, true);
  });
});
