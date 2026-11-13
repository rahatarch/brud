import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as ts from 'typescript';
import {
  HARDCORE_SERVICES,
  bootKernel,
  buildHardcoreBootEntries,
  invokeHardcoreBootHooks,
  verifyHardcoreServices,
  type BrudConfig,
  type BrudConfigEntry,
  type ComposedServiceDescriptor,
} from '../bootstrap/index.js';
import type { BrudKernel } from '../engine/BrudKernel.js';
import { KernelAccessBroker } from '../engine/KernelAccessBroker.js';
import { KernelRegistry } from '../engine/KernelRegistry.js';
import type { ServiceContext } from '../contracts/lifecycle.js';
import type { ServiceDescriptor } from '../contracts/serviceDescriptor.js';
import {
  IDENTITY_REGISTRY_CONTRACT_METHODS,
  IDENTITY_REGISTRY_CONTRACT_VERSION,
  IdentityRegistryToken,
  createIdentityRegistryDescriptor,
  loadIdentityRegistryStorage,
  provisionIdentityRegistryStorage,
  type IdentityRegistryService,
} from '../../services/IdentityRegistry/index.js';
import {
  EXPOSED_API_REGISTRY_CONTRACT_METHODS,
  EXPOSED_API_REGISTRY_CONTRACT_VERSION,
  EXPOSED_API_SCOPE_RECORD_FORMAT,
  EXPOSED_API_SCOPE_RECORD_VERSION,
  ExposedApiRegistryToken,
  createExposedApiRegistryDescriptor,
  loadScopeRecord,
  type ExposedApiRegistryService,
  type IExposedApiRegistry,
} from '../../services/ExposedApiRegistry/index.js';

/**
 * Production-mirror proofs that the hardcore mechanism is generic.
 *
 * - BC-4: the mechanism module names no hardcore service's methods or tokens.
 * - The compiled list carries two real services, each with its own contract,
 *   interface, and boot hook, called through one uniform signature.
 * - BC-6: both hardcore services persist through the platform directly, with
 *   no composed storage service and no reach outside the kernel folder.
 */

const KERNEL_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MECHANISM_PATH = join(KERNEL_ROOT, 'src', 'bootstrap', 'hardcore.ts');
const KERNEL_CONFIG_PATH = join(KERNEL_ROOT, 'brud.config.json');
const DRIVERS_ROOT = join(KERNEL_ROOT, 'drivers');

const IDENTITY_SHIM = join(KERNEL_ROOT, 'serviceModules', 'identityRegistry.ts');
const EXPOSED_API_SHIM = join(KERNEL_ROOT, 'serviceModules', 'exposedApiRegistry.ts');

const HARDCORE_METHOD_NAMES: readonly string[] = [
  ...new Set([
    ...IDENTITY_REGISTRY_CONTRACT_METHODS,
    ...EXPOSED_API_REGISTRY_CONTRACT_METHODS,
  ]),
];

const HARDCORE_SERVICE_NAMES: readonly string[] = [
  IdentityRegistryToken.id,
  ExposedApiRegistryToken.id,
  'IdentityRegistry',
  'ExposedApiRegistry',
];

/**
 * Blanks out import declarations from platform builtins.
 *
 * A `node:` import names the platform's own exports, such as `node:path`'s
 * `resolve`. That is platform vocabulary, not a hardcore service's method, so
 * it is excluded before the source is scanned. Every other occurrence counts.
 */
function withoutPlatformImports(source: string): string {
  const file = ts.createSourceFile('mechanism.ts', source, ts.ScriptTarget.Latest, true);
  let result = source;

  for (const statement of file.statements) {
    if (
      ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier)
      && statement.moduleSpecifier.text.startsWith('node:')
    ) {
      const start = statement.getStart(file);
      const end = statement.getEnd();

      result = `${result.slice(0, start)}${' '.repeat(end - start)}${result.slice(end)}`;
    }
  }

  return result;
}

/** Every hardcore method or service name the source mentions as a whole word. */
function serviceVocabularyIn(rawSource: string): readonly string[] {
  const source = withoutPlatformImports(rawSource);
  const found: string[] = [];

  for (const name of HARDCORE_METHOD_NAMES) {
    if (new RegExp(`\\b${name}\\b`, 'u').test(source)) {
      found.push(name);
    }
  }

  for (const name of HARDCORE_SERVICE_NAMES) {
    if (source.toLowerCase().includes(name.toLowerCase())) {
      found.push(name);
    }
  }

  return found;
}

/** Whether a path is equal to or inside a root. */
function isInside(candidate: string, root: string): boolean {
  const normalized = resolvePath(candidate);
  const normalizedRoot = resolvePath(root);

  return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}${sep}`);
}

function isFile(candidate: string): boolean {
  return existsSync(candidate) && statSync(candidate).isFile();
}

/** Resolves a relative specifier the way the hardcore content hash does. */
function resolveRelative(fromFile: string, specifier: string): string | undefined {
  const candidate = resolvePath(dirname(fromFile), specifier);

  if (isFile(candidate)) {
    return candidate;
  }

  if (candidate.endsWith('.js') && isFile(`${candidate.slice(0, -3)}.ts`)) {
    return `${candidate.slice(0, -3)}.ts`;
  }

  if (extname(candidate) === '') {
    for (const suffix of ['.js', '.ts', '/index.js', '/index.ts']) {
      if (isFile(`${candidate}${suffix}`)) {
        return `${candidate}${suffix}`;
      }
    }
  }

  return undefined;
}

interface PackageGraph {
  readonly files: readonly string[];
  readonly bareSpecifiers: readonly string[];
}

/** Walks the real import graph of a package, parsed by the TypeScript compiler. */
function packageGraph(entryPath: string): PackageGraph {
  const files = new Set<string>();
  const bare = new Set<string>();

  const visit = (file: string): void => {
    const absolute = resolvePath(file);

    if (files.has(absolute)) {
      return;
    }

    files.add(absolute);

    const info = ts.preProcessFile(readFileSync(absolute, 'utf8'), true, true);

    for (const imported of info.importedFiles) {
      const specifier = imported.fileName;

      if (!specifier.startsWith('.')) {
        bare.add(specifier);
        continue;
      }

      const next = resolveRelative(absolute, specifier);

      assert.ok(next !== undefined, `unresolved relative import "${specifier}" in ${absolute}`);
      visit(next);
    }
  };

  visit(entryPath);

  return { files: [...files].sort(), bareSpecifiers: [...bare].sort() };
}

/** Reach violations of a hardcore package graph: anything not kernel-or-platform. */
function persistenceReachViolations(graph: PackageGraph): readonly string[] {
  const violations: string[] = [];

  for (const file of graph.files) {
    if (!isInside(file, KERNEL_ROOT)) {
      violations.push(`outside the kernel folder: ${file}`);
    } else if (isInside(file, DRIVERS_ROOT)) {
      violations.push(`reaches the storage-driver abstraction: ${relative(KERNEL_ROOT, file)}`);
    }
  }

  for (const specifier of graph.bareSpecifiers) {
    if (!specifier.startsWith('node:')) {
      violations.push(`non-platform package: ${specifier}`);
    }
  }

  return violations;
}

function readKernelConfig(): BrudConfig {
  return JSON.parse(readFileSync(KERNEL_CONFIG_PATH, 'utf8')) as BrudConfig;
}

describe('hardcore mechanism boundary (BC-4)', () => {
  it('names no hardcore service method, token, or service in the mechanism module', async () => {
    const source = await readFile(MECHANISM_PATH, 'utf8');

    assert.deepEqual(serviceVocabularyIn(source), []);
  });

  it('detects a reintroduced service method or token in mechanism source (guard canary)', () => {
    assert.deepEqual(
      serviceVocabularyIn('interface BootSurface { issue(binding: unknown): unknown }'),
      ['issue'],
    );
    assert.deepEqual(
      serviceVocabularyIn('const sealed = (x) => x.closeRegistration();'),
      ['closeRegistration'],
    );
    assert.deepEqual(
      serviceVocabularyIn("const token = 'brud.core.exposedApiRegistry';"),
      ['brud.core.exposedApiRegistry', 'ExposedApiRegistry'],
    );

    // A platform import is excluded, but the same word used anywhere else is not.
    assert.deepEqual(
      serviceVocabularyIn("import { resolve as resolvePath } from 'node:path';\nresolvePath('.');"),
      [],
    );
    assert.deepEqual(
      serviceVocabularyIn("import { resolve as resolvePath } from 'node:path';\nentry.resolve('x');"),
      ['resolve'],
    );
  });

  it('keeps the compiled list out of the mechanism module', async () => {
    const source = await readFile(MECHANISM_PATH, 'utf8');

    assert.doesNotMatch(source, /HARDCORE_SERVICES/u);
    assert.doesNotMatch(source, /expectedContentHash:\s*'/u);
  });
});

describe('two real hardcore services through one generic mechanism', () => {
  it('compiles exactly two entries, each with its own contract and a uniform boot hook', () => {
    assert.deepEqual(
      HARDCORE_SERVICES.map((entry) => entry.token),
      [IdentityRegistryToken.id, ExposedApiRegistryToken.id],
    );

    const [identity, exposedApi] = HARDCORE_SERVICES;

    assert.ok(identity !== undefined && exposedApi !== undefined);
    assert.equal(identity.contractVersion, IDENTITY_REGISTRY_CONTRACT_VERSION);
    assert.deepEqual(identity.contractInterface, [...IDENTITY_REGISTRY_CONTRACT_METHODS]);
    assert.equal(exposedApi.contractVersion, EXPOSED_API_REGISTRY_CONTRACT_VERSION);
    assert.deepEqual(exposedApi.contractInterface, [...EXPOSED_API_REGISTRY_CONTRACT_METHODS]);
    assert.notDeepEqual(identity.contractInterface, exposedApi.contractInterface);
    assert.notEqual(identity.boot, exposedApi.boot);

    for (const entry of HARDCORE_SERVICES) {
      assert.equal(entry.boot.length, 2, `${entry.token} boot hook must take (instance, context)`);
      assert.match(entry.expectedContentHash, /^[0-9a-f]{64}$/u);
      assert.match(entry.expectedBuiltContentHash, /^[0-9a-f]{64}$/u);
    }

    assert.notEqual(identity.expectedContentHash, exposedApi.expectedContentHash);
  });

  it('verifies each real package against its own entry and calls each real hook with its own verified data', async (t: TestContext) => {
    const root = await mkdtemp(join(tmpdir(), 'brud-hardcore-mechanism-'));
    t.after(async () => {
      await rm(root, { recursive: true, force: true });
    });

    const storagePath = join(root, 'identity-registry.json');
    provisionIdentityRegistryStorage(storagePath);

    const identityDescriptor = createIdentityRegistryDescriptor({ storagePath });
    const exposedApiDescriptor = createExposedApiRegistryDescriptor();
    const composed: ComposedServiceDescriptor[] = [
      {
        descriptor: identityDescriptor as unknown as ServiceDescriptor<unknown, unknown>,
        path: 'kernel:serviceModules/identityRegistry.js',
        official: true,
        resolvedPath: IDENTITY_SHIM,
      },
      {
        descriptor: exposedApiDescriptor as unknown as ServiceDescriptor<unknown, unknown>,
        path: 'kernel:serviceModules/exposedApiRegistry.js',
        official: true,
        resolvedPath: EXPOSED_API_SHIM,
      },
    ];

    // Real verification of both real packages against the real compiled list.
    const packageHashes = verifyHardcoreServices(HARDCORE_SERVICES, composed, KERNEL_CONFIG_PATH);
    const [identityEntry, exposedApiEntry] = HARDCORE_SERVICES;

    assert.ok(identityEntry !== undefined && exposedApiEntry !== undefined);
    assert.equal(packageHashes.get(IdentityRegistryToken.id), identityEntry.expectedContentHash);
    assert.equal(packageHashes.get(ExposedApiRegistryToken.id), exposedApiEntry.expectedContentHash);

    const composition = buildHardcoreBootEntries(composed, packageHashes);

    // Real instances, built by each service's real descriptor factory.
    const broker = new KernelAccessBroker(new KernelRegistry(), () => 'BOOTING');
    const context: ServiceContext = { callerId: 'kernel', tier: 'core', options: {} };
    const identity = identityDescriptor.factory(context, broker) as IdentityRegistryService;
    const exposedApi = exposedApiDescriptor.factory(context, broker) as ExposedApiRegistryService;

    identity.initialize();
    await exposedApi.initialize();

    try {
      assert.equal(exposedApi.isRegistrationOpen(), true);

      invokeHardcoreBootHooks(
        HARDCORE_SERVICES,
        [
          { tokenId: IdentityRegistryToken.id, instance: identity },
          { tokenId: ExposedApiRegistryToken.id, instance: exposedApi },
        ],
        packageHashes,
        composition,
      );

      // The exposed API registry's own hook sealed its own window.
      assert.equal(exposedApi.isRegistrationOpen(), false);

      // The identity registry's own hook recorded one binding per participant,
      // each carrying the verified package digest the mechanism supplied.
      identity.onRunning();

      const records = loadIdentityRegistryStorage(storagePath).records;
      const byPublisher = new Map(records.map((record) => [record.publisher, record]));

      assert.equal(records.length, 2);
      assert.equal(
        byPublisher.get(IdentityRegistryToken.id)?.contentHash,
        identityEntry.expectedContentHash,
      );
      assert.equal(
        byPublisher.get(ExposedApiRegistryToken.id)?.contentHash,
        exposedApiEntry.expectedContentHash,
      );

      for (const record of records) {
        assert.equal(record.metadata['source'], 'kernel.composition');
        assert.equal(record.metadata['provisional'], true);
        assert.equal(record.state, 'active');
      }
    } finally {
      identity.dispose();
      await exposedApi.dispose();
    }
  });

  it('boots the kernel hardcore-only composition with both services hardcore and sealed before RUNNING', async (t: TestContext) => {
    const root = await mkdtemp(join(tmpdir(), 'brud-hardcore-mechanism-boot-'));
    t.after(async () => {
      await rm(root, { recursive: true, force: true });
    });

    const storagePath = join(root, 'identity-registry.json');
    provisionIdentityRegistryStorage(storagePath);

    const configPath = join(root, 'brud.config.json');
    await writeFile(configPath, JSON.stringify(readKernelConfig(), null, 2), 'utf8');

    const kernel = await bootKernel(configPath, {
      options: { 'identity.registry.path': storagePath },
    });

    try {
      assert.equal(kernel.lifecycleState, 'RUNNING');
      assert.deepEqual(
        kernel.listServices().map((service) => service.id).sort(),
        [ExposedApiRegistryToken.id, IdentityRegistryToken.id].sort(),
      );

      const registry = kernel.requestAccess<IExposedApiRegistry>(
        { callerId: 'kernel', tier: 'core', options: {} },
        ExposedApiRegistryToken,
      );

      assert.equal(registry.isRegistrationOpen(), false);

      const records = loadIdentityRegistryStorage(storagePath).records;
      const exposedApiRecord = records.find(
        (record) => record.publisher === ExposedApiRegistryToken.id,
      );

      assert.equal(records.length, 2);
      assert.equal(exposedApiRecord?.contentHash, HARDCORE_SERVICES[1]?.expectedContentHash);
    } finally {
      await kernel.shutdown();
    }
  });
});

/** Writes a composed fixture that declares one exposed API at boot. */
async function writeRegistrantModule(root: string): Promise<string> {
  const modulePath = join(root, 'persistence-registrant.mjs');

  await writeFile(modulePath, `const token = {
  id: 'test.hardcore.persistenceRegistrant',
  description: 'Declares one exposed API at boot',
  _brand: [],
};

export function createService() {
  return {
    token,
    tier: 'userland',
    dependencies: [],
    factory: () => ({
      registerWithApiRegistry(registry) {
        registry.registerApi('test.persistence.api', token, {
          capability: 'test:read',
          scope: 'runtime',
        });
      },
    }),
  };
}
`, 'utf8');

  return modulePath;
}

describe('hardcore persistence independence (BC-6)', () => {
  it('keeps both hardcore package graphs inside the kernel, on platform builtins, without the driver abstraction', () => {
    for (const shim of [IDENTITY_SHIM, EXPOSED_API_SHIM]) {
      const graph = packageGraph(shim);

      assert.ok(graph.files.length > 1, `${shim} has a real package graph`);
      assert.deepEqual(persistenceReachViolations(graph), [], shim);
    }
  });

  it('detects a hardcore package reaching a composed service or the driver abstraction (guard canary)', () => {
    assert.deepEqual(
      persistenceReachViolations({
        files: [
          join(KERNEL_ROOT, 'drivers', 'contracts', 'IStorageDriver', 'IStorageDriver.ts'),
          resolvePath(KERNEL_ROOT, '..', 'services', 'BrudFileSystem', 'serviceModule.ts'),
        ],
        bareSpecifiers: ['@brud/service-filesystem', 'node:fs'],
      }),
      [
        'reaches the storage-driver abstraction: drivers/contracts/IStorageDriver/IStorageDriver.ts',
        `outside the kernel folder: ${resolvePath(KERNEL_ROOT, '..', 'services', 'BrudFileSystem', 'serviceModule.ts')}`,
        'non-platform package: @brud/service-filesystem',
      ],
    );
  });

  it('persists and reloads both hardcore services across a real restart with no composed storage service', async (t: TestContext) => {
    const root = await mkdtemp(join(tmpdir(), 'brud-hardcore-persistence-'));
    t.after(async () => {
      await rm(root, { recursive: true, force: true });
    });

    const operatorRoot = join(root, 'operator-state');
    await mkdir(operatorRoot, { recursive: true });

    const identityPath = join(operatorRoot, 'identity-registry.json');
    const scopeRecordPath = join(operatorRoot, 'exposed-api-scope.json');
    provisionIdentityRegistryStorage(identityPath);

    const registrantPath = await writeRegistrantModule(root);
    const services: BrudConfigEntry[] = [
      ...readKernelConfig().services,
      { path: registrantPath },
    ];

    assert.deepEqual(
      services.map((service) => service.path),
      [
        'kernel:serviceModules/identityRegistry.js',
        'kernel:serviceModules/exposedApiRegistry.js',
        registrantPath,
      ],
      'the composition carries the two hardcore services and one non-storage fixture only',
    );

    const configPath = join(root, 'brud.config.json');
    await writeFile(configPath, JSON.stringify({ services, plugins: [] }, null, 2), 'utf8');

    const options = {
      'identity.registry.path': identityPath,
      'exposedApi.scopeRecord.path': scopeRecordPath,
    };

    const bootOnce = async (): Promise<BrudKernel> => {
      const kernel = await bootKernel(configPath, { options });

      assert.equal(kernel.lifecycleState, 'RUNNING');

      return kernel;
    };

    // First boot: both hardcore services write their own state to disk.
    const first = await bootOnce();
    await first.shutdown();

    const firstIdentity = loadIdentityRegistryStorage(identityPath);
    const firstScope = loadScopeRecord(scopeRecordPath);
    const rawScope = JSON.parse(await readFile(scopeRecordPath, 'utf8')) as {
      readonly format: unknown;
      readonly version: unknown;
    };

    assert.equal(firstIdentity.records.length, services.length);
    assert.deepEqual(firstScope, [{ name: 'test.persistence.api', version: 1, scope: 'runtime' }]);
    assert.equal(rawScope.format, EXPOSED_API_SCOPE_RECORD_FORMAT);
    assert.equal(rawScope.version, EXPOSED_API_SCOPE_RECORD_VERSION);

    // Second boot: both reload their own persisted state.
    const second = await bootOnce();

    try {
      const registry = second.requestAccess<IExposedApiRegistry>(
        { callerId: 'kernel', tier: 'core', options },
        ExposedApiRegistryToken,
      );

      assert.equal(registry.scopeOf('test.persistence.api'), 'runtime');
    } finally {
      await second.shutdown();
    }

    const secondIdentity = loadIdentityRegistryStorage(identityPath);

    assert.equal(secondIdentity.registryId, firstIdentity.registryId);
    assert.deepEqual(
      secondIdentity.records.map((record) => record.token).sort(),
      firstIdentity.records.map((record) => record.token).sort(),
      'the same composition keeps the same identity tokens across a restart',
    );
    assert.deepEqual(loadScopeRecord(scopeRecordPath), firstScope);
  });
});
