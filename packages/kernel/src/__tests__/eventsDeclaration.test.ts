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
  configureEventsLimits,
  resetEventsLimits,
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
          return { projection: (_service, caller) => (typeof bind === 'function' ? bind(caller) : bind) };
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
        events: [{ name: 'test.bad', payloadSchema: 'not-an-object' }],
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
          'test.settings.subscribe@1': (caller) => ({ subscribe: () => {
            const handle = report.registry.resolve('events.subscribe');
            return handle ? handle.subscribe('test.settings.changed', { subscriber: caller }) : null;
          } }),
          'test.settings.subscribeUnknown@1': (caller) => ({ subscribe: () => {
            const handle = report.registry.resolve('events.subscribe');
            return handle ? handle.subscribe('test.settings.absent', { subscriber: caller }) : null;
          } }),
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
          const pull = registry.resolve('events.pull');
          report.ownPull = pull ? pull.pull(report.first) : 'unresolved';
          const forged = registry.resolve('events.subscribe');
          report.forged = forged ? forged.subscribe('test.settings.changed', { subscriber: { identity: 'someone-else' } }) : 'unresolved';
        `,
      },
    ]));

    assert.equal(kernel.lifecycleState, 'RUNNING');

    const report = fixtureReports()['events.subscription.subscriber'];

    assert.equal(report?.mechanismResolvable, true);
    assert.equal(report?.first, 'test.settings.changed@1#1');
    assert.equal(report?.second, 'test.settings.changed@1#2');
    assert.equal(report?.unknown, null);
    // Delegation by the owner: the recorded subscriber is the end subscriber.
    assert.deepEqual(report?.ownPull, []);
    // A non-owner cannot forward a subscriber view.
    assert.equal(report?.forged, null);
  });
});

/**
 * A real subscriber participant: it resolves its own `events.pull` / `events.close`
 * handles, subscribes, and exposes `<token>.drain` so a later participant can
 * trigger a pull that runs as this subscriber on a runtime chain.
 */
function subscriber(token: string, event: string, options = '{}', extra = ''): FixtureParticipant {
  return {
    token,
    exposures: [{ name: `${token}.drain`, version: 1, scope: 'any' }],
    bindings: `{ '${token}.drain@1': { pull: (id, options) => report.pull.pull(id ?? report.sub, options) } }`,
    onRunning: `
      report.pull = registry.resolve('events.pull');
      report.close = registry.resolve('events.close');
      report.sub = registry.resolve('events.subscribe').subscribe('${event}', ${options});
      ${extra}
    `,
  };
}

/** A reader participant that runs last and drains subscribers through their exposures. */
function reader(script: string): FixtureParticipant {
  return {
    token: 'events.reader',
    onRunning: `
      const drain = (token, id, options) => registry.resolve(token + '.drain').pull(id, options);
      const subOf = (token) => globalThis.__eventsDeclarationFixture[token].sub;
      ${script}
    `,
  };
}

function sequences(batch: unknown): readonly number[] {
  assert.ok(Array.isArray(batch), `expected a batch, received ${JSON.stringify(batch)}`);

  return (batch as readonly { readonly sequence: number }[]).map((record) => record.sequence);
}

function reasonOf(value: unknown): unknown {
  return (value as { readonly reason?: unknown } | null)?.reason;
}

describe('Events Step 5: delivery machinery', () => {
  it('delivers with a shared per-event sequence, reconnects from the retention log, and refuses malformed and non-owner emits', async (t) => {
    resetFixtureReports();

    const kernel = await bootComposition(await writeComposition(t, [
      subscriber('events.delivery.first', 'test.delivery.ping', '{}',
        "report.nonOwner = registry.resolve('events.emit').emit('test.delivery.ping', { n: 0 });"),
      subscriber('events.delivery.second', 'test.delivery.ping'),
      {
        token: 'events.delivery.giver',
        events: [{
          name: 'test.delivery.ping',
          version: 1,
          scope: 'any',
          payloadSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'], additionalProperties: false },
        }],
        onRunning: `
          const emit = registry.resolve('events.emit');
          report.r1 = emit.emit('test.delivery.ping', { n: 1 });
          report.bad = emit.emit('test.delivery.ping', { n: 'one' });
          report.r2 = emit.emit('test.delivery.ping', { n: 2 });
          report.r3 = emit.emit('test.delivery.ping', { n: 3 });
        `,
      },
      reader(`
        report.first = drain('events.delivery.first');
        report.firstAgain = drain('events.delivery.first');
        report.second = drain('events.delivery.second');
        report.reconnect = drain('events.delivery.first', undefined, { lastSequence: 1 });
        report.batchOfOne = drain('events.delivery.second', undefined, { lastSequence: 0, maxBatch: 1 });
      `),
    ]));
    const reports = fixtureReports();
    const giver = reports['events.delivery.giver'];
    const read = reports['events.reader'];

    assert.deepEqual([giver?.r1, giver?.r2, giver?.r3].map((r) => (r as { sequence: number }).sequence), [1, 2, 3]);
    assert.equal(reasonOf(giver?.bad), 'malformed');
    assert.equal(reasonOf(reports['events.delivery.first']?.nonOwner), 'refused');
    assert.deepEqual(sequences(read?.first), [1, 2, 3]);
    assert.deepEqual(sequences(read?.second), [1, 2, 3]);
    assert.deepEqual(read?.firstAgain, []);
    assert.deepEqual(sequences(read?.reconnect), [2, 3]);
    assert.deepEqual(sequences(read?.batchOfOne), [1]);

    const [delivery] = read?.first as readonly Record<string, unknown>[];

    assert.equal(delivery?.['eventName'], 'test.delivery.ping');
    assert.equal(delivery?.['eventVersion'], 1);
    assert.equal(delivery?.['emitOrigin'], 'runtime');
    assert.equal(typeof delivery?.['emitterIdentity'], 'string');
    assert.deepEqual(delivery?.['payload'], { n: 1 });

    const observed = kernel.readObservations().map((observation) => observation.event);

    assert.ok(observed.includes('events.emit.malformed'));
    assert.ok(observed.includes('events.emit.refused'));
  });

  it('refuses a runtime-origin pull on a kernel-scope event, and keeps a policy-refused subscription open with a refusal on every pull', async (t) => {
    resetFixtureReports();

    const kernel = await bootComposition(await writeComposition(t, [
      subscriber('events.scope.kernel', 'test.scope.kernelOnly', '{}', 'report.inline = report.pull.pull(report.sub);'),
      subscriber('events.scope.policy', 'test.policy.kernelOrigin'),
      {
        token: 'events.scope.giver',
        events: [
          { name: 'test.scope.kernelOnly', version: 1, scope: 'kernel' },
          { name: 'test.policy.kernelOrigin', version: 1, scope: 'any', policy: { policyVersion: 2, origins: ['kernel'] } },
        ],
        onRunning: `
          const emit = registry.resolve('events.emit');
          report.k = emit.emit('test.scope.kernelOnly', {});
          report.p = emit.emit('test.policy.kernelOrigin', {});
        `,
      },
      reader(`
        report.kernelScope = drain('events.scope.kernel');
        report.policy1 = drain('events.scope.policy');
        report.policy2 = drain('events.scope.policy');
      `),
    ]));
    const reports = fixtureReports();
    const read = reports['events.reader'];

    assert.equal((reports['events.scope.giver']?.k as { ok: boolean }).ok, true);
    assert.equal(reasonOf(reports['events.scope.kernel']?.inline), 'policy-refused');
    assert.equal(reasonOf(read?.kernelScope), 'policy-refused');
    assert.equal(reasonOf(read?.policy1), 'policy-refused');
    assert.equal(reasonOf(read?.policy2), 'policy-refused');
    assert.ok(kernel.readObservations().some((observation) => observation.event === 'events.pull.refused'));
  });

  it('enforces drop-oldest, drop-newest, and refuse-emit per subscriber without blocking the others', async (t) => {
    resetFixtureReports();
    configureEventsLimits({ retentionDepth: 4, queueDepth: 2, batchSize: 10 });
    t.after(() => { resetEventsLimits(); });

    const kernel = await bootComposition(await writeComposition(t, [
      subscriber('events.bp.oldest', 'test.bp.tick', "{ policy: 'drop-oldest' }"),
      subscriber('events.bp.newest', 'test.bp.tick', "{ policy: 'drop-newest' }"),
      subscriber('events.bp.refuse', 'test.bp.tick', "{ policy: 'refuse-emit' }"),
      {
        token: 'events.bp.giver',
        events: [{ name: 'test.bp.tick', version: 1, scope: 'any' }],
        onRunning: `
          const emit = registry.resolve('events.emit');
          report.results = [1, 2, 3].map((n) => emit.emit('test.bp.tick', { n }));
        `,
      },
      reader(`
        report.oldest = drain('events.bp.oldest');
        report.newest = drain('events.bp.newest');
        report.refuse = drain('events.bp.refuse');
      `),
    ]));
    const reports = fixtureReports();
    const read = reports['events.reader'];
    const results = reports['events.bp.giver']?.results as readonly { ok: boolean; refusedSubscriptions: readonly string[] }[];

    assert.deepEqual(results.map((result) => result.ok), [true, true, true]);
    assert.deepEqual(results[2]?.refusedSubscriptions, [reports['events.bp.refuse']?.sub]);
    assert.deepEqual(sequences(read?.oldest), [2, 3]);
    assert.deepEqual(sequences(read?.newest), [1, 2]);
    assert.deepEqual(sequences(read?.refuse), [1, 2]);
    assert.equal(kernel.readObservations().filter((observation) => observation.event === 'events.delivery.dropped').length, 3);
  });

  it('close tombstones the subscription, refuses a different subscriber, and a pull after close returns closed', async (t) => {
    resetFixtureReports();

    await bootComposition(await writeComposition(t, [
      subscriber('events.close.subscriber', 'test.close.ping', '{}', `
        report.closed = registry.resolve('events.subscribe').subscribe('test.close.ping');
        report.closeResult = report.close.close(report.closed);
        report.afterClose = report.pull.pull(report.closed);
      `),
      {
        token: 'events.close.intruder',
        onRunning: `
          const victim = globalThis.__eventsDeclarationFixture['events.close.subscriber'].sub;
          report.intrusion = registry.resolve('events.close').close(victim);
          report.intrusionPull = registry.resolve('events.pull').pull(victim);
        `,
      },
      {
        token: 'events.close.giver',
        events: [{ name: 'test.close.ping', version: 1, scope: 'any' }],
        onRunning: "registry.resolve('events.emit').emit('test.close.ping', { n: 1 });",
      },
      reader(`
        report.kept = drain('events.close.subscriber');
        report.closed = drain('events.close.subscriber', globalThis.__eventsDeclarationFixture['events.close.subscriber'].closed);
        report.unknown = drain('events.close.subscriber', 'test.close.ping@1#999');
      `),
    ]));
    const reports = fixtureReports();
    const owner = reports['events.close.subscriber'];
    const intruder = reports['events.close.intruder'];
    const read = reports['events.reader'];

    assert.equal(owner?.closeResult, undefined);
    assert.equal(reasonOf(owner?.afterClose), 'closed');
    assert.equal(reasonOf(intruder?.intrusion), 'not-subscriber');
    assert.equal(reasonOf(intruder?.intrusionPull), 'not-subscriber');
    assert.deepEqual(sequences(read?.kept), [1]);
    assert.equal(reasonOf(read?.closed), 'closed');
    assert.equal(reasonOf(read?.unknown), 'unknown-subscription');
  });
});
