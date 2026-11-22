/**
 * Kind handlers run as their owner. A participant that owns a kind is entitled
 * to an exposure another participant gates behind a capability; when the
 * Router reaches the owner's handler for a host call that lacks the capability,
 * the handler's own `resolve` must still use the owner's identity and grants.
 * Throwaway participants only.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ExposedApiRegistryToken, type IExposedApiRegistry } from '../../index.js';
import { brud, call } from './support/probeKernel.js';
import {
  bootComposition,
  fixtureReports,
  resetFixtureReports,
  writeComposition,
} from './support/participantFixture.js';

const GATED = 'acme.gate.secret';
const CAPABILITY = 'acme:secret';

/** A kind owner whose handler tries to resolve the gated exposure and reports the outcome. */
const kindOwnerSource = `const token = { id: 'acme.kindowner', description: 'kind owner', _brand: undefined };
const REGISTRY = { id: ${JSON.stringify(ExposedApiRegistryToken.id)}, description: 'resolution primitive', _brand: undefined };
const report = (globalThis.__eventsDeclarationFixture ??= {})[token.id] ??= {};
let registry;

export function createService() {
  return {
    token,
    tier: 'userland',
    dependencies: [],
    manifest: {
      requests: { capabilities: [${JSON.stringify(CAPABILITY)}] },
      exposures: [{ name: 'acme.kindowner.dispatch', version: 1, scope: 'any', policy: { policyVersion: 2, official: true } }],
      kinds: [{
        kind: 'peeker',
        exposure: 'acme.kindowner.dispatch',
        description: 'resolves a gated exposure from its handler',
        operations: { peek: { description: 'Resolve the gated exposure' } },
      }],
      events: [],
    },
    factory: () => {
      const instance = {
        async onRunning(broker) {
          registry = broker.requestAccess({ callerId: token.id, tier: 'userland', options: {} }, REGISTRY);
        },
      };
      Object.defineProperty(instance, 'provideExposure', {
        value: (name, major) => name === 'acme.kindowner.dispatch' && major === 1
          ? { projection: () => ({
              dispatch: async () => {
                const handle = registry.resolve(${JSON.stringify(GATED)});
                report.handlerResolved = handle !== null;
                return { status: 'success', data: { resolved: handle !== null } };
              },
            }) }
          : null,
        enumerable: false,
      });
      return instance;
    },
  };
}
`;

async function boot(t: Parameters<typeof writeComposition>[0]) {
  resetFixtureReports();

  return bootComposition(await writeComposition(t, [
    {
      token: 'acme.gate',
      exposures: [{
        name: GATED,
        version: 1,
        scope: 'any',
        policy: { policyVersion: 2, official: true, capabilities: [CAPABILITY] },
      }],
      bindings: `{ '${GATED}@1': { read: () => 'secret' } }`,
    },
    { token: 'acme.kindowner', source: kindOwnerSource },
  ]));
}

describe('Kind handler frame (defect item 4)', () => {
  it('control: a host caller without the capability cannot resolve the gated exposure', async (t) => {
    const kernel = await boot(t);
    const registry = kernel.requestAccess<IExposedApiRegistry>(
      { callerId: 'acme.host', tier: 'core', options: {} },
      ExposedApiRegistryToken,
    );

    assert.equal(kernel.runHostCall({ capabilities: [] }, () => registry.resolve(GATED)), null);
  });

  it("runs a kind's handler as its owner, so the owner's own grants reach resolve", async (t) => {
    const kernel = await boot(t);
    const registry = kernel.requestAccess<IExposedApiRegistry>(
      { callerId: 'acme.host', tier: 'core', options: {} },
      ExposedApiRegistryToken,
    );
    const routed = await kernel.runHostCall({ capabilities: [] }, async () => {
      const router = registry.resolve<{ route(text: string): Promise<{ operations: readonly { status: string; result?: { data?: { resolved?: boolean } } }[] }> }>('syntax.route');

      assert.notEqual(router, null);

      return router!.route(brud(call('peeker', 'peek')));
    });

    assert.equal(routed.operations[0]?.status, 'success');
    assert.equal(fixtureReports()['acme.kindowner']?.handlerResolved, true, 'the handler must resolve with the owner grants, not the router frame');
    assert.equal(routed.operations[0]?.result?.data?.resolved, true);
  });
});
