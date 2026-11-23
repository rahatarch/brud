import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bootKernel } from '../../index.js';
import { WasmCageToken } from '../../services/WasmCage/index.js';
import {
  bootComposition,
  fixtureReports,
  resetFixtureReports,
  writeComposition,
  type FixtureParticipant,
} from './support/participantFixture.js';

const POINT = 'test.icpt.echo';

/** Records the run order of interceptors across the composition. */
const ORDER = '(globalThis.__icptOrder ??= [])';

/** An interceptor participant declaring an interception of the point. */
function interceptor(token: string, intercept: string, target = POINT): FixtureParticipant {
  return { token, interceptions: [{ target, stages: ['input'] }], intercept };
}

/**
 * The giver: it exposes `test.icpt.echo`, opens an interception point on it
 * admitting `admit` in order, and its binding opts in by calling
 * `interception.evaluate` with the caller view its projection received.
 */
function giver(admit: readonly string[], token = 'icpt.giver'): FixtureParticipant {
  return {
    token,
    exposures: [{ name: POINT, version: 1, scope: 'any' }],
    interceptionPoints: [{ exposure: POINT, admit: [...admit] }],
    bindings: `{ '${POINT}@1': (caller) => ({ echo: (...args) => {
      const outcome = report.evaluate.evaluate('${POINT}@1', 'echo', args, { caller });
      if (!outcome.allowed) throw new Error('INTERCEPTION_BLOCKED: ' + outcome.reason);
      return { args: outcome.args, modifiedBy: outcome.modifiedBy, caller: caller.identity };
    } }) }`,
    onRunning: "report.evaluate = registry.resolve('interception.evaluate');",
  };
}

describe('Interception hardcore (seventh)', () => {
  it('runs admitted interceptors in the giver order with allow, modify and block, as the real caller, including a caged caller', async (t) => {
    resetFixtureReports();
    (globalThis as { __icptOrder?: unknown[] }).__icptOrder = [];

    const cage = JSON.stringify({ id: WasmCageToken.id, description: 'cage', _brand: undefined });
    const kernel = await bootComposition(await writeComposition(t, [
      interceptor('icpt.audit', `(call) => { ${ORDER}.push('audit'); (report.seen ??= []).push({ args: call.args, caller: call.caller.identity, origin: call.caller.origin, method: call.method, target: call.target }); return { verdict: 'allow' }; }`),
      interceptor('icpt.rewrite', `(call) => { ${ORDER}.push('rewrite'); return call.args[0] === 'rewrite-me' ? { verdict: 'modify', args: ['rewritten', ...call.args.slice(1)] } : { verdict: 'allow' }; }`),
      interceptor('icpt.guard', `(call) => { ${ORDER}.push('guard'); (report.seenArgs ??= []).push(call.args); return call.args[0] === 'forbidden' ? { verdict: 'block', reason: 'forbidden input' } : { verdict: 'allow' }; }`),
      giver(['icpt.audit', 'icpt.rewrite', 'icpt.guard']),
      {
        token: 'icpt.caller',
        onRunning: `
          const api = registry.resolve('${POINT}');
          globalThis.__icptOrder.length = 0;
          report.plain = api.echo('hello', 1);
          report.orderPlain = [...globalThis.__icptOrder];
          report.rewritten = api.echo('rewrite-me', 2);
          try { api.echo('forbidden'); report.blocked = 'not blocked'; } catch (error) { report.blocked = error.message; }
          globalThis.__icptOrder.length = 0;
          try { api.echo('forbidden'); } catch {}
          report.orderBlocked = [...globalThis.__icptOrder];
          report.probe = registry.resolve('interception.evaluate').evaluate('${POINT}@1', 'echo', ['x']);
          report.points = registry.resolve('interception.list').list();
        `,
      },
      { token: 'icpt.child', onRunning: `report.identity = registry.resolve('${POINT}').echo('whoami').caller;` },
      {
        token: 'icpt.parent',
        onRunning: `
          const cage = broker.requestAccess({ callerId: token.id, tier: 'userland', options: {} }, ${cage});
          const child = globalThis.__eventsDeclarationFixture['icpt.child'].identity;
          report.child = child;
          report.caged = cage.resolve(child, '${POINT}').echo('via-cage');
          report.own = registry.resolve('${POINT}').echo('own');
          report.cagedList = cage.resolve(child, 'interception.list').list();
          report.cagedEvaluate = cage.resolve(child, 'interception.evaluate').evaluate('${POINT}@1', 'echo', ['x']);
        `,
      },
    ]));
    const reports = fixtureReports();
    const caller = reports['icpt.caller'];
    const parent = reports['icpt.parent'];
    const seen = reports['icpt.audit']?.seen as readonly { args: unknown[]; caller: string; origin: string; method: string; target: string }[];

    // allow: every interceptor allows; args pass through unchanged.
    assert.deepEqual((caller?.plain as { args: unknown[] }).args, ['hello', 1]);
    assert.deepEqual(caller?.orderPlain, ['audit', 'rewrite', 'guard']);
    // modify: the rewrite interceptor replaces the args; later interceptors see the modified args.
    assert.deepEqual((caller?.rewritten as { args: unknown[]; modifiedBy: string[] }).args, ['rewritten', 2]);
    assert.deepEqual((caller?.rewritten as { modifiedBy: string[] }).modifiedBy, ['icpt.rewrite']);
    assert.deepEqual((reports['icpt.guard']?.seenArgs as unknown[][])[1], ['rewritten', 2]);
    // block: the guard's verdict blocks; the giver refuses the call with the reason.
    assert.equal(caller?.blocked, 'INTERCEPTION_BLOCKED: forbidden input');
    assert.deepEqual(caller?.orderBlocked, ['audit', 'rewrite', 'guard']);
    // The interceptors see the real caller, not the giver.
    const callerIdentity = (caller?.plain as { caller: string }).caller;
    assert.equal(typeof callerIdentity, 'string');
    assert.equal(seen[0]?.caller, callerIdentity);
    assert.equal(seen[0]?.origin, 'runtime');
    assert.equal(seen[0]?.method, 'echo');
    assert.equal(seen[0]?.target, `${POINT}@1`);
    // Only the point owner may evaluate; a third party probing the interceptors is refused.
    assert.equal((caller?.probe as { allowed: boolean }).allowed, false);
    assert.deepEqual(caller?.points, [`${POINT}@1`]);
    // Through the cage: the caged child is the caller the interceptors see.
    assert.equal((parent?.caged as { caller: string }).caller, parent?.child);
    assert.notEqual((parent?.own as { caller: string }).caller, parent?.child);
    assert.ok(seen.some((entry) => entry.caller === parent?.child && entry.args[0] === 'via-cage'));
    // The interception APIs resolve through the cage like any exposure; evaluate still admits only the owner.
    assert.deepEqual(parent?.cagedList, [`${POINT}@1`]);
    assert.deepEqual(parent?.cagedEvaluate, { allowed: false, reason: 'only the interception point owner may evaluate it' });

    const observed = kernel.readObservations().map((observation) => observation.event);

    assert.ok(observed.includes('interception.modified'));
    assert.ok(observed.includes('interception.blocked'));
    assert.ok(observed.includes('interception.refused'));
  });

  it('fails closed when an interceptor throws or returns an invalid verdict', async (t) => {
    const cases = [
      ["() => { throw new Error('boom'); }", /^INTERCEPTION_BLOCKED: interceptor-failed: boom$/u],
      ["() => ({ verdict: 'maybe' })", /^INTERCEPTION_BLOCKED: interceptor-failed: invalid verdict$/u],
    ] as const;

    for (const [intercept, expected] of cases) {
      resetFixtureReports();

      await bootComposition(await writeComposition(t, [
        interceptor('icpt.flaky', intercept),
        giver(['icpt.flaky']),
        {
          token: 'icpt.caller',
          onRunning: `try { registry.resolve('${POINT}').echo('x'); report.result = 'allowed'; } catch (error) { report.result = error.message; }`,
        },
      ]));

      assert.match(String(fixtureReports()['icpt.caller']?.result), expected);
    }
  });

  it('refuses boot for an unadmitted interception, an admitted non-interceptor, a point on a foreign exposure, and a hardcore target', async (t) => {
    const cases: readonly (readonly FixtureParticipant[])[] = [
      [interceptor('icpt.lonely', "() => ({ verdict: 'allow' })"), giver([])],
      [{ token: 'icpt.bystander' }, giver(['icpt.bystander'])],
      [interceptor('icpt.audit', "() => ({ verdict: 'allow' })"), {
        token: 'icpt.squatter',
        interceptionPoints: [{ exposure: POINT, admit: ['icpt.audit'] }],
      }],
      [interceptor('icpt.hijack', "() => ({ verdict: 'allow' })", 'events.emit')],
    ];

    for (const participants of cases) {
      const composition = await writeComposition(t, participants);

      await assert.rejects(
        bootKernel(composition.configPath, { options: composition.options }),
        (error: unknown) => (error as { code?: unknown }).code === 'INTERCEPTION_DECLARATION_INVALID',
      );
    }
  });
});
