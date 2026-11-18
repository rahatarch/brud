import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  ExposedApiRegistryToken,
  ParticipantManifestError,
  admitParticipantManifest,
  bootKernel,
  provisionIdentityRegistryStorage,
  type BrudKernel,
  type IExposedApiRegistry,
} from '../../index.js';
import {
  EventDuplicateDeclarationError,
  EventNameCollisionError,
} from '../../services/Events/index.js';

interface FixtureParticipant {
  readonly token: string;
  readonly official?: boolean;
  readonly capabilities?: readonly string[];
  readonly exposures?: readonly Readonly<Record<string, unknown>>[];
  readonly events?: readonly Readonly<Record<string, unknown>>[];
  readonly bindings?: string;
  readonly onRunning?: string;
}

function fixtureModule(participant: FixtureParticipant): string {
  const manifest = {
    requests: { capabilities: [...(participant.capabilities ?? [])] },
    exposures: [...(participant.exposures ?? [])],
    events: [...(participant.events ?? [])],
  };

  return `const token = { id: ${JSON.stringify(participant.token)}, description: 'events declaration fixture', _brand: undefined };
const REGISTRY = { id: ${JSON.stringify(ExposedApiRegistryToken.id)}, description: 'resolution primitive', _brand: undefined };
const report = (globalThis.__eventsDeclarationFixture ??= {})[token.id] ??= {};
const bindings = ${participant.bindings ?? '{}'};

export function createService() {
  return {
    token,
    tier: 'userland',
    dependencies: [],
    manifest: ${JSON.stringify(manifest)},
    factory: () => {
      const instance = {
        async onRunning(broker) {
          const registry = broker.requestAccess({ callerId: token.id, tier: 'userland', options: {} }, REGISTRY);
          ${participant.onRunning ?? ''}
        },
      };
      Object.defineProperty(instance, 'provideExposure', {
        value: (name, major) => {
          const bind = bindings[name + '@' + String(major)];
          if (!bind) return null;
          return { projection: () => bind };
        },
        enumerable: false,
      });
      return instance;
    },
  };
}
`;
}

interface FixtureComposition {
  readonly configPath: string;
  readonly options: Readonly<Record<string, unknown>>;
  readonly kernels: BrudKernel[];
}

async function writeComposition(
  t: TestContext,
  participants: readonly FixtureParticipant[],
): Promise<FixtureComposition> {
  const root = await mkdtemp(join(tmpdir(), 'brud-events-declaration-'));
  const kernels: BrudKernel[] = [];

  t.after(async () => {
    for (const kernel of kernels.splice(0)) {
      if (kernel.lifecycleState === 'RUNNING') {
        await kernel.shutdown();
      }
    }

    await rm(root, { recursive: true, force: true });
  });

  const identityPath = join(root, 'identity-registry.json');
  provisionIdentityRegistryStorage(identityPath);

  const services: { path: string; official?: boolean }[] = [
    { path: 'kernel:serviceModules/identityRegistry.js', official: true },
    { path: 'kernel:serviceModules/exposedApiRegistry.js', official: true },
    { path: 'kernel:serviceModules/parser.js', official: true },
    { path: 'kernel:serviceModules/router.js', official: true },
    { path: 'kernel:serviceModules/wasmCage.js', official: true },
    { path: 'kernel:serviceModules/events.js', official: true },
  ];

  for (const [index, participant] of participants.entries()) {
    const modulePath = join(root, `participant-${String(index)}.mjs`);

    await writeFile(modulePath, fixtureModule(participant), 'utf8');
    services.push(participant.official === undefined
      ? { path: modulePath }
      : { path: modulePath, official: participant.official });
  }

  const configPath = join(root, 'brud.config.json');
  await writeFile(configPath, JSON.stringify({ services }, null, 2), 'utf8');

  return {
    configPath,
    options: { 'identity.registry.path': identityPath, 'router.root': root },
    kernels,
  };
}

async function bootComposition(composition: FixtureComposition): Promise<BrudKernel> {
  const kernel = await bootKernel(composition.configPath, { options: composition.options });

  composition.kernels.push(kernel);

  return kernel;
}

function fixtureReports(): Record<string, Record<string, unknown>> {
  return (globalThis as { __eventsDeclarationFixture?: Record<string, Record<string, unknown>> })
    .__eventsDeclarationFixture ?? {};
}

function resetFixtureReports(): void {
  delete (globalThis as { __eventsDeclarationFixture?: unknown }).__eventsDeclarationFixture;
}

const PING_BINDINGS = `new Proxy({}, { get: (_, key) => ({ projection: () => ({ ping: () => String(key) }) }) })`;

describe('Events Step 3: manifest.events surface and catalogue', () => {
  it('admits manifest.events declarations and freezes the resulting array', () => {
    const empty = admitParticipantManifest('test.empty', undefined);
    assert.deepEqual(empty.events, []);
    assert.equal(Object.isFrozen(empty.events), true);

    const admitted = admitParticipantManifest('test.emitter', {
      events: [
        {
          name: 'test.settings.changed',
          version: 1,
          scope: 'runtime',
          policy: { policyVersion: 2, official: true },
        },
      ],
    });
    assert.equal(admitted.events.length, 1);
    assert.equal(admitted.events[0]?.name, 'test.settings.changed');
    assert.equal(admitted.events[0]?.version, 1);
    assert.equal(admitted.events[0]?.scope, 'runtime');
    assert.equal(Object.isFrozen(admitted.events), true);

    assert.throws(
      () => admitParticipantManifest('test.bad', {
        events: [{ name: 'test.bad', payloadSchema: { type: 'object' } }],
      }),
      (error: unknown) => error instanceof ParticipantManifestError && error.code === 'PARTICIPANT_MANIFEST_INVALID',
    );
  });

  it('registers manifest.events declarations in the events hardcore catalogue at boot and lists name@major', async (t) => {
    resetFixtureReports();

    const kernel = await bootComposition(await writeComposition(t, [
      {
        token: 'events.emitter.settings',
        events: [
          { name: 'test.settings.changed', version: 1, scope: 'runtime' },
          { name: 'test.settings.changed', version: '2.1.0', scope: 'runtime' },
        ],
      },
      {
        token: 'events.observer.runtime',
        onRunning: `
          const listHandle = registry.resolve('events.list');
          report.resolved = listHandle !== null;
          report.listed = listHandle ? listHandle.list() : null;
        `,
      },
    ]));

    assert.equal(kernel.lifecycleState, 'RUNNING');

    const reports = fixtureReports();
    const observerReport = reports['events.observer.runtime'];
    assert.equal(observerReport?.resolved, true);
    assert.deepEqual(observerReport?.listed, [
      'test.settings.changed@1',
      'test.settings.changed@2',
    ]);
  });

  it('refuses boot with EventNameCollisionError when a different identity declares the same event name', async (t) => {
    for (const version of [1, 2]) {
      const composition = await writeComposition(t, [
        {
          token: 'events.owner.first',
          events: [{ name: 'test.contested.event', version: 1, scope: 'runtime' }],
        },
        {
          token: 'events.owner.second',
          events: [{ name: 'test.contested.event', version, scope: 'runtime' }],
        },
      ]);

      await assert.rejects(
        bootKernel(composition.configPath, { options: composition.options }),
        (error: unknown) => {
          assert.ok(error instanceof EventNameCollisionError);
          assert.equal(error.code, 'EVENTS_NAME_COLLISION');
          assert.equal(error.eventName, 'test.contested.event');
          assert.equal(typeof error.owner, 'string');
          assert.ok(error.owner.length > 0);
          return true;
        },
        `version ${String(version)}`,
      );
    }
  });

  it('refuses boot with EventDuplicateDeclarationError when the same owner declares the same (name, major) twice', async (t) => {
    const composition = await writeComposition(t, [
      {
        token: 'events.owner.duplicate',
        events: [
          { name: 'test.duplicate.event', version: 1, scope: 'runtime' },
          { name: 'test.duplicate.event', version: '1.4.0', scope: 'runtime' },
        ],
      },
    ]);

    await assert.rejects(
      bootKernel(composition.configPath, { options: composition.options }),
      (error: unknown) => {
        assert.ok(error instanceof EventDuplicateDeclarationError);
        assert.equal(error.code, 'EVENTS_DUPLICATE_DECLARATION');
        assert.equal(error.eventName, 'test.duplicate.event');
        assert.equal(error.major, 1);
        return true;
      },
    );
  });

  it('preserves manifest.exposures admission and resolution alongside manifest.events', async (t) => {
    resetFixtureReports();

    const kernel = await bootComposition(await writeComposition(t, [
      {
        token: 'events.and.exposures.giver',
        exposures: [{ name: 'test.exposure.ping', version: 1, scope: 'any' }],
        events: [{ name: 'test.event.pinged', version: 1, scope: 'runtime' }],
        bindings: PING_BINDINGS,
        official: true,
      },
      {
        token: 'events.and.exposures.consumer',
        onRunning: `
          const pingHandle = registry.resolve('test.exposure.ping');
          const listHandle = registry.resolve('events.list');
          const eventAsExposure = registry.resolve('test.event.pinged');
          report.ping = pingHandle ? pingHandle.projection().ping() : null;
          report.events = listHandle ? listHandle.list() : null;
          report.eventAsExposure = eventAsExposure;
        `,
      },
    ]));

    assert.equal(kernel.lifecycleState, 'RUNNING');

    const registry = kernel.requestAccess<IExposedApiRegistry>(
      { callerId: 'host', tier: 'core', options: {} },
      ExposedApiRegistryToken,
    );
    const hostPing = kernel.runHostCall({}, () =>
      registry.resolve<{ readonly projection: () => { readonly ping: () => string } }>('test.exposure.ping'),
    );
    assert.ok(hostPing !== null);
    assert.equal(kernel.runHostCall({}, () => hostPing.projection().ping()), 'test.exposure.ping@1');

    const consumerReport = fixtureReports()['events.and.exposures.consumer'];
    assert.equal(consumerReport?.ping, 'test.exposure.ping@1');
    assert.deepEqual(consumerReport?.events, ['test.event.pinged@1']);
    assert.equal(consumerReport?.eventAsExposure, null);
  });
  it('Step 4: a participant subscription API calls events.subscribe and returns the events-hardcore-assigned identity', async (t) => {
    resetFixtureReports();

    const kernel = await bootComposition(await writeComposition(t, [
      {
        token: 'events.subscription.giver',
        events: [{ name: 'test.settings.changed', version: 1, scope: 'runtime' }],
        exposures: [
          { name: 'test.settings.subscribe', version: 1, scope: 'any' },
          { name: 'test.settings.subscribeUnknown', version: 1, scope: 'any' },
        ],
        bindings: `{
          'test.settings.subscribe@1': { subscribe: () => {
            const handle = report.registry.resolve('events.subscribe');
            return handle ? handle.subscribe('test.settings.changed') : null;
          } },
          'test.settings.subscribeUnknown@1': { subscribe: () => {
            const handle = report.registry.resolve('events.subscribe');
            return handle ? handle.subscribe('test.settings.absent') : null;
          } },
        }`,
        onRunning: 'report.registry = registry;',
      },
      {
        token: 'events.subscription.subscriber',
        onRunning: `
          const api = registry.resolve('test.settings.subscribe');
          const unknownApi = registry.resolve('test.settings.subscribeUnknown');
          report.mechanismResolvable = registry.resolve('events.subscribe') !== null;
          report.first = api ? api.subscribe() : 'unresolved';
          report.second = api ? api.subscribe() : 'unresolved';
          report.unknown = unknownApi ? unknownApi.subscribe() : 'unresolved';
        `,
      },
    ]));

    assert.equal(kernel.lifecycleState, 'RUNNING');

    const report = fixtureReports()['events.subscription.subscriber'];

    assert.equal(report?.mechanismResolvable, true);
    assert.equal(report?.first, 'test.settings.changed@1#1');
    assert.equal(report?.second, 'test.settings.changed@1#2');
    assert.equal(report?.unknown, null);
  });
});