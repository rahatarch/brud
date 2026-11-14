import { readFileSync, writeFileSync } from 'node:fs';
import { appendFile, mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootKernel,
  loadIdentityRegistryStorage,
  provisionIdentityRegistryStorage,
  type BrudKernel,
} from '../../../index.js';
import {
  ExposedApiScopeNarrowingError,
  ExposedApiScopeRecordCorruptError,
} from '../contracts/errors.js';
import type { IExposedApiRegistry } from '../contracts/IExposedApiRegistry.js';
import {
  EXPOSED_API_ORIGINS,
  EXPOSED_API_SCOPES,
  exposedApiScopeAllowsOrigin,
  type ExposedApiScope,
  type ExposedApiVersion,
} from '../contracts/types.js';
import { ExposedApiRegistryToken } from '../descriptor/tokens.js';

/**
 * Production-mirror model of the resolution primitive.
 *
 * Every case boots the real kernel from a real config, with the two real
 * hardcore services and real participant modules whose manifests declare their
 * exposures as data. Calls run in real kernel call chains: runtime chains the
 * kernel starts for participants, and host chains started through the
 * kernel's host entry point.
 */

/** One fixture participant. */
interface Participant {
  readonly token: string;
  readonly official?: boolean;
  readonly capabilities?: readonly string[];
  readonly exposures?: readonly Readonly<Record<string, unknown>>[];
  /** JavaScript object literal mapping `name@major` to a binding. */
  readonly bindings?: string;
  /** JavaScript run in `onRunning` with `registry` and `report` in scope. */
  readonly onRunning?: string;
}

interface Workspace {
  readonly root: string;
  readonly operatorRoot: string;
  readonly identityRegistryPath: string;
  readonly scopeRecordPath: string;
  readonly options: Readonly<Record<string, unknown>>;
}

let workspace: Workspace;
const bootedKernels: BrudKernel[] = [];

/** Every binding key returns a projection exposing `ping()` → `name@major`. */
const PING_BINDINGS = 'new Proxy({}, { get: (_, key) => ({ projection: () => ({ ping: () => String(key) }) }) })';

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'brud-exposed-api-model-'));
  const operatorRoot = join(root, 'operator');
  await mkdir(operatorRoot, { recursive: true });

  const identityRegistryPath = join(operatorRoot, 'identity-registry.json');
  const scopeRecordPath = join(operatorRoot, 'scope-record.json');
  provisionIdentityRegistryStorage(identityRegistryPath);

  workspace = {
    root,
    operatorRoot,
    identityRegistryPath,
    scopeRecordPath,
    options: {
      'identity.registry.path': identityRegistryPath,
      'exposedApi.scopeRecord.path': scopeRecordPath,
      'router.root': root,
    },
  };

  delete (globalThis as { __scopeModel?: unknown }).__scopeModel;
});

afterEach(async () => {
  for (const kernel of bootedKernels.splice(0)) {
    await shutdown(kernel);
  }

  await rm(workspace.root, { recursive: true, force: true });
});

function participantModule(participant: Participant): string {
  const manifest = {
    requests: { capabilities: [...(participant.capabilities ?? [])] },
    exposures: [...(participant.exposures ?? [])],
  };

  return `const token = { id: ${JSON.stringify(participant.token)}, description: 'scope model participant', _brand: undefined };
const REGISTRY = { id: ${JSON.stringify(ExposedApiRegistryToken.id)}, description: 'resolution primitive', _brand: undefined };
const report = (globalThis.__scopeModel ??= {})[token.id] ??= {};
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
        value: (name, major) => bindings[name + '@' + String(major)],
        enumerable: false,
      });
      return instance;
    },
  };
}
`;
}

/** Distinguishes module files across compositions; ESM caches by URL. */
let compositionCount = 0;

/**
 * Writes the composition and returns its config path.
 *
 * Every composition writes fresh module files, because the module loader
 * caches by URL, and a fresh config file, because the kernel refuses a config
 * path whose contents changed since it was first read: a config change between
 * boots is a new trust decision. A participant's content binding is the digest
 * of its module's bytes, so a participant whose source is unchanged keeps the
 * same identity across reboots of one workspace.
 */
async function compose(
  participants: readonly Participant[],
  extra: Readonly<Record<string, unknown>> = {},
): Promise<string> {
  const services: { path: string; official?: boolean }[] = [
    { path: 'kernel:serviceModules/identityRegistry.js', official: true },
    { path: 'kernel:serviceModules/exposedApiRegistry.js', official: true },
    { path: 'kernel:serviceModules/parser.js', official: true },
    { path: 'kernel:serviceModules/router.js', official: true },
  ];

  compositionCount += 1;

  for (const participant of participants) {
    const modulePath = join(workspace.root, `${participant.token}.${String(compositionCount)}.mjs`);

    await writeFile(modulePath, participantModule(participant), 'utf8');
    services.push(participant.official === undefined
      ? { path: modulePath }
      : { path: modulePath, official: participant.official });
  }

  const configPath = join(workspace.operatorRoot, `brud.config.${String(compositionCount)}.json`);

  await writeFile(configPath, JSON.stringify({ services, ...extra }, null, 2), 'utf8');

  return configPath;
}

async function boot(
  participants: readonly Participant[],
  extra: Readonly<Record<string, unknown>> = {},
): Promise<BrudKernel> {
  const configPath = await compose(participants, extra);
  const kernel = await bootKernel(configPath, { options: workspace.options });
  bootedKernels.push(kernel);

  return kernel;
}

async function bootRefused(
  participants: readonly Participant[],
  check: (error: unknown) => boolean,
  extra: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  const configPath = await compose(participants, extra);

  await assert.rejects(bootKernel(configPath, { options: workspace.options }), check);
}

async function shutdown(kernel: BrudKernel): Promise<void> {
  if (kernel.lifecycleState === 'RUNNING') {
    await kernel.shutdown();
  }

  const index = bootedKernels.indexOf(kernel);

  if (index >= 0) {
    bootedKernels.splice(index, 1);
  }
}

function hostRegistry(kernel: BrudKernel): IExposedApiRegistry {
  return kernel.requestAccess<IExposedApiRegistry>(
    { callerId: 'host', tier: 'core', options: {} },
    ExposedApiRegistryToken,
  );
}

/** Resolves in a host-origin chain and pings the handle in the same chain. */
function hostPing(
  kernel: BrudKernel,
  name: string,
  options?: { readonly version?: ExposedApiVersion; readonly expectedOwner?: string },
  capabilities: readonly string[] = [],
): string | null {
  return kernel.runHostCall({ capabilities }, () => {
    const handle = hostRegistry(kernel).resolve<{ readonly ping: () => string }>(name, options);

    return handle === null ? null : handle.ping();
  });
}

function reports(): Record<string, Record<string, unknown>> {
  return (globalThis as { __scopeModel?: Record<string, Record<string, unknown>> }).__scopeModel ?? {};
}

function recordFor(name: string, version: ExposedApiVersion = 1): {
  readonly name: string;
  readonly version: ExposedApiVersion;
  readonly scope: ExposedApiScope;
} | undefined {
  const document = JSON.parse(readFileSync(workspace.scopeRecordPath, 'utf8')) as {
    readonly records: readonly { readonly name: string; readonly version: ExposedApiVersion; readonly scope: ExposedApiScope }[];
  };

  return document.records.find((record) => record.name === name && record.version === version);
}

function identityOf(token: string): string {
  const record = loadIdentityRegistryStorage(workspace.identityRegistryPath)
    .records.find((entry) => entry.publisher === token);

  assert.ok(record !== undefined, `identity recorded for ${token}`);

  return record.token;
}

const RUNTIME_PROBE = (names: readonly string[]): string => `
  for (const name of ${JSON.stringify(names)}) {
    const handle = registry.resolve(name);
    report[name] = handle === null ? 'refused' : handle.ping();
  }`;

describe('universal exposed API scope model', () => {
  it('applies the four-case origin-and-scope rule exactly', () => {
    const matrix = Object.fromEntries(EXPOSED_API_SCOPES.map((scope) => [
      scope,
      EXPOSED_API_ORIGINS.filter((origin) => exposedApiScopeAllowsOrigin(scope, origin)),
    ]));

    assert.deepEqual(matrix, {
      kernel: ['kernel'],
      runtime: ['kernel', 'runtime'],
      host: ['host'],
      any: ['kernel', 'runtime', 'host'],
    });
  });

  it('enforces each scope against real runtime-origin and host-origin chains', async () => {
    const names = ['model.kernel', 'model.runtime', 'model.host', 'model.any'];
    const kernel = await boot([
      {
        token: 'model.giver',
        exposures: [
          { name: 'model.kernel', scope: 'kernel' },
          { name: 'model.runtime', scope: 'runtime' },
          { name: 'model.host', scope: 'host' },
          { name: 'model.any', scope: 'any' },
        ],
        bindings: PING_BINDINGS,
      },
      { token: 'model.caller', onRunning: RUNTIME_PROBE(names) },
    ]);

    assert.deepEqual(reports()['model.caller'], {
      'model.kernel': 'refused',
      'model.runtime': 'model.runtime@1',
      'model.host': 'refused',
      'model.any': 'model.any@1',
    });
    assert.deepEqual(
      names.map((name) => hostPing(kernel, name)),
      [null, null, 'model.host@1', 'model.any@1'],
    );
  });

  it('defaults an omitted version, scope, and policy to 1, kernel, and the empty policy', async () => {
    const kernel = await boot([
      { token: 'model.defaults', exposures: [{ name: 'model.defaults' }], bindings: PING_BINDINGS },
      { token: 'model.caller', onRunning: RUNTIME_PROBE(['model.defaults']) },
    ]);

    assert.deepEqual(recordFor('model.defaults'), { name: 'model.defaults', version: 1, scope: 'kernel' });
    assert.equal(reports()['model.caller']?.['model.defaults'], 'refused');
    assert.equal(hostPing(kernel, 'model.defaults'), null);
  });

  it('persists the scope record across shutdown and reboot', async () => {
    const participants: Participant[] = [{
      token: 'model.persist',
      exposures: [{ name: 'model.persist', scope: 'host' }],
      bindings: PING_BINDINGS,
    }];
    const first = await boot(participants);

    assert.deepEqual(recordFor('model.persist'), { name: 'model.persist', version: 1, scope: 'host' });
    await shutdown(first);

    const second = await boot(participants);

    assert.equal(hostPing(second, 'model.persist'), 'model.persist@1');
    assert.deepEqual(recordFor('model.persist'), { name: 'model.persist', version: 1, scope: 'host' });
  });

  it('refuses narrowing within one major version on reboot and names both scopes', async () => {
    await shutdown(await boot([{ token: 'model.narrow', exposures: [{ name: 'model.narrow', scope: 'runtime' }] }]));

    await bootRefused(
      [{ token: 'model.narrow', exposures: [{ name: 'model.narrow', scope: 'kernel' }] }],
      (error: unknown) => {
        assert.ok(error instanceof ExposedApiScopeNarrowingError);
        assert.equal(error.code, 'EXPOSED_API_SCOPE_NARROWED');
        assert.equal(error.apiName, 'model.narrow');
        assert.equal(error.version, '1');
        assert.equal(error.persistedScope, 'runtime');
        assert.equal(error.requestedScope, 'kernel');
        return true;
      },
    );

    assert.deepEqual(recordFor('model.narrow'), { name: 'model.narrow', version: 1, scope: 'runtime' });
  });

  it('allows widening within one major version and records it', async () => {
    await shutdown(await boot([{ token: 'model.widen', exposures: [{ name: 'model.widen', scope: 'kernel' }] }]));

    const second = await boot([{
      token: 'model.widen',
      exposures: [{ name: 'model.widen', scope: 'any' }],
      bindings: PING_BINDINGS,
    }]);

    assert.deepEqual(recordFor('model.widen'), { name: 'model.widen', version: 1, scope: 'any' });
    assert.equal(hostPing(second, 'model.widen'), 'model.widen@1');
  });

  it('keeps a new major version separate, with its own scope, under the same owner', async () => {
    const kernel = await boot([{
      token: 'model.majors',
      exposures: [
        { name: 'model.majors', version: 1, scope: 'host' },
        { name: 'model.majors', version: '2.1.0', scope: 'kernel' },
      ],
      bindings: PING_BINDINGS,
    }]);

    assert.equal(hostPing(kernel, 'model.majors', { version: 1 }), 'model.majors@1');
    assert.equal(hostPing(kernel, 'model.majors', { version: 2 }), null);
    assert.equal(hostPing(kernel, 'model.majors', { version: '2.0.0' }), null);
    assert.deepEqual(recordFor('model.majors', 1), { name: 'model.majors', version: 1, scope: 'host' });
    assert.deepEqual(recordFor('model.majors', 2), { name: 'model.majors', version: 2, scope: 'kernel' });
  });

  it('evaluates every Layer 1 input mechanically: class, origin, capabilities, and official status', async () => {
    const kernel = await boot([
      {
        token: 'model.layer1',
        exposures: [
          { name: 'model.hostClass', scope: 'any', policy: { policyVersion: 1, callerClasses: ['host'] } },
          { name: 'model.runtimeOrigin', scope: 'any', policy: { policyVersion: 1, origins: ['runtime'] } },
          { name: 'model.capable', scope: 'any', policy: { policyVersion: 1, capabilities: ['model:read'] } },
          { name: 'model.official', scope: 'any', policy: { policyVersion: 1, official: true } },
        ],
        bindings: PING_BINDINGS,
      },
      {
        token: 'model.plain',
        onRunning: RUNTIME_PROBE(['model.hostClass', 'model.runtimeOrigin', 'model.capable', 'model.official']),
      },
      {
        token: 'model.entitled',
        official: true,
        capabilities: ['model:read'],
        onRunning: RUNTIME_PROBE(['model.capable', 'model.official']),
      },
    ]);

    assert.deepEqual(reports()['model.plain'], {
      'model.hostClass': 'refused',
      'model.runtimeOrigin': 'model.runtimeOrigin@1',
      'model.capable': 'refused',
      'model.official': 'refused',
    });
    assert.deepEqual(reports()['model.entitled'], {
      'model.capable': 'model.capable@1',
      'model.official': 'model.official@1',
    });
    assert.equal(hostPing(kernel, 'model.hostClass'), 'model.hostClass@1');
    assert.equal(hostPing(kernel, 'model.runtimeOrigin'), null);
    assert.equal(hostPing(kernel, 'model.capable'), null);
    assert.equal(hostPing(kernel, 'model.capable', undefined, ['model:read']), 'model.capable@1');
  });

  it('resolves by expected owner identity and fails when the owner differs', async () => {
    const kernel = await boot([{
      token: 'model.owned',
      exposures: [{ name: 'model.owned', scope: 'host' }],
      bindings: PING_BINDINGS,
    }]);
    const owner = identityOf('model.owned');

    assert.equal(hostPing(kernel, 'model.owned', { expectedOwner: owner }), 'model.owned@1');
    assert.equal(hostPing(kernel, 'model.owned', { expectedOwner: `${owner}-other` }), null);
  });

  it('honours the composition\'s owner pin and refuses a registration that contradicts it', async () => {
    const participants: Participant[] = [
      { token: 'model.pinOwner', exposures: [{ name: 'model.pinned', scope: 'host' }], bindings: PING_BINDINGS },
      { token: 'model.other' },
    ];

    await shutdown(await boot(participants));

    const owner = identityOf('model.pinOwner');
    const other = identityOf('model.other');
    const pinned = await boot(participants, { exposureOwners: { 'model.pinned': owner } });

    assert.equal(hostPing(pinned, 'model.pinned'), 'model.pinned@1');
    await shutdown(pinned);

    await bootRefused(
      participants,
      (error: unknown) => (error as { readonly code?: unknown }).code === 'EXPOSED_API_OWNER_PIN',
      { exposureOwners: { 'model.pinned': other } },
    );
  });

  it('fails the call and records the mismatch when owner code does not provide a declared exposure', async () => {
    const kernel = await boot([{
      token: 'model.unbound',
      exposures: [{ name: 'model.unbound', scope: 'host' }],
    }]);

    assert.equal(hostPing(kernel, 'model.unbound'), null);
    assert.ok(kernel.readObservations().some((record) =>
      record.event === 'exposure-binding-mismatch' && record.detail['name'] === 'model.unbound'));
  });

  it('gives participants no way to register: the view is resolve only and the window is sealed', async () => {
    await boot([{
      token: 'model.late',
      onRunning: `
        report.keys = Object.keys(registry);
        try { registry.register('x', { name: 'model.late' }); report.register = 'accepted'; }
        catch (error) { report.register = error instanceof TypeError ? 'absent' : String(error); }`,
    }]);

    assert.deepEqual(reports()['model.late'], { keys: ['resolve'], register: 'absent' });
  });

  it('applies the per-identity call and size limits to resolve', async () => {
    const kernel = await boot([
      { token: 'model.limited', exposures: [{ name: 'model.limited', scope: 'runtime' }], bindings: PING_BINDINGS },
      {
        token: 'model.flood',
        onRunning: `
          let granted = 0;
          for (let index = 0; index < 10_001; index += 1) {
            if (registry.resolve('model.limited') !== null) { granted += 1; }
          }
          report.granted = granted;
          report.oversized = registry.resolve('x'.repeat(70_000));`,
      },
    ]);
    const flood = reports()['model.flood'] as { readonly granted: number; readonly oversized: unknown };

    assert.ok(flood.granted >= 1 && flood.granted <= 10_000, `granted ${String(flood.granted)} calls`);
    assert.equal(flood.oversized, null);
    assert.ok(kernel.readObservations().some((record) =>
      record.event === 'resolve-refused' && record.detail['reason'] === 'call or size limit exceeded'));
  });

  it('write-protects the scope record while the kernel runs', async () => {
    await boot([{ token: 'model.protected', exposures: [{ name: 'model.protected', scope: 'kernel' }] }]);

    const before = readFileSync(workspace.scopeRecordPath, 'utf8');

    assert.throws(() => writeFileSync(workspace.scopeRecordPath, 'tampered'));
    assert.throws(() => writeFileSync(workspace.scopeRecordPath, `${before}\n`));
    await assert.rejects(appendFile(workspace.scopeRecordPath, 'tampered'));
    await assert.rejects(unlink(workspace.scopeRecordPath));
    assert.equal(readFileSync(workspace.scopeRecordPath, 'utf8'), before);
  });

  it('refuses boot when the persisted scope record is corrupt', async () => {
    const participants: Participant[] = [{ token: 'model.corrupt', exposures: [{ name: 'model.corrupt', scope: 'runtime' }] }];

    await shutdown(await boot(participants));
    await writeFile(workspace.scopeRecordPath, '{not-json', 'utf8');

    await bootRefused(participants, (error: unknown) => {
      assert.ok(error instanceof ExposedApiScopeRecordCorruptError);
      assert.equal(error.code, 'EXPOSED_API_SCOPE_RECORD_CORRUPT');
      return true;
    });
  });

  it('refuses boot when a valid-looking scope record fails its integrity digest', async () => {
    const participants: Participant[] = [{ token: 'model.digest', exposures: [{ name: 'model.digest', scope: 'runtime' }] }];

    await shutdown(await boot(participants));

    const document = JSON.parse(readFileSync(workspace.scopeRecordPath, 'utf8')) as {
      records: { name: string; version: ExposedApiVersion; scope: ExposedApiScope }[];
    };
    const record = document.records.find((entry) => entry.name === 'model.digest');
    assert.ok(record);
    record.scope = 'kernel';
    await writeFile(workspace.scopeRecordPath, JSON.stringify(document), 'utf8');

    await bootRefused(participants, (error: unknown) => {
      assert.ok(error instanceof ExposedApiScopeRecordCorruptError);
      assert.match(error.reason, /integrity digest mismatch/u);
      return true;
    });
  });

  it('fails closed on an invalid version, scope, or policy declaration', async () => {
    const cases: readonly { readonly exposure: Readonly<Record<string, unknown>>; readonly code: string }[] = [
      { exposure: { name: 'model.bad', version: 0 }, code: 'EXPOSED_API_INVALID_VERSION' },
      { exposure: { name: 'model.bad', scope: 'everywhere' }, code: 'EXPOSED_API_INVALID_SCOPE' },
      { exposure: { name: 'model.bad', policy: { policyVersion: 2 } }, code: 'EXPOSED_API_INVALID_POLICY' },
      { exposure: { name: 'model.bad', policy: { policyVersion: 1, allowedCallers: ['x'] } }, code: 'EXPOSED_API_INVALID_POLICY' },
      { exposure: { name: 'model.bad', policy: { policyVersion: 1, origins: ['moon'] } }, code: 'EXPOSED_API_INVALID_POLICY' },
      { exposure: { name: 'model.bad', policy: { policyVersion: 1, capabilities: ['Not A Token'] } }, code: 'EXPOSED_API_INVALID_POLICY' },
      { exposure: { name: 'not a name' }, code: 'EXPOSED_API_INVALID_NAME' },
    ];

    for (const { exposure, code } of cases) {
      await bootRefused(
        [{ token: 'model.invalid', exposures: [exposure] }],
        (error: unknown) => (error as { readonly code?: unknown }).code === code,
      );
    }
  });
});
