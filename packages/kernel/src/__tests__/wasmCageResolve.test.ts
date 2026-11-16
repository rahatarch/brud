import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { bootKernel, type BrudKernel } from '../bootstrap/index.js';
import type { ServiceContext } from '../contracts/lifecycle.js';
import { WasmCageToken } from '../../services/WasmCage/index.js';
import { provisionIdentityRegistryStorage } from '../../services/IdentityRegistry/index.js';

/**
 * Production-mirror: a caged participant's `resolve` reaches the registry with
 * runtime origin, its identity, and its parent relation, after the cage's boot
 * hook has bound the authority.
 */
describe('WASM cage resolve, end to end', () => {
  it('forwards a caged resolve through the registry after the hook binds', async (t: TestContext) => {
    const root = await mkdtemp(join(tmpdir(), 'brud-cage-resolve-'));
    t.after(async () => { await rm(root, { recursive: true, force: true }); });

    const identityPath = join(root, 'identity-registry.json');
    provisionIdentityRegistryStorage(identityPath);

    const configPath = join(root, 'brud.config.json');
    await writeFile(configPath, JSON.stringify({
      services: [
        { path: 'kernel:serviceModules/identityRegistry.js', official: true },
        { path: 'kernel:serviceModules/exposedApiRegistry.js', official: true },
        { path: 'kernel:serviceModules/parser.js', official: true },
        { path: 'kernel:serviceModules/router.js', official: true },
        { path: 'kernel:serviceModules/wasmCage.js', official: true },
        { path: 'kernel:serviceModules/events.js', official: true },
      ],
    }, null, 2), 'utf8');

    let kernel: BrudKernel | undefined;
    try {
      kernel = await bootKernel(configPath, {
        options: { 'identity.registry.path': identityPath, 'router.root': root },
      });
      assert.equal(kernel.lifecycleState, 'RUNNING');

      const caller: ServiceContext = { callerId: 'kernel', tier: 'core', options: {} };


      // After boot the hook has bound the authority; resolve no longer returns
      // null for an absent exposure, it returns null for "no such exposure"
      // through the registry. The difference: before binding it returns null
      // without consulting the registry; after, the registry refuses it.
      // The cage's own identity was issued and recorded at boot; read it from
      // the real on-disk registry so runAsOrigin resolves a live caller.
      await kernel.shutdown();
      const stored = JSON.parse(await readFile(identityPath, 'utf8')) as {
        readonly records: readonly { readonly token: string; readonly publisher: string }[];
      };
      const cageRecord = stored.records.find((record) => record.publisher === 'brud.core.wasmCage');
      assert.ok(cageRecord !== undefined, 'the cage has an issued identity on disk');

      // Re-boot so the test observes the running kernel, then call resolve with
      // the cage's own live identity.
      kernel = await bootKernel(configPath, {
        options: { 'identity.registry.path': identityPath, 'router.root': root },
      });
      const rebornCage = kernel.requestAccess(caller, WasmCageToken);

      const observationsBefore = kernel.readObservations().filter(
        (record) => record.event === 'resolve-refused',
      ).length;
      const result = rebornCage.resolve(cageRecord.token, 'cage.absent.exposure');
      const observationsAfter = kernel.readObservations().filter(
        (record) => record.event === 'resolve-refused',
      ).length;

      assert.equal(result, null);
      assert.equal(
        observationsAfter,
        observationsBefore + 1,
        'the registry recorded the refusal, so the cage reached the registry',
      );
      const refusal = kernel.readObservations()
        .filter((record) => record.event === 'resolve-refused')
        .at(-1);
      assert.equal(refusal?.detail['name'], 'cage.absent.exposure');
    } finally {
      if (kernel !== undefined && kernel.lifecycleState === 'RUNNING') {
        await kernel.shutdown();
      }
    }
  });
});