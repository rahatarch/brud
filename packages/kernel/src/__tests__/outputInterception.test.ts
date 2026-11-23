/**
 * The output stage of interception: after a giver returns, the interceptors
 * its point admits and that declared the stage may append content to the
 * result, and nothing else. Proven on real booted kernels with throwaway
 * participants and caged guests.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { ParticipantManifestError, admitParticipantManifest, bootKernel } from '../../index.js';
import { InterceptionDeclarationError } from '../../services/Interception/index.js';
import {
  bootComposition,
  fixtureReports,
  resetFixtureReports,
  writeComposition,
  type FixtureParticipant,
} from './support/participantFixture.js';

const POINT = 'acme.ship.rate';
const ORIGINAL = { price: 12, currency: 'EUR', tags: ['a', 'b'] };

/** An output-stage interceptor. `body` is the source of `interceptResult`. */
function output(token: string, body: string, stages: readonly string[] = ['output']): FixtureParticipant {
  return { token, interceptions: [{ target: POINT, stages }], interceptResult: body };
}

/** The giver: returns ORIGINAL and runs the output stage on it, reporting the outcome. */
function giver(admit: readonly string[], limits?: Record<string, number>): FixtureParticipant {
  return {
    token: 'acme.ship',
    exposures: [{ name: POINT, version: 1, scope: 'any' }],
    interceptionPoints: [{ exposure: POINT, admit: [...admit], ...(limits === undefined ? {} : { outputLimits: limits }) }],
    bindings: `{ '${POINT}@1': (caller) => ({
      rate: (...args) => {
        const original = ${JSON.stringify(ORIGINAL)};
        const outcome = report.evaluate.evaluateResult('${POINT}@1', 'rate', args, original, { caller });
        report.last = outcome;
        return outcome.applied ? outcome : original;
      },
      bench: (count) => {
        let last;
        for (let index = 0; index < count; index += 1) {
          last = report.evaluate.evaluateResult('${POINT}@1', 'rate', [], ${JSON.stringify(ORIGINAL)}, { caller });
        }
        return last;
      },
      rateWith: (result) => report.evaluate.evaluateResult('${POINT}@1', 'rate', [], result, { caller }),
    }) }`,
    onRunning: "report.evaluate = registry.resolve('interception.evaluate');",
  };
}

type Outcome = {
  applied: boolean;
  allowed?: boolean;
  reason?: string;
  interceptor?: string;
  envelope?: { result: unknown; additions: { interceptor: string; content: unknown }[]; interceptedBy: string[]; skipped: { interceptor: string; reason: string }[] };
};

async function run(t: Parameters<typeof writeComposition>[0], participants: readonly FixtureParticipant[], ask = "report.out = registry.resolve('" + POINT + "').rate('x');") {
  resetFixtureReports();

  const composition = await writeComposition(t, [...participants, { token: 'acme.asker', onRunning: ask }]);
  const kernel = await bootComposition(composition);

  return { kernel, report: fixtureReports()['acme.asker'] as Record<string, unknown> & { out: Outcome } };
}

describe('Output interception: append only', () => {
  it('collects each interceptor\'s addition in the giver order, attributed, with the result as returned', async (t) => {
    const { report } = await run(t, [
      output('acme.a', `(call) => ({ verdict: 'append', content: { from: 'a', seen: call.result.price } })`),
      output('acme.b', `(call) => ({ verdict: 'append', content: ['b'] })`),
      giver(['acme.b', 'acme.a']),
    ]);
    const envelope = report.out.envelope;

    assert.deepEqual(envelope?.result, ORIGINAL);
    assert.deepEqual(envelope?.additions, [
      { interceptor: 'acme.b', content: ['b'] },
      { interceptor: 'acme.a', content: { from: 'a', seen: 12 } },
    ]);
    assert.deepEqual(envelope?.interceptedBy, ['acme.b', 'acme.a']);
  });

  it('lists an interceptor that added nothing among those that ran', async (t) => {
    const { report } = await run(t, [
      output('acme.quiet', `() => ({ verdict: 'none' })`),
      giver(['acme.quiet']),
    ]);

    assert.deepEqual(report.out.envelope?.additions, []);
    assert.deepEqual(report.out.envelope?.interceptedBy, ['acme.quiet']);
  });

  it('cannot change the result: the copy every interceptor sees is deep-frozen and is the result returned', async (t) => {
    const { report } = await run(t, [
      output('acme.tamper', `(call) => {
        const attempts = {};
        for (const [name, run] of Object.entries({
          price: () => { call.result.price = 0; },
          push: () => call.result.tags.push('x'),
          drop: () => { delete call.result.currency; },
          replace: () => { call.result = null; },
        })) { try { run(); attempts[name] = 'allowed'; } catch (error) { attempts[name] = error.name; } }
        (globalThis.__attempts ??= []).push(attempts);
        return { verdict: 'none' };
      }`),
      output('acme.after', `(call) => ({ verdict: 'append', content: { price: call.result.price, tags: call.result.tags } })`),
      giver(['acme.tamper', 'acme.after']),
    ]);

    assert.deepEqual((globalThis as { __attempts?: unknown[] }).__attempts?.[0], { price: 'TypeError', push: 'TypeError', drop: 'TypeError', replace: 'TypeError' });
    assert.deepEqual(report.out.envelope?.result, ORIGINAL);
    assert.deepEqual(report.out.envelope?.additions[0]?.content, { price: 12, tags: ['a', 'b'] }, 'the next interceptor still sees the original');
    assert.equal(Object.isFrozen(report.out.envelope), true);
    assert.equal(Object.isFrozen(report.out.envelope?.result), true);
    assert.equal(Object.isFrozen(report.out.envelope?.additions[0]?.content), true);
  });

  it('shows each interceptor only the original result, never another\'s addition', async (t) => {
    const { report } = await run(t, [
      output('acme.one', `() => ({ verdict: 'append', content: 'first' })`),
      output('acme.two', `(call) => ({ verdict: 'append', content: Object.keys(call).sort() })`),
      giver(['acme.one', 'acme.two']),
    ]);

    assert.deepEqual(report.out.envelope?.additions[1]?.content, ['args', 'caller', 'method', 'result', 'target']);
  });

  it('has no way to block, replace or remove: any other verdict is skipped and the result is delivered', async (t) => {
    for (const verdict of [
      `{ verdict: 'block', reason: 'no' }`,
      `{ verdict: 'replace', result: 1 }`,
      `{ verdict: 'modify', args: [] }`,
      `{ verdict: 'allow' }`,
      `{ verdict: 'append' }`,
      `{ append: 'x' }`,
      `'append'`,
      `null`,
    ]) {
      const { report } = await run(t, [output('acme.bad', `() => (${verdict})`), giver(['acme.bad'])]);

      assert.equal(report.out.allowed, true, verdict);
      assert.deepEqual(report.out.envelope?.result, ORIGINAL, `${verdict}: the giver's result is delivered unchanged`);
      assert.deepEqual(report.out.envelope?.additions, [], verdict);
      assert.equal(report.out.envelope?.skipped[0]?.interceptor, 'acme.bad', verdict);
      assert.match(report.out.envelope?.skipped[0]?.reason ?? '', /can only append/, verdict);
    }
  });
});

describe('Output interception: stages and ownership', () => {
  it('returns the result as before when no admitted interceptor declares the output stage', async (t) => {
    const { report } = await run(t, [
      { token: 'acme.input-only', interceptions: [{ target: POINT, stages: ['input'] }], intercept: `() => ({ verdict: 'allow' })` },
      giver(['acme.input-only']),
    ]);

    assert.deepEqual(report.out, ORIGINAL as unknown as Outcome, 'the giver returned its own result');
    assert.deepEqual((fixtureReports()['acme.ship']?.last as Outcome), { applied: false });
  });

  it('calls an interceptor only in the stages it declared', async (t) => {
    resetFixtureReports();
    (globalThis as { __stageCalls?: string[] }).__stageCalls = [];

    const calls = '(globalThis.__stageCalls ??= [])';
    const both = { token: 'acme.both', interceptions: [{ target: POINT, stages: ['input', 'output'] }], intercept: `() => { ${calls}.push('both:input'); return { verdict: 'allow' }; }`, interceptResult: `() => { ${calls}.push('both:output'); return { verdict: 'none' }; }` };
    const onlyOut = output('acme.out', `() => { ${calls}.push('out:output'); return { verdict: 'none' }; }`);
    const onlyIn = { token: 'acme.in', interceptions: [{ target: POINT, stages: ['input'] }], intercept: `() => { ${calls}.push('in:input'); return { verdict: 'allow' }; }`, interceptResult: `() => { ${calls}.push('in:WRONG'); return { verdict: 'none' }; }` };
    const point = giver(['acme.both', 'acme.out', 'acme.in']);
    const inputToo = { ...point, bindings: (point.bindings ?? '').replace("const outcome =", "report.evaluate.evaluate('" + POINT + "@1', 'rate', args, { caller }); const outcome =") };

    await bootComposition(await writeComposition(t, [both, onlyOut, onlyIn, inputToo, { token: 'acme.asker', onRunning: `registry.resolve('${POINT}').rate('x');` }]));

    assert.deepEqual((globalThis as { __stageCalls?: string[] }).__stageCalls, ['both:input', 'in:input', 'both:output', 'out:output']);
  });

  it('takes part in the output stage only when it declares no stages: input must be asked for', async (t) => {
    resetFixtureReports();
    (globalThis as { __stageCalls?: string[] }).__stageCalls = [];

    const calls = '(globalThis.__stageCalls ??= [])';
    const plain = {
      token: 'acme.plain',
      interceptions: [{ target: POINT }],
      intercept: `() => { ${calls}.push('plain:input'); return { verdict: 'block', reason: 'no' }; }`,
      interceptResult: `() => { ${calls}.push('plain:output'); return { verdict: 'none' }; }`,
    };
    const point = giver(['acme.plain']);
    const inputToo = { ...point, bindings: (point.bindings ?? '').replace('const outcome =', "report.evaluate.evaluate('" + POINT + "@1', 'rate', args, { caller }); const outcome =") };

    await bootComposition(await writeComposition(t, [plain, inputToo, { token: 'acme.asker', onRunning: `registry.resolve('${POINT}').rate('x');` }]));

    assert.deepEqual((globalThis as { __stageCalls?: string[] }).__stageCalls, ['plain:output']);
  });

  it('skips an interceptor whose declared output stage is not implemented', async (t) => {
    const { report } = await run(t, [
      { token: 'acme.lazy', interceptions: [{ target: POINT, stages: ['output'] }] },
      giver(['acme.lazy']),
    ]);

    assert.equal(report.out.allowed, true);
    assert.deepEqual(report.out.envelope?.result, ORIGINAL);
    assert.match(report.out.envelope?.skipped[0]?.reason ?? '', /does not implement interceptResult/);
  });

  it('refuses anyone but the point owner', async (t) => {
    const { report } = await run(t, [
      output('acme.a', `() => ({ verdict: 'append', content: 'x' })`),
      giver(['acme.a']),
    ], `const evaluate = registry.resolve('interception.evaluate');
        report.out = evaluate.evaluateResult('${POINT}@1', 'rate', [], { price: 1 });
        report.unknown = evaluate.evaluateResult('nope@1', 'rate', [], { price: 1 });`);

    assert.equal(report.out.allowed, false);
    assert.match(report.out.reason ?? '', /only the interception point owner/);
    assert.match((report.unknown as unknown as Outcome).reason ?? '', /unknown interception point/);
  });
});

describe('Output interception: fail closed and limits', () => {
  it('skips an interceptor that throws, naming it, and keeps the other additions and the result', async (t) => {
    const { report } = await run(t, [
      output('acme.fine', `() => ({ verdict: 'append', content: 'ok' })`),
      output('acme.boom', `() => { throw new Error('exploded'); }`),
      giver(['acme.fine', 'acme.boom']),
    ]);

    assert.equal(report.out.allowed, true);
    assert.deepEqual(report.out.envelope?.result, ORIGINAL);
    assert.deepEqual(report.out.envelope?.additions, [{ interceptor: 'acme.fine', content: 'ok' }]);
    assert.deepEqual(report.out.envelope?.interceptedBy, ['acme.fine']);
    assert.equal(report.out.envelope?.skipped[0]?.interceptor, 'acme.boom');
    assert.match(report.out.envelope?.skipped[0]?.reason ?? '', /exploded/);
  });

  it('skips content that is not plain JSON', async (t) => {
    for (const content of ['() => 1', 'undefined', 'NaN', 'new Date()', 'Symbol("s")', '10n', '{ get x() { return 1; } }']) {
      const { report } = await run(t, [output('acme.bad', `() => ({ verdict: 'append', content: ${content} })`), giver(['acme.bad'])]);

      assert.equal(report.out.allowed, true, content);
      assert.deepEqual(report.out.envelope?.additions, [], content);
      assert.equal(report.out.envelope?.skipped.length, 1, content);
    }
  });

  it('skips the stage for a result that is not plain JSON, before any interceptor sees it', async (t) => {
    resetFixtureReports();
    (globalThis as { __seen?: number }).__seen = 0;

    const { report } = await run(t, [
      output('acme.a', `() => { globalThis.__seen += 1; return { verdict: 'none' }; }`),
      giver(['acme.a']),
    ], `report.out = registry.resolve('${POINT}').rateWith(() => 1);
       report.loop = (() => { const a = {}; a.self = a; return registry.resolve('${POINT}').rateWith(a); })();`);

    assert.equal(report.out.applied, false, 'the giver ships its own result');
    assert.equal((report.loop as unknown as Outcome).applied, false);
    assert.equal((globalThis as { __seen?: number }).__seen, 0);
  });

  it('enforces the kernel ceilings: one addition, all additions together, and the result', async (t) => {
    const big = (bytes: number): string => `() => ({ verdict: 'append', content: 'x'.repeat(${String(bytes)}) })`;

    const oneTooBig = await run(t, [output('acme.a', big(70_000)), giver(['acme.a'])]);

    assert.match(oneTooBig.report.out.envelope?.skipped[0]?.reason ?? '', /addition is \d+ bytes; the limit is 65536/);
    assert.deepEqual(oneTooBig.report.out.envelope?.result, ORIGINAL);

    const together = await run(t, [
      output('acme.a', big(60_000)), output('acme.b', big(60_000)), output('acme.c', big(60_000)),
      output('acme.d', big(60_000)), output('acme.e', big(60_000)), giver(['acme.a', 'acme.b', 'acme.c', 'acme.d', 'acme.e']),
    ]);

    assert.deepEqual(together.report.out.envelope?.skipped.map((entry) => entry.interceptor), ['acme.e'], 'the addition that would cross the total is the one skipped');
    assert.match(together.report.out.envelope?.skipped[0]?.reason ?? '', /additions together would exceed 262144/);
    assert.equal(together.report.out.envelope?.additions.length, 4);

    const result = await run(t, [output('acme.a', `() => ({ verdict: 'none' })`), giver(['acme.a'])],
      `report.out = registry.resolve('${POINT}').rateWith({ blob: 'x'.repeat(1100000) });`);

    assert.equal(result.report.out.applied, false, 'a result over the ceiling skips the stage and is shipped as it is');
  });

  it('lets the point owner lower a limit, and refuses the boot for any value that would raise or break one', async (t) => {
    const lowered = await run(t, [output('acme.a', `() => ({ verdict: 'append', content: 'x'.repeat(50) })`), giver(['acme.a'], { maxAdditionBytes: 20 })]);

    assert.match(lowered.report.out.envelope?.skipped[0]?.reason ?? '', /the limit is 20/);

    for (const limits of [
      { maxAdditionBytes: 65_537 }, { maxTotalBytes: 262_145 }, { maxResultBytes: 1_048_577 },
      { maxAdditionBytes: 0 }, { maxAdditionBytes: -1 }, { maxAdditionBytes: 1.5 },
      { maxAdditionBytes: 'big' as unknown as number }, { maxBytes: 10 },
      { maxAdditionBytes: 5_000, maxTotalBytes: 100 },
    ]) {
      resetFixtureReports();

      const composition = await writeComposition(t, [output('acme.a', `() => ({ verdict: 'none' })`), giver(['acme.a'], limits)]);

      await assert.rejects(
        bootKernel(composition.configPath, { options: composition.options }),
        (error: unknown) => error instanceof InterceptionDeclarationError,
        JSON.stringify(limits),
      );
    }
  });

  it('is cheap: 2,000 results through three interceptors in budget', async (t) => {
    const { report } = await run(t, [
      output('acme.a', `(call) => ({ verdict: 'append', content: { n: call.result.price } })`),
      output('acme.b', `() => ({ verdict: 'none' })`),
      output('acme.c', `() => ({ verdict: 'append', content: 'c' })`),
      giver(['acme.a', 'acme.b', 'acme.c']),
    ], `const started = Date.now();
        report.out = registry.resolve('${POINT}').bench(2000);
        report.ms = Date.now() - started;`);

    assert.equal(report.out.envelope?.additions.length, 2);
    assert.ok(Number(report.ms) < 5_000, `2,000 evaluations took ${String(report.ms)} ms`);
  });
});

describe('Output interception: records and declarations', () => {
  it('records every step, and never copies content into a record', async (t) => {
    const { kernel } = await run(t, [
      output('acme.a', `() => ({ verdict: 'append', content: 'SECRET-CONTENT' })`),
      output('acme.b', `() => ({ verdict: 'none' })`),
      output('acme.c', `() => { throw new Error('boom'); }`),
      giver(['acme.a', 'acme.b', 'acme.c']),
    ]);
    const records = kernel.readObservations().filter((record) => record.source === 'brud.core.interception');
    const events = records.map((record) => `${record.event}:${String(record.detail.interceptor ?? '')}`);

    assert.deepEqual(events.filter((event) => event.startsWith('interception.result.')), [
      'interception.result.appended:acme.a',
      'interception.result.unchanged:acme.b',
      'interception.result.skipped:acme.c',
    ]);
    assert.equal(JSON.stringify(records).includes('SECRET-CONTENT'), false);
    assert.equal(records.find((record) => record.event === 'interception.result.appended')?.detail.bytes, 16);
  });

  it('admits stages input and output, leaves the default to the kernel, and refuses anything else', () => {
    const declare = (interception: Record<string, unknown>): ReturnType<typeof admitParticipantManifest> =>
      admitParticipantManifest('acme.i', { interceptions: [{ target: POINT, ...interception }] });

    assert.equal(declare({}).interceptions[0]?.stages, undefined);
    assert.deepEqual(declare({ stages: ['output'] }).interceptions[0]?.stages, ['output']);
    assert.deepEqual(declare({ stages: ['input', 'output'] }).interceptions[0]?.stages, ['input', 'output']);

    for (const stages of [[], ['input', 'input'], ['result'], 'output', [1], ['Output']]) {
      assert.throws(() => declare({ stages }), (error: unknown) => error instanceof ParticipantManifestError && /stages must be/.test(error.message), JSON.stringify(stages));
    }
  });
});

describe('Output interception: caged participants', () => {
  const watString = (text: string): string => `"${text.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
  const constantGuest = (exportName: string, text: string): string => `(module
    (memory (export "memory") 1)
    (data (i32.const 0) ${watString(text)})
    (func (export "brud_alloc") (param i32) (result i32) (i32.const 1024))
    (func (export "${exportName}") (param i32 i32) (result i64) (i64.const ${String(Buffer.byteLength(text))})))`;
  const cagedInterceptor = (token: string, text: string): FixtureParticipant => ({
    token,
    package: {
      wat: constantGuest('brud_intercept_result', text),
      manifest: { requests: { capabilities: [] }, exposures: [], events: [], interceptions: [{ target: POINT, stages: ['output'] }] },
    },
  });

  it('lets a caged interceptor append, attributed like any other', async (t) => {
    const { report } = await run(t, [
      cagedInterceptor('caged.note', '{"verdict":"append","content":{"note":"from the cage"}}'),
      output('acme.native', `() => ({ verdict: 'append', content: 'native' })`),
      giver(['caged.note', 'acme.native']),
    ]);

    assert.deepEqual(report.out.envelope?.additions, [
      { interceptor: 'caged.note', content: { note: 'from the cage' } },
      { interceptor: 'acme.native', content: 'native' },
    ]);
    assert.deepEqual(report.out.envelope?.result, ORIGINAL);
  });

  it('skips a caged interceptor that answers with anything but none or append', async (t) => {
    for (const text of ['{"verdict":"block","reason":"x"}', '{"verdict":"append"}', '{"verdict":"replace","result":1}', '[]']) {
      const { report } = await run(t, [cagedInterceptor('caged.bad', text), giver(['caged.bad'])]);

      assert.equal(report.out.allowed, true, text);
      assert.deepEqual(report.out.envelope?.result, ORIGINAL, text);
      assert.equal(report.out.envelope?.skipped[0]?.interceptor, 'caged.bad', text);
    }
  });

  it('applies the output stage for a caged giver too, and hands its caller the envelope', async (t) => {
    const echo = `(module
      (memory (export "memory") 2)
      (data (i32.const 0) ${watString('{"ok":true,"value":')})
      (func (export "brud_alloc") (param i32) (result i32) (i32.const 1024))
      (func (export "brud_invoke") (param $p i32) (param $l i32) (result i64)
        (memory.copy (i32.const 65536) (i32.const 0) (i32.const 19))
        (memory.copy (i32.const 65555) (local.get $p) (local.get $l))
        (i32.store8 (i32.add (i32.const 65555) (local.get $l)) (i32.const 125))
        (i64.or (i64.shl (i64.const 65536) (i64.const 32))
          (i64.extend_i32_u (i32.add (local.get $l) (i32.const 20))))))`;
    const point = 'caged.rate';

    resetFixtureReports();
    await bootComposition(await writeComposition(t, [
      { token: 'caged.giver', package: { wat: echo, manifest: {
        requests: { capabilities: [] }, events: [],
        exposures: [{ name: point, version: 1, scope: 'any' }],
        interceptionPoints: [{ exposure: point, admit: ['acme.stamp'] }],
      } } },
      { token: 'acme.stamp', interceptions: [{ target: point, stages: ['output'] }], interceptResult: `(call) => ({ verdict: 'append', content: { stamped: call.method } })` },
      { token: 'acme.asker', onRunning: `report.out = registry.resolve('${point}').rate('x');` },
    ]));

    const out = fixtureReports()['acme.asker']?.out as Outcome['envelope'];

    assert.deepEqual(out?.additions, [{ interceptor: 'acme.stamp', content: { stamped: 'rate' } }]);
    assert.deepEqual(out?.interceptedBy, ['acme.stamp']);
    assert.equal((out?.result as { kind: string }).kind, 'invoke', 'the result is exactly what the guest returned');
  });
});
