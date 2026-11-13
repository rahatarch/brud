import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootKernel,
  createDeferredKernel,
  HardcoreServiceError,
  type BrudConfig,
  type BrudConfigEntry,
} from '../bootstrap/index.js';
import type { BrudKernel } from '../engine/BrudKernel.js';
import type { ServiceContext } from '../contracts/lifecycle.js';
import {
  IdentityRegistryToken,
  loadIdentityRegistryStorage,
  provisionIdentityRegistryStorage,
  type IIdentityRegistry,
} from '../../services/IdentityRegistry/index.js';
import { workspaceContextOptions } from './support/workspaceContext.js';

const KERNEL_CONFIG_PATH = fileURLToPath(
  new URL('../../brud.config.json', import.meta.url),
);

const DAEMON_CONFIG_PATH = fileURLToPath(
  new URL('../../../daemon/brud.config.json', import.meta.url),
);

const REGISTRY_MODULE_PATH = 'kernel:serviceModules/identityRegistry.js';

const EXPOSED_API_MODULE_PATH = 'kernel:serviceModules/exposedApiRegistry.js';

const IDENTITY_TOKEN = 'brud.core.identityRegistry';

const EXPOSED_API_TOKEN = 'brud.core.exposedApiRegistry';

const IDENTITY_METHODS = ['issue', 'resolve', 'retire', 'revoke'] as const;

const EXPOSED_API_METHODS = [
  'registerApi',
  'resolve',
  'resolveWithMetadata',
  'scopeOf',
  'closeRegistration',
  'isRegistrationOpen',
  'registeredApiNames',
  'registeredApiIdentities',
] as const;

let baseServicesCache: Promise<readonly BrudConfigEntry[]> | undefined;

function baseServices(): Promise<readonly BrudConfigEntry[]> {
  baseServicesCache ??= readFile(KERNEL_CONFIG_PATH, 'utf8').then(
    (raw) => (JSON.parse(raw) as BrudConfig).services,
  );

  return baseServicesCache;
}

let daemonServicesCache: Promise<readonly BrudConfigEntry[]> | undefined;

function daemonServices(): Promise<readonly BrudConfigEntry[]> {
  daemonServicesCache ??= readFile(DAEMON_CONFIG_PATH, 'utf8').then(
    (raw) => (JSON.parse(raw) as BrudConfig).services,
  );

  return daemonServicesCache;
}

interface HardcoreWorkspace {
  readonly root: string;
  readonly workspaceRoot: string;
  readonly registryPath: string;
  readonly configPath: string;
}

async function createWorkspace(context: TestContext): Promise<HardcoreWorkspace> {
  const root = await mkdtemp(join(tmpdir(), 'brud-hardcore-'));
  const workspaceRoot = join(root, 'workspace');
  const operatorRoot = join(root, 'operator-state');

  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(operatorRoot, { recursive: true });

  const registryPath = join(operatorRoot, 'registry.json');
  provisionIdentityRegistryStorage(registryPath);

  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  return {
    root,
    workspaceRoot,
    registryPath,
    configPath: join(root, 'brud.config.json'),
  };
}

function optionsFor(
  workspace: HardcoreWorkspace,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...workspaceContextOptions(workspace.workspaceRoot),
    'identity.registry.path': workspace.registryPath,
    history: { inMemory: true },
    ...extra,
  };
}

async function writeConfig(
  workspace: HardcoreWorkspace,
  services: readonly BrudConfigEntry[],
  plugins: readonly BrudConfigEntry[] = [],
): Promise<void> {
  const config: BrudConfig = { services, plugins };

  await writeFile(workspace.configPath, JSON.stringify(config, null, 2), 'utf8');
}

async function boot(
  context: TestContext,
  workspace: HardcoreWorkspace,
): Promise<BrudKernel> {
  const kernel = await bootKernel(workspace.configPath, {
    options: optionsFor(workspace),
  });

  context.after(async () => {
    if (kernel.lifecycleState === 'RUNNING') {
      await kernel.shutdown().catch(() => undefined);
    }
  });

  return kernel;
}

function caller(workspace: HardcoreWorkspace): ServiceContext {
  return {
    callerId: 'hardcore.test',
    tier: 'core',
    options: optionsFor(workspace),
  };
}

function substitutesIdentityRegistry(
  services: readonly BrudConfigEntry[],
  substitutePath: string,
): readonly BrudConfigEntry[] {
  return substitutesModule(services, REGISTRY_MODULE_PATH, substitutePath);
}

function substitutesModule(
  services: readonly BrudConfigEntry[],
  modulePath: string,
  substitutePath: string,
): readonly BrudConfigEntry[] {
  return services.map((service) =>
    service.path === modulePath
      ? { path: substitutePath, official: true }
      : service);
}

async function writeSubstituteModule(
  root: string,
  name: string,
  contractVersion: string,
  methods: readonly string[],
  tokenId: string = IDENTITY_TOKEN,
): Promise<string> {
  const modulePath = join(root, `${name}.mjs`);
  const instanceMethods = [...new Set([...IDENTITY_METHODS, ...EXPOSED_API_METHODS])]
    .map((method) => `      ${method}() { throw new Error('substitute ${method}'); },`)
    .join('\n');

  await writeFile(modulePath, `export function createService() {
  return {
    token: {
      id: ${JSON.stringify(tokenId)},
      description: 'substituted hardcore service',
      _brand: [],
    },
    tier: 'core',
    dependencies: [],
    contract: {
      version: ${JSON.stringify(contractVersion)},
      methods: ${JSON.stringify(methods)},
    },
    factory: () => ({
${instanceMethods}
    }),
  };
}
`, 'utf8');

  return modulePath;
}

async function writeInitializeMarkerModule(
  root: string,
): Promise<{
  readonly modulePath: string;
  readonly constructedMarkerPath: string;
  readonly initializedMarkerPath: string;
}> {
  const constructedMarkerPath = join(root, 'constructed.marker');
  const initializedMarkerPath = join(root, 'initialized.marker');
  const modulePath = join(root, 'initialize-marker.mjs');

  await writeFile(modulePath, `import { writeFileSync } from 'node:fs';

export function createService() {
  return {
    token: {
      id: 'test.hardcore.initializeMarker',
      description: 'Writes markers when constructed and initialized',
      _brand: [],
    },
    tier: 'userland',
    dependencies: [],
    factory: () => {
      writeFileSync(${JSON.stringify(constructedMarkerPath)}, 'constructed', 'utf8');

      return {
        initialize() {
          writeFileSync(${JSON.stringify(initializedMarkerPath)}, 'initialized', 'utf8');
        },
      };
    },
  };
}
`, 'utf8');

  return { modulePath, constructedMarkerPath, initializedMarkerPath };
}

interface OrderObserverModule {
  readonly modulePath: string;
  readonly logPath: string;
}

/**
 * Writes a composed fixture service that observes real hardcore boot state.
 *
 * At `initialize` and `dispose` it attempts a guarded `utimesSync` against the
 * real identity registry file. The registry claims that path in `initialize`
 * and releases it in `dispose`, so a refused mutation means the hardcore
 * service is initialized and still alive. Its `registerBootRegistrants` hook
 * records what the real boot pinner sees.
 */
async function writeOrderObserverModule(
  root: string,
  registryPath: string,
): Promise<OrderObserverModule> {
  const logPath = join(root, 'order.log');
  const modulePath = join(root, 'order-observer.mjs');

  await writeFile(modulePath, `import { appendFileSync, utimesSync } from 'node:fs';

const REGISTRY_PATH = ${JSON.stringify(registryPath)};
const LOG_PATH = ${JSON.stringify(logPath)};
const PROBE_TIME = 0;

function record(line) {
  appendFileSync(LOG_PATH, line + '\\n', 'utf8');
}

function hardcoreState() {
  try {
    utimesSync(REGISTRY_PATH, PROBE_TIME, PROBE_TIME);
    return 'unprotected';
  } catch (error) {
    return error !== null
      && typeof error === 'object'
      && error.code === 'CONFIG_INTEGRITY'
      ? 'protected'
      : 'probe-error';
  }
}

export function createService() {
  return {
    token: {
      id: 'test.hardcore.orderObserver',
      description: 'Records hardcore-first boot observations',
      _brand: [],
    },
    tier: 'userland',
    dependencies: [],
    factory: () => ({
      initialize() {
        record('init:' + hardcoreState());
      },
      dispose() {
        record('dispose:' + hardcoreState());
      },
    }),
  };
}

export function registerBootRegistrants(_context, instances) {
  const identityIndex = instances.findIndex((instance) =>
    instance !== null
    && typeof instance === 'object'
    && typeof instance.issue === 'function'
    && typeof instance.resolve === 'function'
    && typeof instance.retire === 'function'
    && typeof instance.revoke === 'function');
  const exposedApiIndex = instances.findIndex((instance) =>
    instance !== null
    && typeof instance === 'object'
    && typeof instance.registerApi === 'function'
    && typeof instance.resolveWithMetadata === 'function'
    && typeof instance.scopeOf === 'function'
    && typeof instance.closeRegistration === 'function');

  record('pin:count:' + instances.length);
  record('pin:identityIndex:' + identityIndex);
  record('pin:exposedApiIndex:' + exposedApiIndex);
}
`, 'utf8');

  return { modulePath, logPath };
}

async function writeFailingModule(root: string): Promise<string> {
  const modulePath = join(root, 'failing-composed.mjs');

  await writeFile(modulePath, `export function createService() {
  return {
    token: {
      id: 'test.hardcore.failingComposed',
      description: 'Fails during initialization',
      _brand: [],
    },
    tier: 'userland',
    dependencies: [],
    factory: () => ({
      initialize() {
        throw new Error('composed service failed during initialize');
      },
    }),
  };
}
`, 'utf8');

  return modulePath;
}

async function writeActivationMarkerPlugin(
  root: string,
): Promise<{ readonly modulePath: string; readonly markerPath: string }> {
  const markerPath = join(root, 'activated.marker');
  const modulePath = join(root, 'activation-marker.mjs');

  await writeFile(modulePath, `import { writeFileSync } from 'node:fs';

export const plugin = {
  manifest: {
    id: 'test.hardcore.activationMarker',
    name: 'Activation marker',
    version: '1.0.0',
    permissions: [],
  },
  activate() {
    writeFileSync(${JSON.stringify(markerPath)}, 'activated', 'utf8');
  },
};
`, 'utf8');

  return { modulePath, markerPath };
}

describe('hardcore service enforcement production mirror', () => {
  it('boots with the real identity registry and calls it for every composed service', async (t) => {
    const workspace = await createWorkspace(t);
    const services = [...await baseServices()];

    await writeConfig(workspace, services);

    const kernel = await boot(t, workspace);

    assert.equal(kernel.lifecycleState, 'RUNNING');

    const loaded = loadIdentityRegistryStorage(workspace.registryPath);
    const byPath = new Map(
      loaded.records.map((record) => [record.metadata['path'], record]),
    );

    assert.equal(loaded.records.length, services.length);

    for (const service of services) {
      const record = byPath.get(service.path);

      assert.ok(record !== undefined, `no identity was issued for ${service.path}`);
      assert.equal(record.metadata['source'], 'kernel.composition');
      assert.equal(record.metadata['official'], service.official === true);
      assert.equal(record.metadata['provisional'], true);
    }

    const registry = kernel.requestAccess<IIdentityRegistry>(
      caller(workspace),
      IdentityRegistryToken,
    );
    const first = loaded.records[0];

    assert.ok(first !== undefined);
    assert.equal(registry.resolve(first.token)?.publisher, first.publisher);
  });

  it('refuses boot when the identity registry is absent', async (t) => {
    const workspace = await createWorkspace(t);
    const services = (await baseServices()).filter(
      (service) => service.path !== REGISTRY_MODULE_PATH,
    );

    assert.ok(services.some((service) => service.path === EXPOSED_API_MODULE_PATH));

    await writeConfig(workspace, services);

    await assert.rejects(
      bootKernel(workspace.configPath, { options: optionsFor(workspace) }),
      (error: unknown) => {
        assert.ok(error instanceof HardcoreServiceError);
        assert.equal(error.code, 'HARDCORE_VERIFICATION');
        assert.equal(error.service, 'brud.core.identityRegistry');
        assert.equal(error.check, 'presence');
        assert.match(error.message, /brud\.core\.identityRegistry/u);
        assert.match(error.message, /presence check/u);
        assert.match(error.message, /no matching config entry/u, error.message);
        return true;
      },
    );
  });

  it('refuses a substituted package under the same token by content hash', async (t) => {
    const workspace = await createWorkspace(t);
    const substitutePath = await writeSubstituteModule(
      workspace.root,
      'substitute-registry',
      '1.0.0',
      ['issue', 'resolve', 'retire', 'revoke'],
    );

    await writeConfig(
      workspace,
      substitutesIdentityRegistry(await baseServices(), substitutePath),
    );

    await assert.rejects(
      bootKernel(workspace.configPath, { options: optionsFor(workspace) }),
      (error: unknown) => {
        assert.ok(error instanceof HardcoreServiceError);
        assert.equal(error.service, 'brud.core.identityRegistry');
        assert.equal(error.check, 'content-hash');
        assert.match(error.message, /content-hash check/u);
        assert.match(error.message, /substitute-registry\.mjs/u, error.message);
        assert.notEqual(error.expected, error.found);
        return true;
      },
    );
  });

  it('refuses a package that does not satisfy the declared contract', async (t) => {
    const workspace = await createWorkspace(t);
    const substitutePath = await writeSubstituteModule(
      workspace.root,
      'wrong-contract-registry',
      '0.0.0',
      ['issue'],
    );

    await writeConfig(
      workspace,
      substitutesIdentityRegistry(await baseServices(), substitutePath),
    );

    await assert.rejects(
      bootKernel(workspace.configPath, { options: optionsFor(workspace) }),
      (error: unknown) => {
        assert.ok(error instanceof HardcoreServiceError);
        assert.equal(error.service, 'brud.core.identityRegistry');
        assert.equal(error.check, 'contract');
        assert.equal(error.expected, 'contract version "1.0.0"');
        assert.equal(error.found, 'contract version "0.0.0"');
        return true;
      },
    );
  });

  it('refuses before any composed service is initialized', async (t) => {
    const workspace = await createWorkspace(t);
    const marker = await writeInitializeMarkerModule(workspace.root);
    const services = [
      ...(await baseServices()).filter(
        (service) => service.path !== REGISTRY_MODULE_PATH,
      ),
      { path: marker.modulePath },
    ];

    await writeConfig(workspace, services);

    await assert.rejects(
      bootKernel(workspace.configPath, { options: optionsFor(workspace) }),
      (error: unknown) => {
        assert.ok(error instanceof HardcoreServiceError);
        assert.equal(error.check, 'presence');
        return true;
      },
    );

    await assert.rejects(readFile(marker.constructedMarkerPath, 'utf8'));
    await assert.rejects(readFile(marker.initializedMarkerPath, 'utf8'));
  });

  it('refuses before any plugin is activated', async (t) => {
    const workspace = await createWorkspace(t);
    const plugin = await writeActivationMarkerPlugin(workspace.root);
    const services = (await baseServices()).filter(
      (service) => service.path !== REGISTRY_MODULE_PATH,
    );

    await writeConfig(workspace, services, [{ path: plugin.modulePath, official: true }]);

    await assert.rejects(
      bootKernel(workspace.configPath, { options: optionsFor(workspace) }),
      (error: unknown) => {
        assert.ok(error instanceof HardcoreServiceError);
        assert.equal(error.check, 'presence');
        return true;
      },
    );

    await assert.rejects(readFile(plugin.markerPath, 'utf8'));
  });

  it('initializes both hardcore services before every composed service in the full daemon composition', async (t) => {
    const workspace = await createWorkspace(t);
    const observer = await writeOrderObserverModule(workspace.root, workspace.registryPath);
    const composed = await daemonServices();
    const services = [{ path: observer.modulePath }, ...composed];

    await writeConfig(workspace, services);

    const kernel = await boot(t, workspace);

    assert.equal(kernel.lifecycleState, 'RUNNING');
    assert.ok(composed.length > 1, 'the daemon config must compose real services');

    const exposedApiConfigIndex = services.findIndex(
      (service) => service.path === EXPOSED_API_MODULE_PATH,
    );
    const identityConfigIndex = services.findIndex(
      (service) => service.path === REGISTRY_MODULE_PATH,
    );

    assert.ok(exposedApiConfigIndex > 0 && identityConfigIndex > 0);
    assert.ok(
      exposedApiConfigIndex < identityConfigIndex,
      'the daemon config lists the exposed API registry before the identity registry',
    );

    const observed = (await readFile(observer.logPath, 'utf8')).trim().split('\n');

    // The composed observer is listed first in the config, yet both hardcore
    // services occupy the first two initialization positions, in config order
    // inside the hardcore partition.
    assert.deepEqual(observed, [
      'init:protected',
      `pin:count:${String(kernel.listServices().length)}`,
      'pin:identityIndex:1',
      'pin:exposedApiIndex:0',
    ]);
  });

  it('refuses boot when the exposed API registry is absent', async (t) => {
    const workspace = await createWorkspace(t);
    const marker = await writeInitializeMarkerModule(workspace.root);
    const services = [
      ...(await baseServices()).filter(
        (service) => service.path !== EXPOSED_API_MODULE_PATH,
      ),
      { path: marker.modulePath },
    ];

    assert.ok(services.some((service) => service.path === REGISTRY_MODULE_PATH));

    await writeConfig(workspace, services);

    await assert.rejects(
      bootKernel(workspace.configPath, { options: optionsFor(workspace) }),
      (error: unknown) => {
        assert.ok(error instanceof HardcoreServiceError);
        assert.equal(error.code, 'HARDCORE_VERIFICATION');
        assert.equal(error.service, EXPOSED_API_TOKEN);
        assert.equal(error.check, 'presence');
        assert.match(error.message, /brud\.core\.exposedApiRegistry/u);
        assert.match(error.message, /no matching config entry/u, error.message);
        return true;
      },
    );

    await assert.rejects(readFile(marker.constructedMarkerPath, 'utf8'));
    await assert.rejects(readFile(marker.initializedMarkerPath, 'utf8'));
  });

  it('refuses a substituted exposed API registry package by content hash', async (t) => {
    const workspace = await createWorkspace(t);
    const substitutePath = await writeSubstituteModule(
      workspace.root,
      'substitute-exposed-api-registry',
      '1.0.0',
      EXPOSED_API_METHODS,
      EXPOSED_API_TOKEN,
    );

    await writeConfig(
      workspace,
      substitutesModule(await baseServices(), EXPOSED_API_MODULE_PATH, substitutePath),
    );

    await assert.rejects(
      bootKernel(workspace.configPath, { options: optionsFor(workspace) }),
      (error: unknown) => {
        assert.ok(error instanceof HardcoreServiceError);
        assert.equal(error.service, EXPOSED_API_TOKEN);
        assert.equal(error.check, 'content-hash');
        assert.match(error.message, /substitute-exposed-api-registry\.mjs/u, error.message);
        assert.notEqual(error.expected, error.found);
        return true;
      },
    );
  });

  it('refuses an exposed API registry that does not satisfy its declared contract', async (t) => {
    const workspace = await createWorkspace(t);
    const wrongVersion = await writeSubstituteModule(
      workspace.root,
      'wrong-version-exposed-api-registry',
      '0.0.0',
      EXPOSED_API_METHODS,
      EXPOSED_API_TOKEN,
    );

    await writeConfig(
      workspace,
      substitutesModule(await baseServices(), EXPOSED_API_MODULE_PATH, wrongVersion),
    );

    await assert.rejects(
      bootKernel(workspace.configPath, { options: optionsFor(workspace) }),
      (error: unknown) => {
        assert.ok(error instanceof HardcoreServiceError);
        assert.equal(error.service, EXPOSED_API_TOKEN);
        assert.equal(error.check, 'contract');
        assert.equal(error.expected, 'contract version "1.0.0"');
        assert.equal(error.found, 'contract version "0.0.0"');
        return true;
      },
    );

    // The identity registry's interface does not satisfy the exposed API
    // registry's entry: each entry is checked against its own declaration.
    // A fresh workspace keeps this boot's config separate from the first one,
    // which the kernel has already recorded.
    const second = await createWorkspace(t);
    const identityShaped = await writeSubstituteModule(
      second.root,
      'identity-shaped-exposed-api-registry',
      '1.0.0',
      IDENTITY_METHODS,
      EXPOSED_API_TOKEN,
    );

    await writeConfig(
      second,
      substitutesModule(await baseServices(), EXPOSED_API_MODULE_PATH, identityShaped),
    );

    await assert.rejects(
      bootKernel(second.configPath, { options: optionsFor(second) }),
      (error: unknown) => {
        assert.ok(error instanceof HardcoreServiceError);
        assert.equal(error.service, EXPOSED_API_TOKEN);
        assert.equal(error.check, 'contract');
        assert.match(
          error.found,
          /missing registerApi, resolveWithMetadata, scopeOf, closeRegistration, isRegistrationOpen, registeredApiNames, registeredApiIdentities/u,
          error.found,
        );
        return true;
      },
    );
  });

  it('rolls back composed services before the hardcore service when initialization fails', async (t) => {
    const workspace = await createWorkspace(t);
    const observer = await writeOrderObserverModule(workspace.root, workspace.registryPath);
    const failingPath = await writeFailingModule(workspace.root);
    const services = [
      { path: observer.modulePath },
      ...(await baseServices()),
      { path: failingPath },
    ];

    await writeConfig(workspace, services);

    const kernel = createDeferredKernel(workspace.configPath, {
      options: optionsFor(workspace),
    });

    await assert.rejects(
      kernel.boot({ options: optionsFor(workspace) }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /composed service failed during initialize/u);
        return true;
      },
    );

    assert.equal(kernel.lifecycleState, 'DISPOSED');

    const observed = (await readFile(observer.logPath, 'utf8')).trim().split('\n');

    assert.deepEqual(observed, ['init:protected', 'dispose:protected']);

    // The composed observer disposed while the hardcore service still held its
    // storage claim. A successful guarded mutation now proves the hardcore
    // service was also disposed, last.
    assert.doesNotThrow(() => utimesSync(workspace.registryPath, new Date(), new Date()));
  });
});