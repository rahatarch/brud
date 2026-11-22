import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defineParticipant } from '../src/participant/index.js';
import { bootTestKernel } from '../src/testing/index.js';

const SDK = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'participant', 'index.js')).href;
const reports = (): Record<string, Record<string, unknown>> => ((globalThis as { __sdkTest?: Record<string, Record<string, unknown>> }).__sdkTest ??= {});

/** A participant module written with the SDK, as an author would. */
const module = (body: string): string => `import { defineParticipant, byCapability } from ${JSON.stringify(SDK)};
const report = (id) => ((globalThis.__sdkTest ??= {})[id] ??= {});
export const createService = ${body};
`;

const greeter = module(`defineParticipant({
  id: 'sdk.greeter',
  exposes: { 'sdk.greet': { scope: 'any', handle: (caller, ctx) => ({ greet: (name) => 'hello ' + name + ' from ' + ctx.id, callerIsKnown: () => typeof caller.identity === 'string' }) } },
  create: () => ({}),
})`);

const notes = module(`defineParticipant({
  id: 'sdk.notes',
  exposes: { 'sdk.notes': { handle: byCapability(
    { 'notes:write': (ctx) => ({ add: (n) => { ctx.instance.items.push(n); return ctx.instance.items.length; } }) },
    { shared: (ctx) => ({ list: () => [...ctx.instance.items] }) },
  ) } },
  create: (ctx) => ({ items: [], label: ctx.options['notes.label'], onRunning() { report('sdk.notes').ownHook = true; } }),
  onRunning: (ctx) => { report('sdk.notes').definitionHook = ctx.running; report('sdk.notes').label = ctx.instance.label; },
})`);

const caller = (id: string, requests: string[], body: string): string => module(`defineParticipant({
  id: ${JSON.stringify(id)}, requests: ${JSON.stringify(requests)}, create: () => ({}),
  onRunning: (ctx) => { const r = report(${JSON.stringify(id)}); ${body} },
})`);

describe('@brud/sdk participant layer on the real kernel', () => {
  it('a plain giver is resolved and called by another SDK participant, as itself', async (t) => {
    delete (globalThis as { __sdkTest?: unknown }).__sdkTest;
    await bootTestKernel(t, [
      { source: greeter },
      { source: caller('sdk.visitor', [], "const g = ctx.resolve('sdk.greet'); r.text = g.greet('ada'); r.known = g.callerIsKnown(); r.missing = ctx.resolve('sdk.nothing');") },
    ]);
    const r = reports()['sdk.visitor'];

    assert.equal(r?.text, 'hello ada from sdk.greeter');
    assert.equal(r?.known, true);
    assert.equal(r?.missing, null);
  });

  it('shapes a handle by capability, refuses callers with none, runs both onRunning hooks, and passes options', async (t) => {
    delete (globalThis as { __sdkTest?: unknown }).__sdkTest;
    await bootTestKernel(t, [
      { source: notes },
      { source: caller('sdk.writer', ['notes:write'], "const n = ctx.resolve('sdk.notes'); r.count = n.add('a'); r.list = n.list(); r.keys = Object.keys(n).sort();") },
      { source: caller('sdk.reader', [], "r.handle = ctx.resolve('sdk.notes');") },
    ], { 'notes.label': 'my notes' });
    const r = reports();

    assert.equal(r['sdk.writer']?.count, 1);
    assert.deepEqual(r['sdk.writer']?.list, ['a']);
    assert.deepEqual(r['sdk.writer']?.keys, ['add', 'list']);
    assert.equal(r['sdk.reader']?.handle, null);
    assert.equal(r['sdk.notes']?.ownHook, true);
    assert.equal(r['sdk.notes']?.definitionHook, true);
    assert.equal(r['sdk.notes']?.label, 'my notes');
  });

  it('explains a refused resolve: not attached in create, unavailable when running, null after a success', async (t) => {
    delete (globalThis as { __sdkTest?: unknown }).__sdkTest;
    await bootTestKernel(t, [
      { source: notes },
      { source: module(`defineParticipant({
  id: 'sdk.asker', requests: [],
  create: (ctx) => { const early = ctx.resolve('sdk.notes'); report('sdk.asker').early = early; report('sdk.asker').earlyWhy = ctx.lastRefusal(); return {}; },
  onRunning: (ctx) => { const r = report('sdk.asker'); r.handle = ctx.resolve('sdk.notes'); r.why = ctx.lastRefusal(); ctx.resolve('sdk.nothing'); r.missing = ctx.lastRefusal(); ctx.resolve('sdk.greet-not-declared'); r.ok = ctx.lastRefusal(); },
})`) },
    ]);
    const r = reports()['sdk.asker'];

    assert.equal(r?.early, null);
    assert.equal((r?.earlyWhy as { code?: string } | undefined)?.code, 'no-call-context');
    assert.equal(r?.handle, null);
    assert.equal((r?.why as { code?: string } | undefined)?.code, 'unavailable');
    assert.deepEqual(r?.why, r?.missing, 'a missing exposure and a refused one explain identically');
  });

  it('builds the descriptor the kernel expects, and rejects invalid definitions', () => {
    const descriptor = defineParticipant({ id: 'acme.notes', exposes: { 'acme.notes': { version: 2, handle: () => ({}) } }, create: () => ({}) })();

    assert.equal(descriptor.token.id, 'acme.notes');
    assert.equal(descriptor.tier, 'userland');
    assert.deepEqual(descriptor.manifest?.exposures, [{ name: 'acme.notes', version: 2, scope: 'runtime' }]);

    for (const bad of [{ id: 'Bad Id' }, { id: 'acme.x', exposes: { 'acme.y': { version: 0, handle: () => ({}) } } }]) {
      assert.throws(() => defineParticipant({ create: () => ({}), ...bad } as never), (error: unknown) => (error as { code?: string }).code === 'SDK_DEFINITION_INVALID');
    }
  });
});
