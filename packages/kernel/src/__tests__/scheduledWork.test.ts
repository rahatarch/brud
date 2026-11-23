import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bootComposition,
  fixtureReports,
  resetFixtureReports,
  writeComposition,
  type FixtureParticipant,
} from './support/participantFixture.js';

const watString = (text: string): string => `"${text.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;

/** A guest whose `brud_invoke` makes one routed call and answers with its response. */
const relayGuest = (request: string): string => `(module
  (import "brud" "call" (func $call (param i32 i32) (result i64)))
  (memory (export "memory") 1)
  (data (i32.const 512) ${watString(request)})
  (func (export "brud_alloc") (param i32) (result i32) (i32.const 2048))
  (func (export "brud_invoke") (param i32 i32) (result i64)
    (call $call (i32.const 512) (i32.const ${String(Buffer.byteLength(request))}))))`;

/** A native participant that records the origin of the call chain it is reached by. */
const recorder: FixtureParticipant = {
  token: 'sched.recorder',
  exposures: [{ name: 'sched.recorder', version: 1, scope: 'any' }],
  bindings: `{ 'sched.recorder@1': (caller) => ({ note: () => { (report.origins ??= []).push(caller.origin); return true; } }) }`,
};

const manifest = (extra: Record<string, unknown>) => ({
  requests: { capabilities: [] },
  exposures: [{ name: 'sched.tick', version: 1, scope: 'any' }],
  events: [],
  ...extra,
});

/** A native participant that owns the timer: it calls the guest's `tick` exposure later, as a timer of its own. */
const ticker = (body: string): FixtureParticipant => ({
  token: 'sched.ticker',
  onRunning: `
    const tick = registry.resolve('sched.tick');
    await new Promise((resolve) => setTimeout(() => { ${body} resolve(); }, 20));
  `,
});

describe('a caged guest does work when a participant calls it from a timer', () => {
  it('the guest runs in a runtime-origin chain, so the calls it makes are runtime-origin', async (t) => {
    resetFixtureReports();
    await bootComposition(await writeComposition(t, [
      recorder,
      { token: 'sched.guest', package: { wat: relayGuest(JSON.stringify({ name: 'sched.recorder', method: 'note', args: [] })), manifest: manifest({}) } },
      ticker('report.result = tick.go();'),
    ]));

    assert.deepEqual(fixtureReports()['sched.recorder']?.origins, ['runtime']);
    assert.equal(fixtureReports()['sched.ticker']?.result, true);
  });

  it('the guest can emit its own runtime-scope event from that work', async (t) => {
    resetFixtureReports();
    await bootComposition(await writeComposition(t, [
      {
        token: 'sched.guest',
        package: {
          wat: relayGuest(JSON.stringify({ name: 'events.emit', method: 'emit', args: ['test.sched.tick', { n: 1 }] })),
          manifest: manifest({ events: [{ name: 'test.sched.tick', version: 1, scope: 'runtime' }] }),
        },
      },
      ticker('report.result = tick.go();'),
    ]));

    assert.deepEqual(fixtureReports()['sched.ticker']?.result, { ok: true, sequence: 1, refusedSubscriptions: [] });
  });
});
