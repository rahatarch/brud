import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { bootKernel, type AbandonedParticipant } from '../bootstrap/index.js';
import { writeComposition, type FixtureComposition, type FixtureParticipant } from './support/participantFixture.js';

const GUEST = `(module
  (memory (export "memory") 1)
  (func (export "brud_alloc") (param i32) (result i32) (i32.const 1024))
  (func (export "brud_invoke") (param i32 i32) (result i64) (i64.const 0)))`;

const pkg = (token: string, manifest: Record<string, unknown> = {}): FixtureParticipant => ({
  token,
  package: { wat: GUEST, manifest: { requests: { capabilities: [] }, exposures: [], events: [], ...manifest } },
});

/** Breaks a participant package so its module no longer matches its digest. */
async function tamper(composition: FixtureComposition, index: number): Promise<void> {
  const file = join(dirname(composition.configPath), `participant-${String(index)}`, 'participant.wasm');

  await writeFile(file, `${await readFile(file, 'utf8')} `, 'utf8');
}

const has = (kernel: { listServices(): readonly { id: string }[] }, id: string): boolean => kernel.listServices().some((service) => service.id === id);

describe('a loaded participant that cannot start never stops the kernel', () => {
  it('leaves out the one bad participant and boots the rest', async (t) => {
    const composition = await writeComposition(t, [pkg('tol.good'), pkg('tol.bad')]);

    await tamper(composition, 1);

    const kernel = await bootKernel(composition.configPath, { options: composition.options });

    composition.kernels.push(kernel);

    assert.equal(kernel.lifecycleState, 'RUNNING');
    assert.equal(has(kernel, 'tol.good'), true);
    assert.equal(has(kernel, 'tol.bad'), false);
    assert.equal(kernel.abandoned.length, 1);
    assert.match(kernel.abandoned[0]?.path ?? '', /participant-1/u);
    assert.match(kernel.abandoned[0]?.reason ?? '', /digest check/u);
  });

  it('boots as shipped when its only loaded participant is bad', async (t) => {
    const composition = await writeComposition(t, [pkg('tol.only')]);

    await tamper(composition, 0);

    const kernel = await bootKernel(composition.configPath, { options: composition.options });

    composition.kernels.push(kernel);

    assert.equal(kernel.lifecycleState, 'RUNNING');
    assert.equal(has(kernel, 'tol.only'), false);
    assert.equal(kernel.abandoned.length, 1);
  });

  it('names every participant it left out, once each, in the warning it logs', async (t) => {
    const composition = await writeComposition(t, [pkg('tol.a'), pkg('tol.b'), pkg('tol.c')]);
    const warnings: string[] = [];

    await tamper(composition, 0);
    await tamper(composition, 2);

    const kernel = await bootKernel(composition.configPath, {
      options: composition.options,
      logger: { warn: (message) => { warnings.push(message); } },
    });

    composition.kernels.push(kernel);

    assert.deepEqual(kernel.abandoned.map((entry: AbandonedParticipant) => entry.path.includes('participant-0') ? 'a' : 'c').sort(), ['a', 'c']);
    assert.equal(has(kernel, 'tol.b'), true);
    assert.equal(warnings.filter((line) => line.includes('Left out 2 loaded participant(s)')).length, 1);
    assert.ok(warnings.some((line) => line.includes('participant-0') && line.includes('participant-2')));
  });

  it('leaves out a participant that depends on one that was left out', async (t) => {
    const composition = await writeComposition(t, [
      pkg('tol.guard', { requests: { capabilities: [] }, interceptions: [{ target: 'tol.point', stages: ['input'] }] }),
      pkg('tol.giver', { exposures: [{ name: 'tol.point', version: 1, scope: 'any' }], interceptionPoints: [{ exposure: 'tol.point', version: 1, admit: ['tol.guard'] }] }),
      pkg('tol.bystander'),
    ]);

    await tamper(composition, 0);

    const kernel = await bootKernel(composition.configPath, { options: composition.options });

    composition.kernels.push(kernel);

    assert.equal(has(kernel, 'tol.bystander'), true);
    assert.equal(has(kernel, 'tol.giver'), false);
    assert.equal(kernel.abandoned.length, 2);
    assert.ok(kernel.abandoned.some((entry) => entry.participant === 'tol.giver' && /tol\.guard/u.test(entry.reason)));
  });

  it('still refuses the boot when a composed (official) participant is broken', async (t) => {
    const composition = await writeComposition(t, [pkg('tol.fine')]);
    const config = JSON.parse(await readFile(composition.configPath, 'utf8')) as { services: { path: string; official?: boolean }[] };

    await writeFile(composition.configPath, JSON.stringify({ services: [...config.services, { path: join(dirname(composition.configPath), 'missing-module.mjs'), official: true }] }), 'utf8');

    await assert.rejects(() => bootKernel(composition.configPath, { options: composition.options }), (error: Error & { code?: string }) => error.code === 'MODULE_RESOLVE');
  });
});

describe('a reload with loaded participants that cannot start', () => {
  it('loads the good new ones, leaves out the bad ones and names them', async (t) => {
    const first = await writeComposition(t, [pkg('tol.one')]);
    const next = await writeComposition(t, [pkg('tol.two'), pkg('tol.broken'), pkg('tol.three')]);

    await tamper(next, 1);

    const kernel = await bootKernel(first.configPath, { options: first.options });

    first.kernels.push(kernel);

    const reloaded = await kernel.reload({ configPath: next.configPath });

    first.kernels.push(reloaded);

    assert.equal(kernel.lifecycleState, 'DISPOSED');
    assert.equal(reloaded.lifecycleState, 'RUNNING');
    assert.equal(has(reloaded, 'tol.two'), true);
    assert.equal(has(reloaded, 'tol.three'), true);
    assert.equal(has(reloaded, 'tol.broken'), false);
    assert.equal(reloaded.abandoned.length, 1);
  });

  it('boots as shipped when the only new participant is bad', async (t) => {
    const first = await writeComposition(t, [pkg('tol.keep')]);
    const next = await writeComposition(t, [pkg('tol.new')]);

    await tamper(next, 0);

    const kernel = await bootKernel(first.configPath, { options: first.options });

    first.kernels.push(kernel);

    const reloaded = await kernel.reload({ configPath: next.configPath });

    first.kernels.push(reloaded);

    assert.equal(reloaded.lifecycleState, 'RUNNING');
    assert.equal(has(reloaded, 'tol.new'), false);
    assert.equal(reloaded.abandoned.length, 1);
  });
});

describe('a failure that cannot be traced to one loaded participant', () => {
  it('leaves out every loaded participant once, and boots as shipped', async (t) => {
    const event = { events: [{ name: 'tol.clash', version: 1, scope: 'runtime' }] };
    const composition = await writeComposition(t, [pkg('tol.left', event), pkg('tol.right', event)]);
    const kernel = await bootKernel(composition.configPath, { options: composition.options });

    composition.kernels.push(kernel);

    assert.equal(kernel.lifecycleState, 'RUNNING');
    assert.equal(kernel.abandoned.length, 2);
    assert.ok(kernel.abandoned.every((entry) => /could not be traced/u.test(entry.reason)));
  });
});
