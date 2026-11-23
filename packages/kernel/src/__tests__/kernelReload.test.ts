import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { bootKernel, type BrudConfig, type ReloadableKernel } from '../bootstrap/index.js';
import { writeComposition, type FixtureParticipant } from './support/participantFixture.js';

const GUEST = `(module
  (memory (export "memory") 1)
  (func (export "brud_alloc") (param i32) (result i32) (i32.const 1024))
  (func (export "brud_invoke") (param i32 i32) (result i64) (i64.const 0)))`;

const caged = (token: string): FixtureParticipant => ({
  token,
  package: { wat: GUEST, manifest: { requests: { capabilities: [] }, exposures: [], events: [] } },
});

const has = (kernel: ReloadableKernel, id: string): boolean => kernel.listServices().some((service) => service.id === id);

async function running(t: Parameters<typeof writeComposition>[0], participants: readonly FixtureParticipant[]) {
  const composition = await writeComposition(t, participants);
  const kernel = await bootKernel(composition.configPath, { options: composition.options });

  composition.kernels.push(kernel);

  return { composition, kernel };
}

describe('a host reloads the kernel with a changed composition', () => {
  it('replaces the unofficial participants and returns the new running kernel', async (t) => {
    const first = await running(t, [caged('reload.one')]);
    const second = await writeComposition(t, [caged('reload.two')]);

    assert.equal(has(first.kernel, 'reload.one'), true);

    const next = await first.kernel.reload({ configPath: second.configPath });

    first.composition.kernels.push(next);

    assert.equal(first.kernel.lifecycleState, 'DISPOSED');
    assert.equal(next.lifecycleState, 'RUNNING');
    assert.equal(has(next, 'reload.two'), true);
    assert.equal(has(next, 'reload.one'), false);
  });

  it('accepts the same file after it was edited, and can reload again', async (t) => {
    const { composition, kernel } = await running(t, [caged('reload.a')]);
    const config = JSON.parse(await readFile(composition.configPath, 'utf8')) as BrudConfig;
    const added = (await writeComposition(t, [caged('reload.b')])).configPath;
    const extra = (JSON.parse(await readFile(added, 'utf8')) as BrudConfig).services.at(-1);

    assert.ok(extra !== undefined);

    // The host edits its own file only between kernels: reload writes nothing,
    // so the edit happens after the old kernel's protection is released.
    const edited = await kernel.reload({ configPath: added });

    composition.kernels.push(edited);
    await writeFile(composition.configPath, JSON.stringify({ services: [...config.services, extra] }), 'utf8');

    const again = await edited.reload({ configPath: composition.configPath });

    composition.kernels.push(again);

    assert.equal(again.lifecycleState, 'RUNNING');
    assert.equal(has(again, 'reload.b'), true);
  });

  it('refuses a changed official entry and stops nothing', async (t) => {
    const { composition, kernel } = await running(t, [caged('reload.keep')]);
    const target = await writeComposition(t, [caged('reload.keep')]);
    const config = JSON.parse(await readFile(target.configPath, 'utf8')) as BrudConfig;

    await writeFile(target.configPath, JSON.stringify({ services: config.services.slice(1) }), 'utf8');

    await assert.rejects(
      () => kernel.reload({ configPath: target.configPath }),
      (error: Error & { code?: string }) => error.code === 'CONFIG_RELOAD_FROZEN' && /Rebuild/u.test(error.message),
    );
    assert.equal(kernel.lifecycleState, 'RUNNING');
    assert.equal(has(kernel, 'reload.keep'), true);
    assert.equal(composition.kernels.length, 1);
  });

  it('refuses an invalid composition and stops nothing', async (t) => {
    const { kernel } = await running(t, [caged('reload.safe')]);
    const target = await writeComposition(t, []);

    await writeFile(target.configPath, '{ not json', 'utf8');

    await assert.rejects(() => kernel.reload({ configPath: target.configPath }), (error: Error & { code?: string }) => error.code === 'CONFIG_PARSE');
    assert.equal(kernel.lifecycleState, 'RUNNING');
  });

  it('refuses when the kernel is not running', async (t) => {
    const { kernel } = await running(t, []);
    const second = await writeComposition(t, []);

    await kernel.shutdown();

    await assert.rejects(() => kernel.reload({ configPath: second.configPath }), (error: Error & { code?: string }) => error.code === 'INVALID_LIFECYCLE_STATE');
  });
});
