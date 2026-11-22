/**
 * Structured refusals for `resolve` (defect items 12, 5, 6), proven end to end
 * on a real booted kernel with throwaway participants: every refusal code, the
 * promise that a refusal never reveals whether an exposure exists, isolation
 * between call frames, and behaviour under load and abuse.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  ExposedApiRegistryToken,
  type BrudKernel,
  type ExposedApiRefusal,
  type IExposedApiRegistry,
} from '../../index.js';
import {
  bootComposition,
  resetFixtureReports,
  writeComposition,
} from './support/participantFixture.js';

const GATED = 'acme.vault.secret';
const CAPABILITY = 'acme:vault-key';

async function boot(t: Parameters<typeof writeComposition>[0]): Promise<{ kernel: BrudKernel; registry: IExposedApiRegistry }> {
  resetFixtureReports();

  const kernel = await bootComposition(await writeComposition(t, [
    {
      token: 'acme.vault',
      exposures: [
        { name: GATED, version: 1, scope: 'any', policy: { policyVersion: 2, capabilities: [CAPABILITY] } },
        { name: 'acme.vault.open', version: 1, scope: 'any' },
        { name: 'acme.vault.picky', version: 1, scope: 'any' },
      ],
      bindings: `{ '${GATED}@1': { read: () => 'secret' }, 'acme.vault.open@1': { read: () => 'open' }, 'acme.vault.picky@1': () => null }`,
    },
  ]));
  const registry = kernel.requestAccess<IExposedApiRegistry>(
    { callerId: 'acme.host', tier: 'core', options: {} },
    ExposedApiRegistryToken,
  );

  return { kernel, registry };
}

const inHost = <T,>(kernel: BrudKernel, run: () => T, capabilities: readonly string[] = []): T =>
  kernel.runHostCall({ capabilities: [...capabilities] }, run);

describe('resolve refusals: codes', () => {
  it('reads null after a successful resolve and null when no resolve was made', async (t) => {
    const { kernel, registry } = await boot(t);

    inHost(kernel, () => {
      assert.equal(registry.lastRefusal(), null);
      assert.notEqual(registry.resolve('acme.vault.open'), null);
      assert.equal(registry.lastRefusal(), null);
    });
  });

  it('reports malformed-request for a bad version, and clears when the next resolve succeeds', async (t) => {
    const { kernel, registry } = await boot(t);

    inHost(kernel, () => {
      assert.equal(registry.resolve('acme.vault.open', { version: 0 }), null);
      assert.equal(registry.lastRefusal()?.code, 'malformed-request');
      assert.notEqual(registry.resolve('acme.vault.open'), null);
      assert.equal(registry.lastRefusal(), null);
    });
  });

  it('reports limit-exceeded for an oversized request', async (t) => {
    const { kernel, registry } = await boot(t);

    inHost(kernel, () => {
      assert.equal(registry.resolve('x'.repeat(70_000)), null);
      assert.equal(registry.lastRefusal()?.code, 'limit-exceeded');
    });
  });

  it('reports no-call-context outside any frame, as in a participant synchronous create', async (t) => {
    const { registry } = await boot(t);

    assert.equal(registry.resolve('acme.vault.open'), null);
    assert.equal(registry.lastRefusal()?.code, 'no-call-context');
    assert.match(registry.lastRefusal()?.message ?? '', /not attached yet/u);
  });

  it('reports unavailable, and records it, when the giver projection declines the caller', async (t) => {
    const { kernel, registry } = await boot(t);

    inHost(kernel, () => {
      assert.equal(registry.resolve('acme.vault.picky'), null);
      assert.equal(registry.lastRefusal()?.code, 'unavailable');
    });
  });

  it('tells a host-origin caller that a runtime-scoped event exposure was unavailable to it (item 5)', async (t) => {
    const { kernel, registry } = await boot(t);

    inHost(kernel, () => {
      assert.equal(registry.resolve('events.emit'), null);

      const refusal = registry.lastRefusal();

      assert.equal(refusal?.code, 'unavailable');
      assert.equal(refusal?.callerOrigin, 'host');
      assert.equal(refusal?.callerClass, 'host');
    });
  });
});

describe('resolve refusals: security', () => {
  it('does not let a caller tell a missing exposure from a policy-denied one', async (t) => {
    const { kernel, registry } = await boot(t);

    const [missing, denied] = inHost(kernel, () => {
      registry.resolve('acme.vault.does-not-exist');
      const first = registry.lastRefusal();

      registry.resolve(GATED);

      return [first, registry.lastRefusal()] as const;
    });

    assert.deepEqual(missing, denied, 'a policy denial and a missing exposure must explain identically');
    assert.equal(denied?.code, 'unavailable');
  });

  it('never names an exposure, owner, scope, policy or capability in any refusal', async (t) => {
    const { kernel, registry } = await boot(t);
    const refusals: (ExposedApiRefusal | null)[] = inHost(kernel, () => {
      const seen: (ExposedApiRefusal | null)[] = [];

      for (const name of [GATED, 'acme.vault.does-not-exist', 'events.emit']) {
        registry.resolve(name);
        seen.push(registry.lastRefusal());
      }

      registry.resolve(GATED, { version: 0 });
      seen.push(registry.lastRefusal());

      return seen;
    });

    for (const refusal of refusals) {
      const text = JSON.stringify(refusal);

      for (const secret of ['vault', CAPABILITY, 'acme', 'scope', 'runtime', 'identity']) {
        assert.equal(text.includes(secret), false, `refusal leaks "${secret}": ${text}`);
      }
    }
  });

  it('gives a caller with the capability the handle and no refusal', async (t) => {
    const { kernel, registry } = await boot(t);

    inHost(kernel, () => {
      assert.notEqual(registry.resolve(GATED), null);
      assert.equal(registry.lastRefusal(), null);
    }, [CAPABILITY]);
  });

  it('hands out frozen refusals and a public view with exactly resolve and lastRefusal', async (t) => {
    const { kernel, registry } = await boot(t);

    assert.deepEqual(Object.keys(registry).sort(), ['lastRefusal', 'resolve']);

    inHost(kernel, () => {
      registry.resolve('acme.vault.does-not-exist');

      const refusal = registry.lastRefusal();

      assert.equal(Object.isFrozen(refusal), true);
      assert.throws(() => { (refusal as { code: string }).code = 'x'; }, TypeError);
    });
  });

  it('keeps one caller refusal invisible to another, including a concurrent frame', async (t) => {
    const { kernel, registry } = await boot(t);
    const gate = Promise.withResolvers<void>();
    const refused = inHost(kernel, async () => {
      registry.resolve('acme.vault.does-not-exist');
      await gate.promise;

      return registry.lastRefusal();
    });
    const succeeded = inHost(kernel, async () => {
      await Promise.resolve();
      registry.resolve('acme.vault.open');
      gate.resolve();

      return registry.lastRefusal();
    });

    assert.equal((await refused)?.code, 'unavailable', 'a later success in another frame must not clear this frame');
    assert.equal(await succeeded, null, 'another frame refusal must not appear here');
  });
});

describe('resolve refusals: load and abuse', () => {
  it('stays cheap: 5,000 refused resolves with refusal reads in one frame', async (t) => {
    const { kernel, registry } = await boot(t);
    const started = performance.now();

    inHost(kernel, () => {
      for (let index = 0; index < 5_000; index += 1) {
        registry.resolve('acme.vault.does-not-exist');
        assert.equal(registry.lastRefusal()?.code, 'unavailable');
      }
    });

    const elapsed = performance.now() - started;

    assert.ok(elapsed < 3_000, `5,000 refusals took ${elapsed.toFixed(0)} ms`);
  });

  it('turns a call flood into limit-exceeded and recovers in a new window', async (t) => {
    const { kernel, registry } = await boot(t);
    let sawLimit = false;

    inHost(kernel, () => {
      for (let index = 0; index < 60_000 && !sawLimit; index += 1) {
        registry.resolve('acme.vault.open');
        sawLimit = registry.lastRefusal()?.code === 'limit-exceeded';
      }
    });

    assert.equal(sawLimit, true, 'the flood must reach the call limit');

    await new Promise((resolve) => setTimeout(resolve, 1_100));

    inHost(kernel, () => {
      assert.notEqual(registry.resolve('acme.vault.open'), null);
      assert.equal(registry.lastRefusal(), null);
    });
  });

  it('holds many concurrent frames without crossing their refusals', async (t) => {
    const { kernel, registry } = await boot(t);
    const frames = Array.from({ length: 500 }, (_, index) => inHost(kernel, async () => {
      const refuse = index % 2 === 0;

      await Promise.resolve();
      registry.resolve(refuse ? 'acme.vault.does-not-exist' : 'acme.vault.open');
      await new Promise((resolve) => setImmediate(resolve));

      return { refuse, code: registry.lastRefusal()?.code ?? null };
    }));
    const results = await Promise.all(frames);

    for (const { refuse, code } of results) {
      assert.equal(code, refuse ? 'unavailable' : null);
    }
  });
});
