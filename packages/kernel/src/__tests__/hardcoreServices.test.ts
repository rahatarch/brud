import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootKernel,
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

const REGISTRY_MODULE_PATH = 'kernel:serviceModules/identityRegistry.js';

let baseServicesCache: Promise<readonly BrudConfigEntry[]> | undefined;

function baseServices(): Promise<readonly BrudConfigEntry[]> {
  baseServicesCache ??= readFile(KERNEL_CONFIG_PATH, 'utf8').then(
    (raw) => (JSON.parse(raw) as BrudConfig).services,
  );

  return baseServicesCache;
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
  return services.map((service) =>
    service.path === REGISTRY_MODULE_PATH
      ? { path: substitutePath, official: true }
      : service);
}

async function writeSubstituteModule(
  root: string,
  name: string,
  contractVersion: string,
  methods: readonly string[],
): Promise<string> {
  const modulePath = join(root, `${name}.mjs`);

  await writeFile(modulePath, `export function createService() {
  return {
    token: {
      id: 'brud.core.identityRegistry',
      description: 'substituted identity registry',
      _brand: [],
    },
    tier: 'core',
    dependencies: [],
    contract: {
      version: ${JSON.stringify(contractVersion)},
      methods: ${JSON.stringify(methods)},
    },
    factory: () => ({
      issue() { throw new Error('substitute issue'); },
      resolve() { return null; },
      retire() { throw new Error('substitute retire'); },
      revoke() { throw new Error('substitute revoke'); },
    }),
  };
}
`, 'utf8');

  return modulePath;
}

async function writeInitializeMarkerModule(
  root: string,
): Promise<{ readonly modulePath: string; readonly markerPath: string }> {
  const markerPath = join(root, 'initialized.marker');
  const modulePath = join(root, 'initialize-marker.mjs');

  await writeFile(modulePath, `import { writeFileSync } from 'node:fs';

export function createService() {
  return {
    token: {
      id: 'test.hardcore.initializeMarker',
      description: 'Writes a marker when initialized',
      _brand: [],
    },
    tier: 'userland',
    dependencies: [],
    factory: () => ({
      initialize() {
        writeFileSync(${JSON.stringify(markerPath)}, 'initialized', 'utf8');
      },
    }),
  };
}
`, 'utf8');

  return { modulePath, markerPath };
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

    await assert.rejects(readFile(marker.markerPath, 'utf8'));
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
});