/**
 * The kernel's registry of the operations under each kind, and the permission
 * to call each one (defect item 3). A kind lists every operation it serves and
 * gives each a permission; the Router refuses an undeclared or unpermitted
 * operation on arrival, before the owner's handler is reached. Proven on a
 * real booted kernel with a throwaway participant whose handler counts calls.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  ExposedApiRegistryToken,
  ParticipantManifestError,
  admitParticipantManifest,
  bootKernel,
  type BrudKernel,
  type IExposedApiRegistry,
} from '../../index.js';
import { RouterInvalidDeclarationError } from '../../services/Router/index.js';
import { brud, call } from './support/probeKernel.js';
import {
  bootComposition,
  fixtureReports,
  resetFixtureReports,
  writeComposition,
} from './support/participantFixture.js';

const OPEN = { policyVersion: 2 };

/** A kind owner whose handler counts every call that reaches it. */
const ownerSource = (kinds: unknown): string => `const token = { id: 'acme.shop', description: 'shop', _brand: undefined };
const report = (globalThis.__eventsDeclarationFixture ??= {})[token.id] ??= { calls: [] };

export function createService() {
  return {
    token,
    tier: 'userland',
    dependencies: [],
    manifest: {
      requests: { capabilities: [] },
      exposures: [{ name: 'acme.shop.dispatch', version: 1, scope: 'any', policy: { policyVersion: 2 } }],
      kinds: ${JSON.stringify(kinds)},
      events: [],
    },
    factory: () => {
      const instance = {};
      Object.defineProperty(instance, 'provideExposure', {
        value: (name, major) => name === 'acme.shop.dispatch' && major === 1
          ? { projection: () => ({
              dispatch: async (operation) => {
                report.calls.push(operation.name);
                return { status: 'success', data: { ran: operation.name } };
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

const SHOP = [{
  kind: 'shop',
  exposure: 'acme.shop.dispatch',
  description: 'A shop',
  permission: { policyVersion: 2, capabilities: ['shop:read'] },
  operations: {
    browse: { description: 'Look around' },
    checkout: { permission: { policyVersion: 2, capabilities: ['shop:buy'] } },
    status: { permission: OPEN },
    runtime_only: { permission: { policyVersion: 2, origins: ['runtime'] } },
    host_only: { permission: { policyVersion: 2, callerClasses: ['host'] } },
  },
}];

interface Routed {
  readonly status: string;
  readonly failed: number;
  readonly operations: readonly { readonly status: string; readonly error?: string; readonly result?: { readonly data?: Record<string, unknown> } }[];
}

async function boot(t: Parameters<typeof writeComposition>[0], kinds: unknown = SHOP): Promise<BrudKernel> {
  resetFixtureReports();

  return bootComposition(await writeComposition(t, [{ token: 'acme.shop', source: ownerSource(kinds) }]));
}

type Router = { route(text: string, options?: Record<string, unknown>): Promise<Routed>; kinds(): readonly Record<string, unknown>[] };

function router(kernel: BrudKernel, run: (router: Router) => Promise<unknown>, capabilities: readonly string[] = []): Promise<unknown> {
  const registry = kernel.requestAccess<IExposedApiRegistry>({ callerId: 'acme.host', tier: 'core', options: {} }, ExposedApiRegistryToken);

  return kernel.runHostCall({ capabilities: [...capabilities] }, async () => {
    const handle = registry.resolve<Router>('syntax.route');

    assert.notEqual(handle, null);

    return run(handle as Router);
  });
}

const route = (kernel: BrudKernel, text: string, capabilities: readonly string[] = [], options?: Record<string, unknown>): Promise<Routed> =>
  router(kernel, (handle) => handle.route(text, options), capabilities) as Promise<Routed>;

const calls = (): readonly string[] => (fixtureReports()['acme.shop']?.calls ?? []) as readonly string[];

describe('Kind operation registry: declaration', () => {
  const declare = (kind: Record<string, unknown>): void => {
    admitParticipantManifest('acme.shop', {
      exposures: [{ name: 'acme.shop.dispatch', version: 1 }],
      kinds: [{ kind: 'shop', exposure: 'acme.shop.dispatch', ...kind }],
    });
  };
  const refuses = (kind: Record<string, unknown>, pattern: RegExp): void => {
    assert.throws(() => declare(kind), (error: unknown) => error instanceof ParticipantManifestError && pattern.test(error.message));
  };

  it('admits a kind whose operations each have a permission, or inherit the kind default', () => {
    declare({ operations: { a: { permission: OPEN } } });
    declare({ permission: OPEN, operations: { a: {}, b: { permission: OPEN } } });
  });

  it('refuses a kind with no operations, an empty list, or a list that is not an object', () => {
    refuses({ permission: OPEN }, /operations is required/);
    refuses({ permission: OPEN, operations: {} }, /operations is required/);
    refuses({ permission: OPEN, operations: [] }, /operations is required/);
  });

  it('refuses an operation with no permission when the kind declares none', () => {
    refuses({ operations: { a: {} } }, /permission is required/);
    refuses({ operations: { a: { permission: OPEN }, b: {} } }, /operations\.b\.permission is required/);
  });

  it('refuses malformed names and malformed permissions', () => {
    refuses({ permission: OPEN, operations: { '1bad': {} } }, /operation names start with a letter/);
    refuses({ permission: OPEN, operations: { __proto__x: {} } }, /operation names start with a letter/);
    refuses({ permission: 'open', operations: { a: {} } }, /permission must be a policy object/);
    refuses({ operations: { a: { permission: 'open' } } }, /permission must be a policy object/);
    refuses({ permission: OPEN, operations: { a: { permision: OPEN } } }, /unknown|not allowed|permision/i);
  });

  it('refuses boot, naming the kind, when a permission is not a valid policy', async (t) => {
    for (const permission of [
      { policyVersion: 1 },
      { policyVersion: 2, capabilites: ['x:y'] },
      { policyVersion: 2, callerClasses: ['nobody'] },
      { policyVersion: 2, parentCallerClasses: ['participant'] },
    ]) {
      const composition = await writeComposition(t, [{
        token: 'acme.shop',
        source: ownerSource([{ ...SHOP[0], permission, operations: { browse: {} } }]),
      }]);

      await assert.rejects(
        bootKernel(composition.configPath, { options: composition.options }),
        (error: unknown) => error instanceof RouterInvalidDeclarationError && error.kind === 'shop',
        JSON.stringify(permission),
      );
    }
  });
});

describe('Kind operation registry: dispatch', () => {
  it('serves a declared, permitted operation, and the handler runs once', async (t) => {
    const kernel = await boot(t);
    const routed = await route(kernel, brud(call('shop', 'browse')), ['shop:read']);

    assert.equal(routed.status, 'success');
    assert.deepEqual(calls(), ['browse']);
  });

  it('refuses an undeclared operation before the handler: zero handler calls', async (t) => {
    const kernel = await boot(t);
    const routed = await route(kernel, brud(call('shop', 'delete_everything')), ['shop:read', 'shop:buy']);

    assert.equal(routed.operations[0]?.status, 'operation_not_declared');
    assert.match(routed.operations[0]?.error ?? '', /^OPERATION_NOT_DECLARED: /);
    assert.equal(routed.failed, 1);
    assert.equal(routed.status, 'failed');
    assert.deepEqual(calls(), []);
  });

  it('refuses a caller who lacks the permission before the handler, and serves one who has it', async (t) => {
    const kernel = await boot(t);
    const denied = await route(kernel, brud(call('shop', 'checkout')), ['shop:read']);

    assert.equal(denied.operations[0]?.status, 'permission_denied');
    assert.match(denied.operations[0]?.error ?? '', /^PERMISSION_DENIED: /);
    assert.deepEqual(calls(), [], 'the handler must not be reached');

    const allowed = await route(kernel, brud(call('shop', 'checkout')), ['shop:buy']);

    assert.equal(allowed.operations[0]?.status, 'success');
    assert.deepEqual(calls(), ['checkout']);
  });

  it('applies the kind default to an operation that declares none, and lets an operation override it', async (t) => {
    const kernel = await boot(t);

    assert.equal((await route(kernel, brud(call('shop', 'browse')), [])).operations[0]?.status, 'permission_denied');
    assert.equal((await route(kernel, brud(call('shop', 'status')), [])).operations[0]?.status, 'success', 'an open override beats a restrictive default');
    assert.equal((await route(kernel, brud(call('shop', 'checkout')), ['shop:read'])).operations[0]?.status, 'permission_denied', 'a stricter own permission beats the default');
    assert.deepEqual(calls(), ['status']);
  });

  it('evaluates origin and caller class with the exposure policy language', async (t) => {
    const kernel = await boot(t);

    assert.equal((await route(kernel, brud(call('shop', 'runtime_only')))).operations[0]?.status, 'permission_denied', 'a host call is not a runtime origin');
    assert.equal((await route(kernel, brud(call('shop', 'host_only')))).operations[0]?.status, 'success');
  });

  it('checks a dry run the same way, since a dry run also reaches the handler', async (t) => {
    const kernel = await boot(t);
    const routed = await route(kernel, brud(call('shop', 'checkout')), [], { dryRun: true });

    assert.equal(routed.operations[0]?.status, 'permission_denied');
    assert.deepEqual(calls(), []);
  });

  it('refuses per operation: a mixed document runs what is allowed and reports the rest', async (t) => {
    const kernel = await boot(t);
    const routed = await route(kernel, brud(
      call('shop', 'browse'),
      call('shop', 'checkout'),
      call('shop', 'nope'),
      call('shop', 'status'),
    ), ['shop:read']);

    assert.deepEqual(routed.operations.map((operation) => operation.status), ['success', 'permission_denied', 'operation_not_declared', 'success']);
    assert.equal(routed.status, 'partial');
    assert.equal(routed.failed, 2);
    assert.deepEqual(calls(), ['browse', 'status']);
  });

  it('skips the rest after a refusal when stopOnFailure is set', async (t) => {
    const kernel = await boot(t);
    const routed = await route(kernel, brud(call('shop', 'nope'), call('shop', 'status')), [], { stopOnFailure: true });

    assert.deepEqual(routed.operations.map((operation) => operation.status), ['operation_not_declared', 'skipped']);
    assert.deepEqual(calls(), []);
  });
});

describe('Kind operation registry: security', () => {
  it('never tells the caller what permission was required', async (t) => {
    const kernel = await boot(t);
    const routed = await route(kernel, brud(call('shop', 'checkout')), []);
    const text = JSON.stringify(routed);

    for (const secret of ['shop:buy', 'shop:read', 'capabilit', 'callerClasses', 'origins', 'policy']) {
      assert.equal(text.includes(secret), false, `the outcome leaks "${secret}": ${text}`);
    }
  });

  it('keeps permissions out of the public kind listing', async (t) => {
    const kernel = await boot(t);
    const kinds = await router(kernel, async (handle) => handle.kinds()) as readonly { operations?: Record<string, Record<string, unknown>> }[];
    const text = JSON.stringify(kinds);

    assert.deepEqual(Object.keys(kinds[0]?.operations ?? {}).sort(), ['browse', 'checkout', 'host_only', 'runtime_only', 'status']);
    assert.equal(text.includes('permission'), false);
    assert.equal(text.includes('shop:buy'), false);
  });

  it('records both refusals on the observation stream, with the reason only for a denial', async (t) => {
    const kernel = await boot(t);

    await route(kernel, brud(call('shop', 'checkout'), call('shop', 'nope')), []);

    const records = kernel.readObservations().filter((record) => record.source === 'router');
    const denied = records.find((record) => record.event === 'permission-denied');
    const undeclared = records.find((record) => record.event === 'operation-not-declared');

    assert.equal(denied?.detail.kind, 'shop');
    assert.equal(denied?.detail.operation, 'checkout');
    assert.match(String(denied?.detail.reason), /shop:buy/);
    assert.equal(denied?.detail.callerClass, 'host');
    assert.equal(undeclared?.detail.operation, 'nope');
    assert.equal(undeclared?.detail.reason, undefined);
  });

  it('treats object-prototype names as undeclared and never reaches the handler', async (t) => {
    const kernel = await boot(t);
    const names = ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf', 'prototype'];
    const routed = await route(kernel, brud(...names.map((name) => call('shop', name))), ['shop:read', 'shop:buy']);

    assert.deepEqual(routed.operations.map((operation) => operation.status), names.map(() => 'operation_not_declared'));
    assert.deepEqual(calls(), []);
  });

  it('is case-exact: a differently cased name is a different, undeclared operation', async (t) => {
    const kernel = await boot(t);
    const routed = await route(kernel, brud(call('shop', 'BROWSE'), call('shop', 'Checkout')), ['shop:read', 'shop:buy']);

    assert.deepEqual(routed.operations.map((operation) => operation.status), ['operation_not_declared', 'operation_not_declared']);
    assert.deepEqual(calls(), []);
  });

  it('cannot be bypassed by a second operation in the same document or by repetition', async (t) => {
    const kernel = await boot(t);
    const routed = await route(kernel, brud(
      call('shop', 'status'),
      call('shop', 'checkout'),
      call('shop', 'checkout'),
      call('shop', 'status'),
    ), []);

    assert.deepEqual(routed.operations.map((operation) => operation.status), ['success', 'permission_denied', 'permission_denied', 'success']);
    assert.deepEqual(calls(), ['status', 'status']);
  });
});

describe('Kind operation registry: load', () => {
  it('refuses 1,000 unpermitted calls in budget, with the handler never reached', async (t) => {
    const kernel = await boot(t);
    const started = performance.now();

    await router(kernel, async (handle) => {
      for (let index = 0; index < 1_000; index += 1) {
        const routed = await handle.route(brud(call('shop', 'checkout')));

        assert.equal(routed.operations[0]?.status, 'permission_denied');
      }
    });

    const elapsed = performance.now() - started;

    assert.ok(elapsed < 5_000, `1,000 refusals took ${elapsed.toFixed(0)} ms`);
    assert.deepEqual(calls(), []);
  });

  it('serves a kind of 500 operations, each looked up directly', async (t) => {
    const operations = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`op_${String(index)}`, {}]));
    const kernel = await boot(t, [{ ...SHOP[0], permission: OPEN, operations }]);
    const first = await route(kernel, brud(call('shop', 'op_0')));
    const last = await route(kernel, brud(call('shop', 'op_499')));
    const missing = await route(kernel, brud(call('shop', 'op_500')));

    assert.equal(first.operations[0]?.status, 'success');
    assert.equal(last.operations[0]?.status, 'success');
    assert.equal(missing.operations[0]?.status, 'operation_not_declared');
    assert.deepEqual(calls(), ['op_0', 'op_499']);
  });
});

describe('Kind operation registry: open vocabulary', () => {
  const OPEN_KIND = [{
    kind: 'shop',
    exposure: 'acme.shop.dispatch',
    operations: 'open',
    permission: { policyVersion: 2, capabilities: ['shop:read'] },
  }];

  const declare = (kind: Record<string, unknown>): void => {
    admitParticipantManifest('acme.shop', {
      exposures: [{ name: 'acme.shop.dispatch', version: 1 }],
      kinds: [{ kind: 'shop', exposure: 'acme.shop.dispatch', ...kind }],
    });
  };

  it('admits "open" only with a kind-level permission, and refuses any other string', () => {
    declare({ operations: 'open', permission: OPEN });
    assert.throws(() => declare({ operations: 'open' }), (error: unknown) => error instanceof ParticipantManifestError && /permission is required when operations is "open"/.test(error.message));
    assert.throws(() => declare({ operations: 'any', permission: OPEN }), (error: unknown) => error instanceof ParticipantManifestError && /operations is required/.test(error.message));
    assert.throws(() => declare({ operations: true, permission: OPEN }), (error: unknown) => error instanceof ParticipantManifestError);
  });

  it('refuses boot when the open kind permission is not a valid policy', async (t) => {
    const composition = await writeComposition(t, [{
      token: 'acme.shop',
      source: ownerSource([{ ...OPEN_KIND[0], permission: { policyVersion: 2, parentCallerClasses: ['participant'] } }]),
    }]);

    await assert.rejects(
      bootKernel(composition.configPath, { options: composition.options }),
      (error: unknown) => error instanceof RouterInvalidDeclarationError && error.kind === 'shop',
    );
  });

  it('lets the owner decide the names, but only for a caller the kind permission admits', async (t) => {
    const kernel = await boot(t, OPEN_KIND);
    const allowed = await route(kernel, brud(call('shop', 'anything_at_all'), call('shop', 'another')), ['shop:read']);

    assert.deepEqual(allowed.operations.map((operation) => operation.status), ['success', 'success']);
    assert.deepEqual(calls(), ['anything_at_all', 'another']);
  });

  it('refuses a caller without the kind permission for every name, before the handler', async (t) => {
    const kernel = await boot(t, OPEN_KIND);
    const routed = await route(kernel, brud(call('shop', 'a'), call('shop', 'b')), []);

    assert.deepEqual(routed.operations.map((operation) => operation.status), ['permission_denied', 'permission_denied']);
    assert.deepEqual(calls(), []);
    assert.equal(JSON.stringify(routed).includes('shop:read'), false);
  });

  it('lists an open kind as open, with no operation names and no permission', async (t) => {
    const kernel = await boot(t, OPEN_KIND);
    const kinds = await router(kernel, async (handle) => handle.kinds()) as readonly Record<string, unknown>[];

    assert.equal(kinds[0]?.open, true);
    assert.equal(kinds[0]?.operations, undefined);
    assert.equal(JSON.stringify(kinds).includes('shop:read'), false);
  });
});
