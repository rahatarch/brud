import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExposedApiRegistryToken, bootKernel, provisionIdentityRegistryStorage } from '../../index.js';
import { writeParticipantPackage } from './support/participantFixture.js';

const HARDCORES = ['identityRegistry', 'exposedApiRegistry', 'parser', 'router', 'wasmCage', 'events', 'interception']
  .map((name) => ({ path: `kernel:serviceModules/${name}.js`, official: true }));

const RESPONSE = JSON.stringify({ ok: true, value: { status: 'success', data: { caged: true } } });
const wat = (text: string): string => `"${text.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;

/** A caged giver whose every invoke answers one fixed success result. */
const GUEST = `(module
  (memory (export "memory") 1)
  (data (i32.const 1024) ${wat(RESPONSE)})
  (func (export "brud_alloc") (param i32) (result i32) (i32.const 8192))
  (func (export "brud_invoke") (param i32 i32) (result i64)
    (i64.or (i64.shl (i64.const 1024) (i64.const 32)) (i64.const ${String(Buffer.byteLength(RESPONSE))}))))`;

describe('declared kinds (manifest.kinds) — production mirror', () => {
  it('lets a caged, non-official participant claim a kind and serve it through its own exposure', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'brud-declared-kinds-'));
    const identity = join(root, 'identity.json');
    provisionIdentityRegistryStorage(identity);
    const manifest = {
      requests: { capabilities: [] },
      exposures: [{ name: 'caged.kind', version: 1, scope: 'any' }],
      kinds: [{
        kind: 'caged',
        exposure: 'caged.kind',
        description: 'A caged demo kind',
        permission: { policyVersion: 2 },
        operations: { hello: { description: 'Says hello', input: { type: 'object' } } },
      }],
      events: [],
    };
    const packagePath = await writeParticipantPackage(join(root, 'caged'), 'acme.caged', manifest, GUEST);
    const config = join(root, 'brud.config.json');
    await writeFile(config, JSON.stringify({ services: [...HARDCORES, { path: packagePath }] }), 'utf8');

    const kernel = await bootKernel(config, { options: { 'identity.registry.path': identity } });
    t.after(async () => {
      await kernel.shutdown();
      await rm(root, { recursive: true, force: true });
    });

    const result = await kernel.runHostCall({ capabilities: [] }, () => {
      const registry = kernel.requestAccess({ callerId: 'acme.host', tier: 'core', options: {} }, ExposedApiRegistryToken);
      const syntax = registry.resolve<{
        route(text: string): Promise<unknown>;
        registeredKinds(): readonly string[];
        kinds(): readonly unknown[];
      }>('syntax.route');
      assert.ok(syntax !== null);
      assert.deepEqual(syntax.registeredKinds(), ['caged']);
      // The public vocabulary carries the declared description and operations.
      assert.deepEqual(JSON.parse(JSON.stringify(syntax.kinds())), [{
        kind: 'caged',
        description: 'A caged demo kind',
        operations: { hello: { description: 'Says hello', input: { type: 'object' } } },
      }]);

      return syntax.route('[BRUD]\n[CALL caged hello]\nx: 1\n[END]\n[/BRUD]');
    }) as { status: string; operations: { status: string; result?: unknown }[] };

    assert.equal(result.status, 'success');
    assert.deepEqual(result.operations[0]?.result, { status: 'success', data: { caged: true } });
  });

  it('leaves out a participant whose kind names an exposure it does not declare', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'brud-declared-kinds-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const identity = join(root, 'identity.json');
    provisionIdentityRegistryStorage(identity);
    const packagePath = await writeParticipantPackage(join(root, 'caged'), 'acme.caged', {
      requests: { capabilities: [] }, exposures: [], kinds: [{ kind: 'caged', exposure: 'someone.else' }], events: [],
    }, GUEST);
    const config = join(root, 'brud.config.json');
    await writeFile(config, JSON.stringify({ services: [...HARDCORES, { path: packagePath }] }), 'utf8');

    const kernel = await bootKernel(config, { options: { 'identity.registry.path': identity } });

    try {
      assert.equal(kernel.abandoned.length, 1);
      assert.equal(kernel.abandoned[0]?.code, 'PARTICIPANT_MANIFEST_INVALID');
    } finally {
      await kernel.shutdown();
    }
  });

  it('leaves out a participant whose kind description is not plain data', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'brud-declared-kinds-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const identity = join(root, 'identity.json');
    provisionIdentityRegistryStorage(identity);
    const packagePath = await writeParticipantPackage(join(root, 'caged'), 'acme.caged', {
      requests: { capabilities: [] },
      exposures: [{ name: 'caged.kind', version: 1, scope: 'any' }],
      kinds: [{ kind: 'caged', exposure: 'caged.kind', operations: { hello: { input: 'not-a-schema' } } }],
      events: [],
    }, GUEST);
    const config = join(root, 'brud.config.json');
    await writeFile(config, JSON.stringify({ services: [...HARDCORES, { path: packagePath }] }), 'utf8');

    const kernel = await bootKernel(config, { options: { 'identity.registry.path': identity } });

    try {
      assert.equal(kernel.abandoned.length, 1);
      assert.equal(kernel.abandoned[0]?.code, 'PARTICIPANT_MANIFEST_INVALID');
    } finally {
      await kernel.shutdown();
    }
  });
});
