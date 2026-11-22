/**
 * A caller's capabilities reach every participant in one shape: a read-only
 * view of a set. A plain Set cannot be that shape, because freezing a Set does
 * not stop `add`, `delete` or `clear`, and a giver that is shown the caller
 * could grant it capabilities the kernel never gave. Proven on the view
 * itself and on real booted kernels with throwaway participants.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  ExposedApiRegistryToken,
  type BrudKernel,
  type IExposedApiRegistry,
} from '../../index.js';
import {
  NO_CAPABILITIES,
  createCapabilitySet,
  isCapabilitySet,
  withPlainCapabilities,
} from '../contracts/capabilitySet.js';
import { brud, call } from './support/probeKernel.js';
import {
  bootComposition,
  fixtureReports,
  resetFixtureReports,
  writeComposition,
} from './support/participantFixture.js';

describe('Capability view', () => {
  it('is a read-only set: has, size, forEach, keys, values, entries and iteration, in sorted order', () => {
    const view = createCapabilitySet(['b:two', 'a:one', 'b:two']);

    assert.equal(view.size, 2);
    assert.equal(view.has('a:one'), true);
    assert.equal(view.has('c:three'), false);
    assert.deepEqual([...view], ['a:one', 'b:two']);
    assert.deepEqual([...view.keys()], ['a:one', 'b:two']);
    assert.deepEqual([...view.values()], ['a:one', 'b:two']);
    assert.deepEqual([...view.entries()], [['a:one', 'a:one'], ['b:two', 'b:two']]);
    assert.deepEqual([...new Set(view)], ['a:one', 'b:two']);

    const seen: string[] = [];

    view.forEach((value, key, set) => {
      assert.equal(value, key);
      assert.equal(set, view);
      seen.push(value);
    });
    assert.deepEqual(seen, ['a:one', 'b:two']);
  });

  it('has no way to be changed', () => {
    const view = createCapabilitySet(['a:one']);
    const loose = view as unknown as Record<string, unknown>;

    assert.equal(Object.isFrozen(view), true);
    assert.throws(() => (loose.add as (value: string) => void)('x:y'), TypeError);
    assert.throws(() => (loose.delete as (value: string) => void)('a:one'), TypeError);
    assert.throws(() => (loose.clear as () => void)(), TypeError);
    assert.throws(() => { loose.has = (): boolean => true; }, TypeError);
    assert.throws(() => { loose.extra = 1; }, TypeError);
    assert.throws(() => Object.defineProperty(view, 'size', { value: 9 }), TypeError);
    assert.throws(() => Set.prototype.add.call(view, 'x:y'), TypeError);
    assert.throws(() => Set.prototype.delete.call(view, 'a:one'), TypeError);
    assert.throws(() => Set.prototype.clear.call(view), TypeError);
    assert.deepEqual([...view], ['a:one']);
  });

  it('is a copy: changing the source afterwards does not change the view', () => {
    const source = new Set(['a:one']);
    const view = createCapabilitySet(source);

    source.add('b:two');
    assert.deepEqual([...view], ['a:one']);
  });

  it('serialises as its sorted array, so a JSON boundary keeps the capabilities', () => {
    assert.equal(JSON.stringify(createCapabilitySet(['b:two', 'a:one'])), '["a:one","b:two"]');
    assert.equal(JSON.stringify({ caller: { capabilities: createCapabilitySet(['x:y']) } }), '{"caller":{"capabilities":["x:y"]}}');
    assert.equal(JSON.stringify(NO_CAPABILITIES), '[]');
  });

  it('is recognised only when the kernel made it', () => {
    assert.equal(isCapabilitySet(createCapabilitySet([])), true);
    assert.equal(isCapabilitySet(new Set(['a:one'])), false);
    assert.equal(isCapabilitySet({ has: () => true, size: 0 }), false);
    assert.equal(isCapabilitySet(null), false);
    assert.equal(isCapabilitySet(['a:one']), false);
  });

  it('is replaced by its array at a plain-JSON boundary, nested at any depth, and nothing else is touched', () => {
    const view = createCapabilitySet(['b:two', 'a:one']);
    const plain = withPlainCapabilities([{ caller: { capabilities: view, origin: 'host' } }, 'text', 7, null]);

    assert.deepEqual(plain, [{ caller: { capabilities: ['a:one', 'b:two'], origin: 'host' } }, 'text', 7, null]);

    const fn = (): void => undefined;
    const instance = new (class Thing { readonly x = 1; })();

    assert.equal(withPlainCapabilities(fn), fn);
    assert.equal(withPlainCapabilities(instance), instance, 'a non-plain object is left for the boundary to refuse');
  });

  it('survives a cyclic value without recursing forever', () => {
    const cyclic: Record<string, unknown> = {};

    cyclic.self = cyclic;
    assert.doesNotThrow(() => withPlainCapabilities(cyclic));
  });

  it('is cheap: 10,000 views of 100 capabilities and a million lookups on a 10,000-capability view', () => {
    const tokens = Array.from({ length: 100 }, (_, index) => `cap:n${String(index)}`);
    const big = createCapabilitySet(Array.from({ length: 10_000 }, (_, index) => `cap:b${String(index)}`));
    const started = performance.now();

    for (let index = 0; index < 10_000; index += 1) {
      createCapabilitySet(tokens);
    }

    let hits = 0;

    for (let index = 0; index < 1_000_000; index += 1) {
      if (big.has(`cap:b${String(index % 20_000)}`)) {
        hits += 1;
      }
    }

    const elapsed = performance.now() - started;

    assert.equal(hits, 500_000);
    assert.ok(elapsed < 10_000, `took ${elapsed.toFixed(0)} ms`);
  });
});

/** Describes a capabilities object as a participant would meet it. */
const SHAPE = `const shape = (c) => ({
  has: typeof c.has, includes: typeof c.includes, add: typeof c.add,
  size: c.size, list: [...c], json: JSON.stringify(c), frozen: Object.isFrozen(c),
});
const attack = (c) => {
  const outcomes = {};
  for (const [name, run] of Object.entries({
    add: () => c.add('vault:key'),
    delete: () => c.delete('x:one'),
    clear: () => c.clear(),
    protoAdd: () => Set.prototype.add.call(c, 'vault:key'),
    assign: () => { c.has = () => true; },
    define: () => Object.defineProperty(c, 'has', { value: () => true }),
  })) {
    try { run(); outcomes[name] = 'allowed'; } catch (error) { outcomes[name] = error.name; }
  }
  return outcomes;
};`;

const kindOwner = `const token = { id: 'acme.shop', description: 'shop', _brand: undefined };
const report = (globalThis.__eventsDeclarationFixture ??= {})[token.id] ??= {};
${SHAPE}
export function createService() {
  return {
    token, tier: 'userland', dependencies: [],
    manifest: {
      requests: { capabilities: [] },
      exposures: [{ name: 'acme.shop.dispatch', version: 1, scope: 'any' }],
      kinds: [{ kind: 'shop', exposure: 'acme.shop.dispatch', permission: { policyVersion: 2 }, operations: { look: {} } }],
      events: [],
    },
    factory: () => {
      const instance = {};
      Object.defineProperty(instance, 'provideExposure', {
        value: (name, major) => name === 'acme.shop.dispatch' && major === 1
          ? { projection: () => ({ dispatch: async (operation, context) => {
              report.kind = shape(context.caller.capabilities);
              report.kindAttack = attack(context.caller.capabilities);
              return { status: 'success', data: {} };
            } }) }
          : null,
        enumerable: false,
      });
      return instance;
    },
  };
}
`;

const POINT = 'acme.giver.peek';

async function boot(t: Parameters<typeof writeComposition>[0]): Promise<BrudKernel> {
  resetFixtureReports();

  return bootComposition(await writeComposition(t, [
    {
      // The giver is shown the caller; it also opens an interception point on its own exposure.
      token: 'acme.giver',
      exposures: [{ name: POINT, version: 1, scope: 'any' }],
      interceptionPoints: [{ exposure: POINT, admit: ['acme.icpt'] }],
      bindings: `{ '${POINT}@1': (caller) => { ${SHAPE}
        return { peek: () => {
          report.giverSaw = shape(caller.capabilities);
          report.giverAttack = attack(caller.capabilities);
          report.evaluate.evaluate('${POINT}@1', 'peek', [], { caller });
          return report.giverSaw;
        }, peekAs: (capabilities) => report.evaluate.evaluate('${POINT}@1', 'peek', [], {
          caller: { identity: 'who', callerClass: 'participant', official: false, origin: 'runtime', capabilities },
        }) };
      } }`,
      onRunning: "report.evaluate = registry.resolve('interception.evaluate');",
    },
    {
      token: 'acme.icpt',
      interceptions: [{ target: POINT }],
      intercept: `(call) => { ${SHAPE} (globalThis.__eventsDeclarationFixture['acme.icpt'] ??= {}).seen = shape(call.caller.capabilities); return { verdict: 'allow' }; }`,
    },
    { token: 'acme.shop', source: kindOwner },
    {
      token: 'acme.vault',
      exposures: [{ name: 'acme.vault.secret', version: 1, scope: 'any', policy: { policyVersion: 2, capabilities: ['vault:key'] } }],
      bindings: `{ 'acme.vault.secret@1': { read: () => 'secret' } }`,
    },
    {
      token: 'acme.asker',
      capabilities: ['x:one', 'a:two'],
      onRunning: `
        report.before = registry.resolve('acme.vault.secret') !== null;
        report.peek = registry.resolve('${POINT}').peek();
        report.after = registry.resolve('acme.vault.secret') !== null;
      `,
    },
  ]));
}

describe('Capability shape: one view for every participant', () => {
  it('shows an exposure giver, a kind owner and an interceptor the same read-only shape', async (t) => {
    const kernel = await boot(t);
    const registry = kernel.requestAccess<IExposedApiRegistry>({ callerId: 'acme.host', tier: 'core', options: {} }, ExposedApiRegistryToken);

    await kernel.runHostCall({ capabilities: ['x:one', 'a:two'] }, async () => {
      const router = registry.resolve<{ route(text: string): Promise<unknown> }>('syntax.route');

      await router?.route(brud(call('shop', 'look')));
    });

    const expected = { has: 'function', includes: 'undefined', add: 'undefined', size: 2, list: ['a:two', 'x:one'], json: '["a:two","x:one"]', frozen: true };

    assert.deepEqual(fixtureReports()['acme.asker']?.peek, expected, 'exposure handle caller');
    assert.deepEqual(fixtureReports()['acme.shop']?.kind, expected, 'kind dispatch caller');
    assert.deepEqual(fixtureReports()['acme.icpt']?.seen, expected, 'interceptor caller');
  });

  it('cannot be used to grant a caller capabilities: every attempt fails and the caller stays refused', async (t) => {
    await boot(t);

    const asker = fixtureReports()['acme.asker'];
    const giver = fixtureReports()['acme.giver'];

    assert.equal(asker?.before, false);
    assert.equal(asker?.after, false, 'the gated exposure stays refused after the giver tried to grant the capability');
    assert.deepEqual(giver?.giverAttack, {
      add: 'TypeError', delete: 'TypeError', clear: 'TypeError', protoAdd: 'TypeError', assign: 'TypeError', define: 'TypeError',
    });
    assert.deepEqual((asker?.peek as { list: string[] }).list, ['a:two', 'x:one'], 'the caller kept exactly what it was granted');
  });

  it('protects a host session caller the same way', async (t) => {
    const kernel = await boot(t);
    const registry = kernel.requestAccess<IExposedApiRegistry>({ callerId: 'acme.host', tier: 'core', options: {} }, ExposedApiRegistryToken);
    const seen = kernel.runHostCall({ capabilities: ['h:one'] }, () => registry.resolve<{ peek(): { list: string[] } }>(POINT)?.peek());

    assert.deepEqual(seen?.list, ['h:one']);
    assert.deepEqual(fixtureReports()['acme.giver']?.giverAttack, {
      add: 'TypeError', delete: 'TypeError', clear: 'TypeError', protoAdd: 'TypeError', assign: 'TypeError', define: 'TypeError',
    });
  });

  it('shows an interceptor the read-only shape even when the giver names a caller carrying a plain array or Set', async (t) => {
    const kernel = await boot(t);
    const registry = kernel.requestAccess<IExposedApiRegistry>({ callerId: 'acme.host', tier: 'core', options: {} }, ExposedApiRegistryToken);
    const giver = kernel.runHostCall({ capabilities: [] }, () => registry.resolve<{ peekAs(capabilities: unknown): unknown }>(POINT));

    for (const capabilities of [['b:two', 'a:one'], new Set(['b:two', 'a:one'])]) {
      delete (fixtureReports()['acme.icpt'] as Record<string, unknown>).seen;
      kernel.runHostCall({ capabilities: [] }, () => giver?.peekAs(capabilities));

      const seen = fixtureReports()['acme.icpt']?.seen as { has: string; includes: string; list: string[]; frozen: boolean };

      assert.deepEqual(seen.list, ['a:one', 'b:two']);
      assert.equal(seen.has, 'function');
      assert.equal(seen.includes, 'undefined');
      assert.equal(seen.frozen, true);
    }
  });
});
