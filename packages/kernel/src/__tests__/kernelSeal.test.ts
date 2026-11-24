import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { bootKernel, createSeal, type SealReference } from '../bootstrap/index.js';
import { writeComposition, type FixtureComposition, type FixtureParticipant } from './support/participantFixture.js';

const GUEST = `(module
  (memory (export "memory") 1)
  (func (export "brud_alloc") (param i32) (result i32) (i32.const 1024))
  (func (export "brud_invoke") (param i32 i32) (result i64) (i64.const 0)))`;

const caged = (token: string): FixtureParticipant => ({
  token,
  package: { wat: GUEST, manifest: { requests: { capabilities: [] }, exposures: [], events: [] } },
});

/** What a builder does at release time: generate the seal and keep its digest. */
async function seal(composition: FixtureComposition): Promise<SealReference> {
  const created = createSeal(composition.configPath);
  const path = join(dirname(composition.configPath), 'brud.seal.json');

  await writeFile(path, created.text, 'utf8');

  return { path, digest: created.digest };
}

const has = (kernel: { listServices(): readonly { id: string }[] }, id: string): boolean => kernel.listServices().some((service) => service.id === id);

describe('the build seal fixes what the builder shipped', () => {
  it('boots a composition that matches its seal, and a reload keeps working', async (t) => {
    const composition = await writeComposition(t, [{ token: 'seal.native' }]);
    const reference = await seal(composition);
    const kernel = await bootKernel(composition.configPath, { options: composition.options, seal: reference });

    composition.kernels.push(kernel);

    assert.equal(kernel.lifecycleState, 'RUNNING');
    assert.equal(kernel.abandoned.length, 0);

    const config = JSON.parse(await readFile(composition.configPath, 'utf8')) as { services: unknown[] };
    const extra = (JSON.parse(await readFile((await writeComposition(t, [caged('seal.added')])).configPath, 'utf8')) as { services: unknown[] }).services.at(-1);

    const next = join(dirname(composition.configPath), 'brud.next.json');

    await writeFile(next, JSON.stringify({ services: [...config.services, extra] }), 'utf8');

    const reloaded = await kernel.reload({ configPath: next });

    composition.kernels.push(reloaded);

    assert.equal(has(reloaded, 'seal.added'), true);
  });

  it('refuses a seal file that is not the one the product was built with', async (t) => {
    const composition = await writeComposition(t, [{ token: 'seal.native' }]);
    const reference = await seal(composition);

    await writeFile(reference.path, `${await readFile(reference.path, 'utf8')} `, 'utf8');

    await assert.rejects(
      () => bootKernel(composition.configPath, { options: composition.options, seal: reference }),
      (error: Error & { code?: string }) => error.code === 'SEAL_MISMATCH',
    );
  });

  it('refuses a sealed participant whose content changed', async (t) => {
    const composition = await writeComposition(t, [{ token: 'seal.native' }]);
    const reference = await seal(composition);
    const module = join(dirname(composition.configPath), 'participant-0.mjs');

    await writeFile(module, `${await readFile(module, 'utf8')}\n// changed after the build\n`, 'utf8');

    await assert.rejects(
      () => bootKernel(composition.configPath, { options: composition.options, seal: reference }),
      (error: Error & { code?: string }) => error.code === 'SEAL_VIOLATION' && /no longer matches/u.test(error.message),
    );
  });

  it('refuses a config that drops a sealed participant', async (t) => {
    const composition = await writeComposition(t, [{ token: 'seal.native' }]);
    const reference = await seal(composition);
    const config = JSON.parse(await readFile(composition.configPath, 'utf8')) as { services: { path: string }[] };

    await writeFile(composition.configPath, JSON.stringify({ services: config.services.slice(0, -1) }), 'utf8');

    await assert.rejects(
      () => bootKernel(composition.configPath, { options: composition.options, seal: reference }),
      (error: Error & { code?: string }) => error.code === 'SEAL_VIOLATION',
    );
  });

  it('leaves out a participant that declares itself official without being sealed', async (t) => {
    const composition = await writeComposition(t, [{ token: 'seal.native' }]);
    const reference = await seal(composition);
    const intruder = join(dirname(composition.configPath), 'intruder.mjs');
    const config = JSON.parse(await readFile(composition.configPath, 'utf8')) as { services: unknown[] };

    await writeFile(intruder, await readFile(join(dirname(composition.configPath), 'participant-0.mjs'), 'utf8'), 'utf8');
    await writeFile(composition.configPath, JSON.stringify({ services: [...config.services, { path: intruder, official: true }] }), 'utf8');

    const kernel = await bootKernel(composition.configPath, { options: composition.options, seal: reference });

    composition.kernels.push(kernel);

    assert.equal(kernel.lifecycleState, 'RUNNING');
    assert.equal(kernel.abandoned.length, 1);
    assert.equal(kernel.abandoned[0]?.code, 'PARTICIPANT_NOT_SEALED');
    assert.match(kernel.abandoned[0]?.reason ?? '', /only a rebuild can make a participant official/u);
  });

  it('boots a composition with no seal as before', async (t) => {
    const composition = await writeComposition(t, [{ token: 'seal.native' }]);
    const kernel = await bootKernel(composition.configPath, { options: composition.options });

    composition.kernels.push(kernel);

    assert.equal(kernel.lifecycleState, 'RUNNING');
  });

  it('seals both official and unofficial bundled participants in the composition', async (t) => {
    const composition = await writeComposition(t, [{ token: 'seal.official' }, caged('seal.bundled')]);
    const reference = await seal(composition);
    const kernel = await bootKernel(composition.configPath, { options: composition.options, seal: reference });

    composition.kernels.push(kernel);

    assert.equal(kernel.lifecycleState, 'RUNNING');
    assert.equal(kernel.abandoned.length, 0);
    assert.equal(has(kernel, 'seal.official'), true);
    assert.equal(has(kernel, 'seal.bundled'), true);

    const sealDoc = JSON.parse(await readFile(reference.path, 'utf8')) as {
      participants: { path: string; official?: boolean; sha256?: string }[];
    };
    const officialEntry = sealDoc.participants.find((p) => p.path.includes('participant-0'));
    const bundledEntry = sealDoc.participants.find((p) => p.path.includes('participant-1'));

    assert.equal(officialEntry?.official, true);
    assert.equal(bundledEntry?.official, undefined);
    assert.ok(typeof bundledEntry?.sha256 === 'string');
  });

  it('refuses boot when a bundled unofficial participant is modified on disk', async (t) => {
    const composition = await writeComposition(t, [{ token: 'seal.official' }, caged('seal.bundled')]);
    const reference = await seal(composition);
    const bundledPackage = join(dirname(composition.configPath), 'participant-1', 'brud.participant.json');

    const manifest = JSON.parse(await readFile(bundledPackage, 'utf8')) as Record<string, unknown>;
    await writeFile(bundledPackage, JSON.stringify({ ...manifest, description: 'tampered after build' }), 'utf8');

    await assert.rejects(
      () => bootKernel(composition.configPath, { options: composition.options, seal: reference }),
      (error: Error & { code?: string }) => error.code === 'SEAL_VIOLATION' && /no longer matches/u.test(error.message),
    );
  });

  it('refuses boot when a bundled unofficial participant claims official: true in config', async (t) => {
    const composition = await writeComposition(t, [{ token: 'seal.official' }, caged('seal.bundled')]);
    const reference = await seal(composition);
    const config = JSON.parse(await readFile(composition.configPath, 'utf8')) as { services: { path: string; official?: boolean }[] };

    const modifiedServices = config.services.map((s) => (s.path.includes('participant-1') ? { ...s, official: true } : s));
    await writeFile(composition.configPath, JSON.stringify({ services: modifiedServices }), 'utf8');

    await assert.rejects(
      () => bootKernel(composition.configPath, { options: composition.options, seal: reference }),
      (error: Error & { code?: string }) => error.code === 'SEAL_VIOLATION' && /official status in config \(true\) does not match build seal \(false\)/u.test(error.message),
    );
  });
});
