import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve as resolvePath, sep } from 'node:path';
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
  type HardcoreService,
} from '../bootstrap/index.js';
import type { BrudKernel } from '../engine/BrudKernel.js';
import { KernelAccessBroker } from '../engine/KernelAccessBroker.js';
import { KernelCallChain } from '../engine/callChain.js';
import { admitParticipantManifest } from '../contracts/manifest.js';
import { parseBrudConfig } from '../bootstrap/config/parse.js';
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
import {
  PARSER_CONTRACT_METHODS,
  PARSER_CONTRACT_VERSION,
  ParserToken,
  createParserDescriptor,
} from '../../services/Parser/index.js';
import {
  ROUTER_CONTRACT_METHODS,
  ROUTER_CONTRACT_VERSION,
  RouterToken,
  createRouterDescriptor,
} from '../../services/Router/index.js';

/**
 * Production-mirror proofs that the hardcore mechanism is generic.
 *
 * - BC-4: the mechanism module names no hardcore service's methods or tokens.
 * - The compiled list carries four real services, each with its own contract,
 *   interface, and boot hook, called through one uniform signature.
 * - BC-6: every hardcore service stays inside the kernel folder, with
 *   no composed storage service and no reach outside the kernel folder.
 */

const KERNEL_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MECHANISM_PATH = join(KERNEL_ROOT, 'src', 'bootstrap', 'hardcore.ts');
const KERNEL_CONFIG_PATH = join(KERNEL_ROOT, 'brud.config.json');

const IDENTITY_SHIM = join(KERNEL_ROOT, 'serviceModules', 'identityRegistry.ts');
const EXPOSED_API_SHIM = join(KERNEL_ROOT, 'serviceModules', 'exposedApiRegistry.ts');
const PARSER_SHIM = join(KERNEL_ROOT, 'serviceModules', 'parser.ts');
const ROUTER_SHIM = join(KERNEL_ROOT, 'serviceModules', 'router.ts');

const HARDCORE_METHOD_NAMES: readonly string[] = [
  ...new Set([
    ...IDENTITY_REGISTRY_CONTRACT_METHODS,
    ...EXPOSED_API_REGISTRY_CONTRACT_METHODS,
    ...PARSER_CONTRACT_METHODS,
    ...ROUTER_CONTRACT_METHODS,
  ]),
];

const HARDCORE_SERVICE_NAMES: readonly string[] = [
  IdentityRegistryToken.id,
  ExposedApiRegistryToken.id,
  ParserToken.id,
  RouterToken.id,
  'IdentityRegistry',
  'ExposedApiRegistry',
  'Parser',
  'Router',
];

/** The real contract each compiled entry must declare, keyed by token id. */
const OWN_CONTRACTS: ReadonlyMap<
  string,
  { readonly version: string; readonly methods: readonly string[] }
> = new Map([
  [IdentityRegistryToken.id, {
    version: IDENTITY_REGISTRY_CONTRACT_VERSION,
    methods: [...IDENTITY_REGISTRY_CONTRACT_METHODS],
  }],
  [ExposedApiRegistryToken.id, {
    version: EXPOSED_API_REGISTRY_CONTRACT_VERSION,
    methods: [...EXPOSED_API_REGISTRY_CONTRACT_METHODS],
  }],
  [ParserToken.id, {
    version: PARSER_CONTRACT_VERSION,
    methods: [...PARSER_CONTRACT_METHODS],
  }],
  [RouterToken.id, {
    version: ROUTER_CONTRACT_VERSION,
    methods: [...ROUTER_CONTRACT_METHODS],
  }],
]);

const HEX_DIGEST = /^[0-9a-f]{64}$/u;
const CONTRACT_VERSION = /^\d+\.\d+\.\d+$/u;
const METHOD_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

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

/** Whether two method lists name the same set, ignoring order. */
function sameMethods(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const normalize = (methods: readonly string[]): string => [...methods].sort().join('\0');

  return normalize(left) === normalize(right);
}

/**
 * Violations of the compiled list's own entry shape.
 *
 * Every entry must carry a unique token, a contract version, a non-empty
 * method interface, two 64-hex pins, and a two-argument boot hook.
 */
function compiledEntryViolations(list: readonly HardcoreService[]): readonly string[] {
  const violations: string[] = [];
  const tokens = new Set<string>();
  const sourcePins = new Set<string>();
  const builtPins = new Set<string>();

  for (const entry of list) {
    const token = typeof entry.token === 'string' && entry.token.length > 0
      ? entry.token
      : '(no token)';

    if (token === '(no token)') {
      violations.push('an entry has no token');
    } else if (tokens.has(token)) {
      violations.push(`duplicate token "${token}"`);
    } else {
      tokens.add(token);
    }

    if (typeof entry.contractVersion !== 'string' || !CONTRACT_VERSION.test(entry.contractVersion)) {
      violations.push(`${token} has a missing or malformed contract version`);
    }

    if (!Array.isArray(entry.contractInterface) || entry.contractInterface.length === 0) {
      violations.push(`${token} has a missing or malformed contract interface`);
    } else {
      const methods = new Set<string>();

      for (const method of entry.contractInterface) {
        if (typeof method !== 'string' || !METHOD_NAME.test(method)) {
          violations.push(`${token} declares a malformed method name "${String(method)}"`);
        } else if (methods.has(method)) {
          violations.push(`${token} declares duplicate method "${method}"`);
        } else {
          methods.add(method);
        }
      }
    }

    if (typeof entry.expectedContentHash !== 'string' || !HEX_DIGEST.test(entry.expectedContentHash)) {
      violations.push(`${token} has a missing or malformed source pin`);
    } else if (sourcePins.has(entry.expectedContentHash)) {
      violations.push(`${token} does not carry its own source pin`);
    } else {
      sourcePins.add(entry.expectedContentHash);
    }

    if (
      typeof entry.expectedBuiltContentHash !== 'string'
      || !HEX_DIGEST.test(entry.expectedBuiltContentHash)
    ) {
      violations.push(`${token} has a missing or malformed built pin`);
    } else if (builtPins.has(entry.expectedBuiltContentHash)) {
      violations.push(`${token} does not carry its own built pin`);
    } else {
      builtPins.add(entry.expectedBuiltContentHash);
    }

    if (typeof entry.boot !== 'function' || entry.boot.length !== 2) {
      violations.push(`${token} does not carry a uniform two-argument boot hook`);
    }
  }

  return violations;
}

/**
 * Violations where an entry names another hardcore service's method.
 *
 * Each entry's interface must match its own package's real contract. A method
 * that exists only in a different entry's interface is foreign, even when the
 * entry's own contract check would already fail.
 */
function crossServiceMethodViolations(
  list: readonly HardcoreService[],
  ownContracts: ReadonlyMap<
    string,
    { readonly version: string; readonly methods: readonly string[] }
  >,
): readonly string[] {
  const violations: string[] = [];

  for (const entry of list) {
    const own = ownContracts.get(entry.token);

    if (own === undefined) {
      violations.push(`${entry.token} has no known package contract`);
      continue;
    }

    if (entry.contractVersion !== own.version) {
      violations.push(
        `${entry.token} declares contract version "${entry.contractVersion}", `
        + `its package declares "${own.version}"`,
      );
    }

    if (!sameMethods(entry.contractInterface, own.methods)) {
      violations.push(
        `${entry.token} declares [${entry.contractInterface.join(', ')}], `
        + `its package declares [${own.methods.join(', ')}]`,
      );
    }

    for (const method of entry.contractInterface) {
      const belongsElsewhere = !own.methods.includes(method)
        && list.some(
          (other) => other.token !== entry.token && other.contractInterface.includes(method),
        );

      if (belongsElsewhere) {
        violations.push(
          `${entry.token} names method "${method}" that belongs to another hardcore service`,
        );
      }
    }
  }

  return violations;
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
      serviceVocabularyIn('const admitted = (x) => x.register(owner, declaration);'),
      ['register'],
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

describe('four real hardcore services through one generic mechanism', () => {
  it('compiles exactly four entries, each with its own contract and a uniform boot hook', () => {
    assert.deepEqual(
      HARDCORE_SERVICES.map((entry) => entry.token),
      [
        IdentityRegistryToken.id,
        ExposedApiRegistryToken.id,
        ParserToken.id,
        RouterToken.id,
      ],
    );

    const [identity, exposedApi, parser, router] = HARDCORE_SERVICES;

    assert.ok(
      identity !== undefined
      && exposedApi !== undefined
      && parser !== undefined
      && router !== undefined,
    );
    assert.equal(identity.contractVersion, IDENTITY_REGISTRY_CONTRACT_VERSION);
    assert.deepEqual(identity.contractInterface, [...IDENTITY_REGISTRY_CONTRACT_METHODS]);
    assert.equal(exposedApi.contractVersion, EXPOSED_API_REGISTRY_CONTRACT_VERSION);
    assert.deepEqual(exposedApi.contractInterface, [...EXPOSED_API_REGISTRY_CONTRACT_METHODS]);
    assert.equal(parser.contractVersion, PARSER_CONTRACT_VERSION);
    assert.deepEqual(parser.contractInterface, [...PARSER_CONTRACT_METHODS]);
    assert.equal(router.contractVersion, ROUTER_CONTRACT_VERSION);
    assert.deepEqual(router.contractInterface, [...ROUTER_CONTRACT_METHODS]);

    // Each entry carries its own boot hook object, not a shared one.
    assert.equal(new Set(HARDCORE_SERVICES.map((entry) => entry.boot)).size, 4);

    for (const entry of HARDCORE_SERVICES) {
      assert.equal(entry.boot.length, 2, `${entry.token} boot hook must take (instance, context)`);
      assert.match(entry.expectedContentHash, HEX_DIGEST);
      assert.match(entry.expectedBuiltContentHash, HEX_DIGEST);
    }

    assert.equal(new Set(HARDCORE_SERVICES.map((entry) => entry.expectedContentHash)).size, 4);
    assert.equal(new Set(HARDCORE_SERVICES.map((entry) => entry.expectedBuiltContentHash)).size, 4);
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
    const parserDescriptor = createParserDescriptor();

    // Real instances, built by each service's real descriptor factory.
    const broker = new KernelAccessBroker(new KernelRegistry(), () => 'BOOTING');
    const context: ServiceContext = { callerId: 'kernel', tier: 'core', options: {} };
    const parser = parserDescriptor.factory(context, broker);
    const routerDescriptor = createRouterDescriptor({ parser });
    const composed: ComposedServiceDescriptor[] = [
      {
        descriptor: identityDescriptor as unknown as ServiceDescriptor<unknown, unknown>,
        path: 'kernel:serviceModules/identityRegistry.js',
        official: true,
        resolvedPath: IDENTITY_SHIM,
        manifest: admitParticipantManifest(IdentityRegistryToken.id, identityDescriptor.manifest),
      },
      {
        descriptor: exposedApiDescriptor as unknown as ServiceDescriptor<unknown, unknown>,
        path: 'kernel:serviceModules/exposedApiRegistry.js',
        official: true,
        resolvedPath: EXPOSED_API_SHIM,
        manifest: admitParticipantManifest(ExposedApiRegistryToken.id, exposedApiDescriptor.manifest),
      },
      {
        descriptor: parserDescriptor as unknown as ServiceDescriptor<unknown, unknown>,
        path: 'kernel:serviceModules/parser.js',
        official: true,
        resolvedPath: PARSER_SHIM,
        manifest: admitParticipantManifest(ParserToken.id, parserDescriptor.manifest),
      },
      {
        descriptor: routerDescriptor as unknown as ServiceDescriptor<unknown, unknown>,
        path: 'kernel:serviceModules/router.js',
        official: true,
        resolvedPath: ROUTER_SHIM,
        manifest: admitParticipantManifest(RouterToken.id, routerDescriptor.manifest),
      },
    ];

    // Real verification of all four real packages against the real compiled
    // list. Each package is checked against its own entry's source pin.
    const packageHashes = verifyHardcoreServices(HARDCORE_SERVICES, composed, KERNEL_CONFIG_PATH);
    const [identityEntry, exposedApiEntry, parserEntry, routerEntry] = HARDCORE_SERVICES;

    assert.ok(
      identityEntry !== undefined
      && exposedApiEntry !== undefined
      && parserEntry !== undefined
      && routerEntry !== undefined,
    );
    assert.equal(packageHashes.get(IdentityRegistryToken.id), identityEntry.expectedContentHash);
    assert.equal(packageHashes.get(ExposedApiRegistryToken.id), exposedApiEntry.expectedContentHash);
    assert.equal(packageHashes.get(ParserToken.id), parserEntry.expectedContentHash);
    assert.equal(packageHashes.get(RouterToken.id), routerEntry.expectedContentHash);

    const composition = buildHardcoreBootEntries(composed, packageHashes);

    const identity = identityDescriptor.factory(context, broker) as IdentityRegistryService;
    const exposedApi = exposedApiDescriptor.factory(context, broker) as ExposedApiRegistryService;
    const router = routerDescriptor.factory(context, broker);

    identity.initialize();
    await exposedApi.initialize();
    await parser.initialize();
    await router.initialize();

    try {
      assert.equal(exposedApi.isSealed, false);

      const identities = invokeHardcoreBootHooks(
        HARDCORE_SERVICES,
        [
          { tokenId: IdentityRegistryToken.id, instance: identity },
          { tokenId: ExposedApiRegistryToken.id, instance: exposedApi },
          { tokenId: ParserToken.id, instance: parser },
          { tokenId: RouterToken.id, instance: router },
        ],
        packageHashes,
        composition,
        parseBrudConfig(readFileSync(KERNEL_CONFIG_PATH, 'utf8'), KERNEL_CONFIG_PATH),
        new KernelCallChain(() => undefined),
      );

      // The exposed API registry's own hook admitted and sealed its own window.
      assert.equal(exposedApi.isSealed, true);

      // The identity registry's own hook recorded one kernel identity per
      // participant, visible to every later hook through the mechanism.
      assert.deepEqual(
        [...identities.keys()].sort(),
        [
          ExposedApiRegistryToken.id,
          IdentityRegistryToken.id,
          ParserToken.id,
          RouterToken.id,
        ].sort(),
      );

      // The identity registry's own hook recorded one binding per participant,
      // each carrying the verified package digest the mechanism supplied.
      identity.onRunning();

      const records = loadIdentityRegistryStorage(storagePath).records;
      const byPublisher = new Map(records.map((record) => [record.publisher, record]));

      assert.equal(records.length, 4);
      assert.equal(identities.get(IdentityRegistryToken.id), byPublisher.get(IdentityRegistryToken.id)?.token);
      assert.equal(
        byPublisher.get(IdentityRegistryToken.id)?.contentHash,
        identityEntry.expectedContentHash,
      );
      assert.equal(
        byPublisher.get(ExposedApiRegistryToken.id)?.contentHash,
        exposedApiEntry.expectedContentHash,
      );
      assert.equal(
        byPublisher.get(ParserToken.id)?.contentHash,
        parserEntry.expectedContentHash,
      );
      assert.equal(
        byPublisher.get(RouterToken.id)?.contentHash,
        routerEntry.expectedContentHash,
      );

      for (const record of records) {
        assert.equal(record.metadata['source'], 'kernel.composition');
        assert.equal(record.metadata['provisional'], true);
        assert.equal(record.state, 'active');
      }
    } finally {
      identity.dispose();
      await exposedApi.dispose();
      await parser.dispose();
      await router.dispose();
    }
  });

  it('boots the kernel hardcore-only composition with all four services hardcore and sealed before RUNNING', async (t: TestContext) => {
    const root = await mkdtemp(join(tmpdir(), 'brud-hardcore-mechanism-boot-'));
    t.after(async () => {
      await rm(root, { recursive: true, force: true });
    });

    const storagePath = join(root, 'identity-registry.json');
    provisionIdentityRegistryStorage(storagePath);

    const configPath = join(root, 'brud.config.json');
    await writeFile(configPath, JSON.stringify(readKernelConfig(), null, 2), 'utf8');

    const kernel = await bootKernel(configPath, {
      options: {
        'identity.registry.path': storagePath,
        'router.root': root,
      },
    });

    try {
      assert.equal(kernel.lifecycleState, 'RUNNING');
      assert.deepEqual(
        kernel.listServices().map((service) => service.id).sort(),
        [
          ExposedApiRegistryToken.id,
          IdentityRegistryToken.id,
          ParserToken.id,
          RouterToken.id,
        ].sort(),
      );

      const registry = kernel.requestAccess<IExposedApiRegistry>(
        { callerId: 'kernel', tier: 'core', options: {} },
        ExposedApiRegistryToken,
      );

      // Registration is the kernel's alone: every caller's view is resolve.
      assert.deepEqual(Object.keys(registry), ['resolve']);
      assert.equal(kernel.runHostCall({}, () => registry.resolve('test.unregistered')), null);

      const records = loadIdentityRegistryStorage(storagePath).records;
      const exposedApiRecord = records.find(
        (record) => record.publisher === ExposedApiRegistryToken.id,
      );
      const parserRecord = records.find((record) => record.publisher === ParserToken.id);
      const routerRecord = records.find((record) => record.publisher === RouterToken.id);

      assert.equal(records.length, 4);
      assert.equal(exposedApiRecord?.contentHash, HARDCORE_SERVICES[1]?.expectedContentHash);
      assert.equal(parserRecord?.contentHash, HARDCORE_SERVICES[2]?.expectedContentHash);
      assert.equal(routerRecord?.contentHash, HARDCORE_SERVICES[3]?.expectedContentHash);
    } finally {
      await kernel.shutdown();
    }
  });
});

describe('compiled hardcore list boundary', () => {
  it('declares a complete, well-formed entry for every compiled hardcore service', () => {
    assert.deepEqual(compiledEntryViolations(HARDCORE_SERVICES), []);
  });

  it('declares each entry\'s own contract and names no other hardcore service\'s method', () => {
    assert.deepEqual(crossServiceMethodViolations(HARDCORE_SERVICES, OWN_CONTRACTS), []);
  });

  it('detects a malformed entry and a cross-service method (guard canary)', () => {
    const [identity] = HARDCORE_SERVICES;

    assert.ok(identity !== undefined);

    const malformed = [
      {
        ...identity,
        token: 'test.hardcore.malformed',
        contractVersion: 'one',
        contractInterface: [],
        expectedContentHash: 'not-a-hash',
        expectedBuiltContentHash: '',
        boot: (): void => undefined,
      },
    ] as unknown as readonly HardcoreService[];

    const violations = compiledEntryViolations(malformed);

    assert.ok(violations.some((violation) => /contract version/u.test(violation)));
    assert.ok(violations.some((violation) => /contract interface/u.test(violation)));
    assert.ok(violations.some((violation) => /source pin/u.test(violation)));
    assert.ok(violations.some((violation) => /built pin/u.test(violation)));
    assert.ok(violations.some((violation) => /boot hook/u.test(violation)));

    const crossService = HARDCORE_SERVICES.map((entry) =>
      entry.token === IdentityRegistryToken.id
        ? { ...entry, contractInterface: ['issue', 'register'] }
        : entry) as unknown as readonly HardcoreService[];

    assert.deepEqual(
      crossServiceMethodViolations(crossService, OWN_CONTRACTS),
      [
        'brud.core.identityRegistry declares [issue, register], its package declares [issue, resolve, retire, revoke]',
        'brud.core.identityRegistry names method "register" that belongs to another hardcore service',
      ],
    );
  });
});

/** Writes a composed fixture whose manifest declares one exposed API. */
async function writeRegistrantModule(root: string): Promise<string> {
  const modulePath = join(root, 'persistence-registrant.mjs');

  await writeFile(modulePath, `const token = {
  id: 'test.hardcore.persistenceRegistrant',
  description: 'Declares one exposed API in its manifest',
  _brand: [],
};

export function createService() {
  return {
    token,
    tier: 'userland',
    dependencies: [],
    manifest: {
      exposures: [{
        name: 'test.persistence.api',
        scope: 'runtime',
        policy: { policyVersion: 1, capabilities: ['test:read'] },
      }],
    },
    factory: () => ({}),
  };
}
`, 'utf8');

  return modulePath;
}

describe('hardcore persistence independence (BC-6)', () => {
  it('keeps every hardcore package graph inside the kernel, on platform builtins, without a storage-driver reach', () => {
    for (const shim of [IDENTITY_SHIM, EXPOSED_API_SHIM, PARSER_SHIM, ROUTER_SHIM]) {
      const graph = packageGraph(shim);

      assert.ok(graph.files.length > 1, `${shim} has a real package graph`);
      assert.deepEqual(persistenceReachViolations(graph), [], shim);
    }
  });

  it('detects a hardcore package reaching a composed service or the driver abstraction (guard canary)', () => {
    assert.deepEqual(
      persistenceReachViolations({
        files: [
          resolvePath(KERNEL_ROOT, '..', 'services', 'BrudFileSystem', 'contracts', 'IStorageDriver', 'IStorageDriver.ts'),
          resolvePath(KERNEL_ROOT, '..', 'services', 'BrudFileSystem', 'serviceModule.ts'),
        ],
        bareSpecifiers: ['@brud/service-filesystem', 'node:fs'],
      }),
      [
        `outside the kernel folder: ${resolvePath(KERNEL_ROOT, '..', 'services', 'BrudFileSystem', 'contracts', 'IStorageDriver', 'IStorageDriver.ts')}`,
        `outside the kernel folder: ${resolvePath(KERNEL_ROOT, '..', 'services', 'BrudFileSystem', 'serviceModule.ts')}`,
        'non-platform package: @brud/service-filesystem',
      ],
    );
  });

  it('persists and reloads every hardcore service across a real restart with no composed storage service', async (t: TestContext) => {
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
        'kernel:serviceModules/parser.js',
        'kernel:serviceModules/router.js',
        registrantPath,
      ],
      'the composition carries the four hardcore services and one non-storage fixture only',
    );

    const configPath = join(root, 'brud.config.json');
    await writeFile(configPath, JSON.stringify({ services, plugins: [] }, null, 2), 'utf8');

    const options = {
      'identity.registry.path': identityPath,
      'exposedApi.scopeRecord.path': scopeRecordPath,
      'router.root': root,
    };

    const bootOnce = async (): Promise<BrudKernel> => {
      const kernel = await bootKernel(configPath, { options });

      assert.equal(kernel.lifecycleState, 'RUNNING');

      return kernel;
    };

    // First boot: both stateful hardcore services write their own state to disk.
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
      // The reloaded record is the scope the second boot enforces.
      assert.deepEqual(loadScopeRecord(scopeRecordPath), firstScope);
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
