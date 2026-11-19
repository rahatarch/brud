import { describe, it } from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { bootKernel } from '../../index.js';
import {
  bootComposition,
  fixtureReports,
  resetFixtureReports,
  writeComposition,
  type FixtureParticipant,
} from './support/participantFixture.js';

const POINT = 'test.caged.echo';

/** WAT string literal for `text`. */
const watString = (text: string): string => `"${text.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;

/** A guest whose `brud_invoke` answers `{ ok: true, value: <the request> }`. */
const ECHO_GUEST = `(module
  (memory (export "memory") 2)
  (data (i32.const 0) ${watString('{"ok":true,"value":')})
  (func (export "brud_alloc") (param i32) (result i32) (i32.const 1024))
  (func (export "brud_invoke") (param $p i32) (param $l i32) (result i64)
    (memory.copy (i32.const 65536) (i32.const 0) (i32.const 19))
    (memory.copy (i32.const 65555) (local.get $p) (local.get $l))
    (i32.store8 (i32.add (i32.const 65555) (local.get $l)) (i32.const 125))
    (i64.or (i64.shl (i64.const 65536) (i64.const 32))
      (i64.extend_i32_u (i32.add (local.get $l) (i32.const 20))))))`;

/** A guest whose `exportName` always answers `text`. */
const constantGuest = (exportName: string, text: string, pages = 1): string => `(module
  (memory (export "memory") ${String(pages)})
  (data (i32.const 0) ${watString(text)})
  (func (export "brud_alloc") (param i32) (result i32) (i32.const 1024))
  (func (export "${exportName}") (param i32 i32) (result i64) (i64.const ${String(Buffer.byteLength(text))})))`;

/** A guest whose `brud_invoke` never returns. */
const SPIN_GUEST = `(module
  (memory (export "memory") 1)
  (func (export "brud_alloc") (param i32) (result i32) (i32.const 1024))
  (func (export "brud_invoke") (param i32 i32) (result i64) (loop $l (br $l)) (unreachable)))`;

/** A guest that calls `brud.call` with a fixed request and answers with the routed response verbatim. */
const relayGuest = (startRequest: string, invokeRequest: string): string => `(module
  (import "brud" "call" (func $call (param i32 i32) (result i64)))
  (memory (export "memory") 1)
  (data (i32.const 0) ${watString(startRequest)})
  (data (i32.const 512) ${watString(invokeRequest)})
  (data (i32.const 4000) ${watString('{"ok":true}')})
  (func (export "brud_alloc") (param i32) (result i32) (i32.const 2048))
  (func (export "brud_start") (param i32 i32) (result i64)
    (drop (call $call (i32.const 0) (i32.const ${String(Buffer.byteLength(startRequest))})))
    (i64.or (i64.shl (i64.const 4000) (i64.const 32)) (i64.const 11)))
  (func (export "brud_invoke") (param i32 i32) (result i64)
    (call $call (i32.const 512) (i32.const ${String(Buffer.byteLength(invokeRequest))}))))`;

function caged(
  token: string,
  manifest: Readonly<Record<string, unknown>>,
  wat: string,
  limits?: { fuel: number; maxMemoryBytes: number; deadlineMs?: number },
): FixtureParticipant {
  const full = { requests: { capabilities: [] }, exposures: [], events: [], ...manifest };

  return { token, package: { wat, manifest: full, ...(limits === undefined ? {} : { limits }) } };
}

const exposure = { exposures: [{ name: POINT, version: 1, scope: 'any' }] };

function callerOf(calls: string): FixtureParticipant {
  return {
    token: 'caged.caller',
    onRunning: `const api = registry.resolve('${POINT}');
      const attempt = (fn) => { try { return fn(); } catch (error) { return { error: error.message, code: error.code }; } };
      ${calls}`,
  };
}

describe('Caged participants (I-07 parity)', () => {
  it('a caged giver answers a native caller with the args and the real caller identity', async (t) => {
    resetFixtureReports();
    await bootComposition(await writeComposition(t, [
      caged('caged.giver', exposure, ECHO_GUEST),
      callerOf("report.value = api.echo('hello', 1, { a: [true, null] }); report.frozen = Object.isFrozen(report.value); report.fn = attempt(() => api.echo(() => 1));"),
      { token: 'caged.other', onRunning: `report.value = registry.resolve('${POINT}').echo('x');` },
    ]));
    const reports = fixtureReports();
    const value = reports['caged.caller']?.value as { kind: string; method: string; exposure: string; args: unknown[]; caller: { identity: string; origin: string } };

    assert.equal(value.kind, 'invoke');
    assert.equal(value.method, 'echo');
    assert.equal(value.exposure, `${POINT}@1`);
    assert.deepEqual(value.args, ['hello', 1, { a: [true, null] }]);
    assert.equal(typeof value.caller.identity, 'string');
    assert.notEqual(value.caller.identity, (reports['caged.other']?.value as { caller: { identity: string } }).caller.identity);
    assert.equal(reports['caged.caller']?.frozen, true);
    assert.equal((reports['caged.caller']?.fn as { code: string }).code, 'WASM_CAGE_GUEST_FAILED');
  });

  it('a caged giver opens an interception point admitting a native interceptor that sees the native caller and can block', async (t) => {
    resetFixtureReports();
    await bootComposition(await writeComposition(t, [
      {
        token: 'caged.guard',
        interceptions: [{ target: POINT }],
        intercept: "(call) => { (report.seen ??= []).push(call.caller.identity); return call.args[0] === 'forbidden' ? { verdict: 'block', reason: 'forbidden input' } : { verdict: 'allow' }; }",
      },
      caged('caged.giver', { ...exposure, interceptionPoints: [{ exposure: POINT, admit: ['caged.guard'] }] }, ECHO_GUEST),
      callerOf("report.value = api.echo('ok'); report.blocked = attempt(() => api.echo('forbidden'));"),
    ]));
    const reports = fixtureReports();
    const value = reports['caged.caller']?.value as { args: unknown[]; caller: { identity: string } };

    assert.deepEqual(value.args, ['ok']);
    assert.deepEqual(reports['caged.guard']?.seen, [value.caller.identity, value.caller.identity]);
    assert.equal((reports['caged.caller']?.blocked as { code: string }).code, 'INTERCEPTION_BLOCKED');
    assert.match((reports['caged.caller']?.blocked as { error: string }).error, /forbidden input/u);
  });

  it('a caged interceptor blocks a native giver\'s call', async (t) => {
    resetFixtureReports();
    await bootComposition(await writeComposition(t, [
      caged('caged.guard', { interceptions: [{ target: POINT }] }, constantGuest('brud_intercept', '{"verdict":"block","reason":"caged says no"}')),
      {
        token: 'caged.native-giver',
        ...exposure,
        interceptionPoints: [{ exposure: POINT, admit: ['caged.guard'] }],
        bindings: `{ '${POINT}@1': (caller) => ({ echo: (...args) => {
          const outcome = report.evaluate.evaluate('${POINT}@1', 'echo', args, { caller });
          if (!outcome.allowed) throw new Error('INTERCEPTION_BLOCKED: ' + outcome.reason);
          return args;
        } }) }`,
        onRunning: "report.evaluate = registry.resolve('interception.evaluate');",
      },
      callerOf("report.blocked = attempt(() => api.echo('x'));"),
    ]));

    assert.equal((fixtureReports()['caged.caller']?.blocked as { error: string }).error, 'INTERCEPTION_BLOCKED: caged says no');
  });

  it('fails closed when a caged guest exhausts its fuel', async (t) => {
    resetFixtureReports();
    await bootComposition(await writeComposition(t, [
      caged('caged.spinner', exposure, SPIN_GUEST, { fuel: 100_000, maxMemoryBytes: 1 << 20 }),
      callerOf("report.result = attempt(() => api.echo('x'));"),
    ]));
    const result = fixtureReports()['caged.caller']?.result as { code: string; error: string };

    assert.equal(result.code, 'WASM_CAGE_GUEST_FAILED');
    assert.match(result.error, /fuel/iu);
  });

  it('refuses a caged guest whose memory exceeds its limit', async (t) => {
    const composition = await writeComposition(t, [
      caged('caged.hog', exposure, constantGuest('brud_invoke', '{"ok":true,"value":1}', 32), { fuel: 100_000, maxMemoryBytes: 1 << 20 }),
    ]);

    await assert.rejects(
      bootKernel(composition.configPath, { options: composition.options }),
      (error: unknown) => /growing memory/u.test(String((error as Error).message) + String((error as { cause?: Error }).cause?.message)),
    );
  });

  it('a caged participant calls out through brud.call as itself, from brud_start and while serving a call', async (t) => {
    resetFixtureReports();
    const target = 'test.caged.target';
    await bootComposition(await writeComposition(t, [
      {
        token: 'caged.target',
        exposures: [{ name: target, version: 1, scope: 'any' }],
        bindings: `{ '${target}@1': (caller) => ({ echo: (...args) => { (report.seen ??= []).push({ args, caller: caller.identity }); return { args, caller: caller.identity }; } }) }`,
      },
      caged('caged.relay', exposure, relayGuest(
        JSON.stringify({ name: target, method: 'echo', args: ['from-start'] }),
        JSON.stringify({ name: target, version: 1, method: 'echo', args: ['from-invoke'] }),
      )),
      callerOf("report.value = api.echo('ignored');"),
      { token: 'caged.probe', onRunning: `report.identity = registry.resolve('${target}').echo('probe').caller;` },
    ]));
    const reports = fixtureReports();
    const seen = reports['caged.target']?.seen as readonly { args: unknown[]; caller: string }[];
    const value = reports['caged.caller']?.value as { args: unknown[]; caller: string };
    const relay = seen.find((entry) => entry.args[0] === 'from-start')?.caller;

    assert.equal(typeof relay, 'string');
    assert.deepEqual(value.args, ['from-invoke']);
    assert.equal(value.caller, relay);
    assert.notEqual(relay, reports['caged.probe']?.identity);
  });

  it('refuses a routed call back into the same busy instance (fail closed)', async (t) => {
    resetFixtureReports();
    await bootComposition(await writeComposition(t, [
      caged('caged.loop', exposure, relayGuest('{}', JSON.stringify({ name: POINT, method: 'echo', args: [] }))),
      callerOf('report.result = attempt(() => api.echo());'),
    ]));
    const result = fixtureReports()['caged.caller']?.result as { code: string; error: string };

    assert.equal(result.code, 'WASM_CAGE_GUEST_FAILED');
    assert.match(result.error, /re-entrant/u);
  });

  describe('async routed calls', () => {
    const target = 'test.caged.async';
    const relay = (method: string): string => relayGuest('{}', JSON.stringify({ name: target, method, args: ['a', 1] }));
    const asyncGiver: FixtureParticipant = {
      token: 'caged.async-giver',
      exposures: [{ name: target, version: 1, scope: 'any' }],
      bindings: `{ '${target}@1': (caller) => ({
        slow: async (...args) => { await new Promise((r) => setTimeout(r, 20)); return { args, caller: caller.identity, chain: report.registry.resolve('interception.list') !== null }; },
        never: () => new Promise(() => {}),
        notPlain: async () => ({ when: new Date(0) }),
        abortable: (options) => new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => { report.aborted = options.signal.reason?.guestCode; reject(new Error('aborted')); });
        }),
      }) }`,
      onRunning: 'report.registry = registry;',
    };

    it('suspends the guest, awaits inside the caller chain, resumes it, and queues a second call', async (t) => {
      resetFixtureReports();
      await bootComposition(await writeComposition(t, [
        asyncGiver,
        caged('caged.relay', exposure, relay('slow')),
        callerOf("const pending = api.echo(); report.isPromise = pending instanceof Promise; const second = api.echo(); report.value = await pending; report.second = await second;"),
      ]));
      const report = fixtureReports()['caged.caller'];
      const value = report?.value as { args: unknown[]; caller: string; chain: boolean };

      assert.equal(report?.isPromise, true);
      assert.deepEqual(value.args, ['a', 1]);
      assert.equal(typeof value.caller, 'string');
      assert.equal(value.chain, true, 'the kernel call chain survives the await');
      assert.deepEqual((report?.second as { args: unknown[] }).args, ['a', 1], 'a call into a busy instance waits its turn');
    });

    it('answers a routed call past the deadline with WASM_CAGE_ROUTED_TIMEOUT', async (t) => {
      resetFixtureReports();
      await bootComposition(await writeComposition(t, [
        asyncGiver,
        caged('caged.relay', exposure, relay('never'), { fuel: 1_000_000, maxMemoryBytes: 1 << 20, deadlineMs: 50 }),
        callerOf('try { await api.echo(); report.result = "resolved"; } catch (error) { report.result = { code: error.code, guestCode: error.guestCode }; }'),
      ]));

      assert.deepEqual(fixtureReports()['caged.caller']?.result, { code: 'WASM_CAGE_GUEST_FAILED', guestCode: 'WASM_CAGE_ROUTED_TIMEOUT' });
    });

    it('aborts an abortable host operation when the deadline passes', async (t) => {
      resetFixtureReports();
      const guest = relayGuest('{}', JSON.stringify({ name: target, method: 'abortable', args: [{}], abortable: true }));

      await bootComposition(await writeComposition(t, [
        asyncGiver,
        caged('caged.relay', exposure, guest, { fuel: 1_000_000, maxMemoryBytes: 1 << 20, deadlineMs: 50 }),
        callerOf('try { await api.echo(); } catch (error) { report.result = error.guestCode; }'),
      ]));

      assert.equal(fixtureReports()['caged.caller']?.result, 'WASM_CAGE_ROUTED_TIMEOUT');
      assert.equal(fixtureReports()['caged.async-giver']?.aborted, 'WASM_CAGE_ROUTED_TIMEOUT', 'the host operation received the abort');
    });

    it('refuses an awaited result that is not plain JSON', async (t) => {
      resetFixtureReports();
      await bootComposition(await writeComposition(t, [
        asyncGiver,
        caged('caged.relay', exposure, relay('notPlain')),
        callerOf('try { await api.echo(); report.result = "resolved"; } catch (error) { report.result = error.guestCode; }'),
      ]));

      assert.equal(fixtureReports()['caged.caller']?.result, 'WASM_CAGE_ROUTED_NOT_PLAIN');
    });

    it('keeps interceptors synchronous: an interceptor that awaits fails closed', async (t) => {
      resetFixtureReports();
      const request = JSON.stringify({ name: target, method: 'slow', args: [] });
      const wat = `(module
        (import "brud" "call" (func $call (param i32 i32) (result i64)))
        (memory (export "memory") 1)
        (data (i32.const 0) ${watString(request)})
        (func (export "brud_alloc") (param i32) (result i32) (i32.const 2048))
        (func (export "brud_intercept") (param i32 i32) (result i64) (call $call (i32.const 0) (i32.const ${String(Buffer.byteLength(request))}))))`;

      await bootComposition(await writeComposition(t, [
        asyncGiver,
        caged('caged.guard', { interceptions: [{ target: POINT }] }, wat),
        {
          token: 'caged.native-giver',
          ...exposure,
          interceptionPoints: [{ exposure: POINT, admit: ['caged.guard'] }],
          bindings: `{ '${POINT}@1': (caller) => ({ echo: (...args) => {
            const outcome = report.evaluate.evaluate('${POINT}@1', 'echo', args, { caller });
            if (!outcome.allowed) throw new Error('INTERCEPTION_BLOCKED: ' + outcome.reason);
            return args;
          } }) }`,
          onRunning: "report.evaluate = registry.resolve('interception.evaluate');",
        },
        callerOf("report.blocked = attempt(() => api.echo('x'));"),
      ]));

      assert.match(String((fixtureReports()['caged.caller']?.blocked as { error: string }).error), /^INTERCEPTION_BLOCKED: interceptor-failed: invalid verdict$/u);
    });
  });

  describe('tier rule (W-01)', () => {
    it('refuses a non-official native module at boot', async (t) => {
      const composition = await writeComposition(t, [{ token: 'w01.native', official: false }]);

      await assert.rejects(
        bootKernel(composition.configPath, { options: composition.options }),
        (error: unknown) => (error as { code?: string }).code === 'PARTICIPANT_TIER',
      );
    });

    it('refuses a participant package whose module fails its digest check', async (t) => {
      const composition = await writeComposition(t, [caged('w01.tampered', exposure, ECHO_GUEST)]);
      const module = join(dirname(composition.configPath), 'participant-0', 'participant.wasm');

      await writeFile(module, `${await readFile(module, 'utf8')} `, 'utf8');
      await assert.rejects(
        bootKernel(composition.configPath, { options: composition.options }),
        (error: unknown) => /digest check/u.test(String((error as Error).message)),
      );
    });
  });
});
