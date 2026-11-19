// Boots the BUILT kernel (dist/) the way an npm consumer does: the seven
// hardcores, a native user service and a caged user service written in a
// separate folder, then calls the caged service from the native one.
//
//   node scripts/smoke-dist.mjs [path-to-kernel-package]   (defaults to this package)
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkg = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const kernel = await import(pathToFileURL(join(pkg, 'dist/index.js')).href);
const cageIndex = pathToFileURL(join(pkg, 'dist/services/WasmCage/index.js')).href;
const work = mkdtempSync(join(tmpdir(), 'brud-smoke-dist-'));
const POINT = 'smoke.caged.echo';
const ECHO = `(module
  (memory (export "memory") 2)
  (data (i32.const 0) "{\\"ok\\":true,\\"value\\":")
  (func (export "brud_alloc") (param i32) (result i32) (i32.const 1024))
  (func (export "brud_invoke") (param $p i32) (param $l i32) (result i64)
    (memory.copy (i32.const 65536) (i32.const 0) (i32.const 19))
    (memory.copy (i32.const 65555) (local.get $p) (local.get $l))
    (i32.store8 (i32.add (i32.const 65555) (local.get $l)) (i32.const 125))
    (i64.or (i64.shl (i64.const 65536) (i64.const 32))
      (i64.extend_i32_u (i32.add (local.get $l) (i32.const 20))))))`;

try {
  writeFileSync(join(work, 'caged.mjs'), `import { createCagedParticipant } from ${JSON.stringify(cageIndex)};
export function createService() {
  return createCagedParticipant({
    token: 'smoke.caged',
    manifest: { requests: { capabilities: [] }, exposures: [{ name: '${POINT}', version: 1, scope: 'any' }], events: [] },
    wasm: new TextEncoder().encode(${JSON.stringify(ECHO)}),
  });
}
`);
  writeFileSync(join(work, 'user.mjs'), `const token = { id: 'smoke.user', description: 'smoke user', _brand: undefined };
const REGISTRY = { id: ${JSON.stringify(kernel.ExposedApiRegistryToken.id)}, description: 'registry', _brand: undefined };
export function createService() {
  return {
    token, tier: 'userland', dependencies: [],
    manifest: { requests: { capabilities: [] }, exposures: [], events: [] },
    factory: () => ({
      onRunning(broker) {
        const registry = broker.requestAccess({ callerId: token.id, tier: 'userland', options: {} }, REGISTRY);
        globalThis.__smoke = registry.resolve('${POINT}').echo('hello');
      },
    }),
  };
}
`);
  const services = ['identityRegistry', 'exposedApiRegistry', 'parser', 'router', 'wasmCage', 'events', 'interception']
    .map((name) => ({ path: `kernel:serviceModules/${name}.js`, official: true }));

  services.push({ path: join(work, 'caged.mjs') }, { path: join(work, 'user.mjs') });
  writeFileSync(join(work, 'brud.config.json'), JSON.stringify({ services }));
  kernel.provisionIdentityRegistryStorage(join(work, 'id.json'));

  const booted = await kernel.bootKernel(join(work, 'brud.config.json'), {
    options: { 'identity.registry.path': join(work, 'id.json'), 'router.root': work },
  });

  assert.equal(booted.lifecycleState, 'RUNNING');
  assert.deepEqual(globalThis.__smoke?.args, ['hello']);
  assert.equal(typeof globalThis.__smoke?.caller?.identity, 'string');
  await booted.shutdown();
  console.log('smoke-dist: built kernel booted; native user service called caged user service');
} finally {
  rmSync(work, { recursive: true, force: true });
}
