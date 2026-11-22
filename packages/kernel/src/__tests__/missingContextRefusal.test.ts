/**
 * A missing required context field refuses the boot for every participant
 * (defect items 13 and 8). There is no pruning: a participant that declared a
 * field as required never runs without it, official or not, depended on or
 * not. Proven on real booted kernels with throwaway participants.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { bootKernel, ContextContractError, ExposedApiRegistryToken, type IExposedApiRegistry } from '../../index.js';
import { writeComposition, type FixtureComposition } from './support/participantFixture.js';

interface Need {
  readonly id: string;
  readonly scope: string;
  readonly field: string;
  /** Native participants run only when official (W-01), so every test participant is. */
  readonly official?: boolean;
  readonly exposes?: string;
}

/** A participant that requires `field` and, once running, gives one open exposure. */
const needing = ({ id, scope, field, exposes }: Need): string => `export function createService(context) {
  context.declareContextFields(${JSON.stringify(scope)}, [{ name: ${JSON.stringify(field)}, type: 'string', required: true, description: 'needed' }]);
  const token = { id: ${JSON.stringify(id)}, description: ${JSON.stringify(id)}, _brand: undefined };
  return {
    token, tier: 'userland', dependencies: [],
    manifest: { requests: { capabilities: [] }, exposures: [${exposes === undefined ? '' : `{ name: ${JSON.stringify(exposes)}, version: 1, scope: 'any' }`}], events: [] },
    factory: () => {
      const instance = {};
      Object.defineProperty(instance, 'provideExposure', {
        value: (name, major) => name === ${JSON.stringify(exposes ?? '')} && major === 1 ? { projection: () => ({ hello: () => 'hello' }) } : null,
        enumerable: false,
      });
      return instance;
    },
  };
}
`;

async function compose(t: Parameters<typeof writeComposition>[0], needs: readonly Need[]): Promise<FixtureComposition> {
  return writeComposition(t, needs.map((need) => ({
    token: need.id,
    source: needing(need),
    ...(need.official === undefined ? {} : { official: need.official }),
  })));
}

const refused = (composition: FixtureComposition, extra: Readonly<Record<string, unknown>> = {}): Promise<ContextContractError> =>
  bootKernel(composition.configPath, { options: { ...composition.options, ...extra } }).then(
    () => { throw new Error('the boot was expected to be refused'); },
    (error: unknown) => {
      assert.ok(error instanceof ContextContractError, `unexpected ${String(error)}`);

      return error;
    },
  );

describe('Missing required context field: refusal for everyone', () => {
  it('refuses an official participant that nothing depends on (the old pruning case), naming the participant, module, scope and field (item 13)', async (t) => {
    const composition = await compose(t, [{ id: 'acme.files', scope: 'acmefs', field: 'acmefs.root', official: true }]);
    const error = await refused(composition);

    assert.equal(error.field, 'acmefs.root');
    assert.match(error.message, /Boot refused/);
    assert.match(error.message, /acmefs\.root/);
    assert.match(error.message, /scope "acmefs"/);
    assert.match(error.message, /acme\.files/);
    assert.match(error.message, /participant-0\.mjs/);
  });

  it('refuses the whole boot even when every other participant is fine: no partial composition', async (t) => {
    const composition = await compose(t, [
      { id: 'acme.fine', scope: 'finefs', field: 'finefs.root', exposes: 'acme.fine.hello' },
      { id: 'acme.files', scope: 'acmefs', field: 'acmefs.root' },
    ]);
    const error = await refused(composition, { 'finefs.root': '/ok' });

    assert.equal(error.field, 'acmefs.root');
    assert.doesNotMatch(error.message, /finefs/, 'the satisfied participant is not blamed');
  });

  it('reports every missing field of every owner in one refusal', async (t) => {
    const composition = await compose(t, [
      { id: 'acme.one', scope: 'one', field: 'one.root' },
      { id: 'acme.two', scope: 'two', field: 'two.root' },
      { id: 'acme.three', scope: 'three', field: 'three.root' },
    ]);
    const error = await refused(composition);

    for (const field of ['one.root', 'two.root', 'three.root']) {
      assert.match(error.message, new RegExp(field.replace('.', '\\.')));
    }

    for (const id of ['acme.one', 'acme.two', 'acme.three']) {
      assert.match(error.message, new RegExp(id.replace('.', '\\.')));
    }
  });

  it('refuses a value in the wrong shape, and says so (item 8)', async (t) => {
    const composition = await compose(t, [{ id: 'acme.files', scope: 'acmefs', field: 'acmefs.root' }]);

    for (const extra of [
      { acmefs: { root: '/x' } },
      { 'acmefs.Root': '/x' },
      { 'acmefs.root ': '/x' },
    ]) {
      const error = await refused(composition, extra);

      assert.equal(error.field, 'acmefs.root', JSON.stringify(extra));
      assert.match(error.message, /Boot refused/);
    }
  });

  it('names a flat alias as a flat alias, not as a missing field', async (t) => {
    const composition = await compose(t, [{ id: 'acme.files', scope: 'acmefs', field: 'acmefs.root' }]);
    const error = await refused(composition, { acmefsRoot: '/x' });

    assert.equal(error.field, 'acmefsRoot');
    assert.match(error.message, /Un-namespaced/);
  });

  it('refuses a value of the wrong type, as before', async (t) => {
    const composition = await compose(t, [{ id: 'acme.files', scope: 'acmefs', field: 'acmefs.root' }]);
    const error = await refused(composition, { 'acmefs.root': 42 });

    assert.equal(error.field, 'acmefs.root');
    assert.equal(error.actualType, 'number');
  });

  it('treats an explicitly undefined value as missing', async (t) => {
    const composition = await compose(t, [{ id: 'acme.files', scope: 'acmefs', field: 'acmefs.root' }]);
    const error = await refused(composition, { 'acmefs.root': undefined });

    assert.equal(error.field, 'acmefs.root');
  });

  it('boots, keeps every exposure, and records no pruning when the field is supplied', async (t) => {
    const composition = await compose(t, [{ id: 'acme.files', scope: 'acmefs', field: 'acmefs.root', exposes: 'acme.files.hello' }]);
    const kernel = await bootKernel(composition.configPath, { options: { ...composition.options, 'acmefs.root': '/ok' } });

    composition.kernels.push(kernel);

    const registry = kernel.requestAccess<IExposedApiRegistry>({ callerId: 'acme.host', tier: 'core', options: {} }, ExposedApiRegistryToken);
    const handle = kernel.runHostCall({ capabilities: [] }, () => registry.resolve<{ projection(): { hello(): string } }>('acme.files.hello'));

    assert.notEqual(handle, null, 'the exposure is there');
    assert.equal(kernel.readObservations().some((record) => record.event === 'participant-pruned'), false);
  });

  it('never boots at all after a refusal: the same composition boots once the field is supplied', async (t) => {
    const composition = await compose(t, [{ id: 'acme.files', scope: 'acmefs', field: 'acmefs.root' }]);

    await refused(composition);

    const kernel = await bootKernel(composition.configPath, { options: { ...composition.options, 'acmefs.root': '/ok' } });

    composition.kernels.push(kernel);
    assert.equal(kernel.lifecycleState, 'RUNNING');
  });
});

describe('Missing required context field: scale', () => {
  it('reports 40 owners that each miss a field in one refusal, within budget', async (t) => {
    const needs = Array.from({ length: 40 }, (_, index): Need => ({ id: `acme.p${String(index)}`, scope: `scope${String(index)}`, field: `scope${String(index)}.root` }));
    const composition = await compose(t, needs);
    const started = performance.now();
    const error = await refused(composition);
    const elapsed = performance.now() - started;

    for (const need of needs) {
      assert.ok(error.message.includes(need.field), `${need.field} is reported`);
    }

    assert.ok(error.message.length < 50_000, `the refusal stays readable (${String(error.message.length)} characters)`);
    assert.ok(elapsed < 20_000, `refusal took ${elapsed.toFixed(0)} ms`);
  });
});
