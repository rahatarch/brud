import { readFileSync, writeFileSync } from 'node:fs';
import { appendFile, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDeferredKernel,
  createServiceToken,
  provisionIdentityRegistryStorage,
  type BrudKernel,
  type IServiceLifecycle,
  type ServiceContext,
  type ServiceDescriptor,
} from '../../../index.js';
import {
  ExposedApiInvalidPolicyError,
  ExposedApiInvalidScopeError,
  ExposedApiInvalidVersionError,
  ExposedApiScopeNarrowingError,
  ExposedApiScopeRecordCorruptError,
} from '../contracts/errors.js';
import type { IExposedApiRegistry } from '../contracts/IExposedApiRegistry.js';
import type {
  ExposedApiRegistration,
  ExposedApiScope,
  ExposedApiVersion,
} from '../contracts/types.js';
import { withExposedApis } from '../contracts/registrant.js';
import { ExposedApiRegistryToken } from '../descriptor/tokens.js';

interface ProbeService extends IServiceLifecycle {
  readonly marker: string;
}

interface ProbeRegistration {
  readonly apiName: string;
  readonly registration: ExposedApiRegistration;
}

interface ProbeFixture {
  readonly descriptor: ServiceDescriptor<ProbeService, ProbeService>;
  readonly tokenId: string;
}

interface TestWorkspace {
  readonly root: string;
  readonly workspaceRoot: string;
  readonly identityRegistryPath: string;
  readonly scopeRecordPath: string;
  readonly configPath: string;
  readonly options: Readonly<Record<string, unknown>>;
}

let workspace: TestWorkspace;
const bootedKernels: BrudKernel[] = [];

beforeEach(async () => {
  workspace = await createWorkspace();
});

afterEach(async () => {
  for (const kernel of bootedKernels.splice(0)) {
    await shutdown(kernel);
  }

  await rm(workspace.root, { recursive: true, force: true });
});

async function createWorkspace(): Promise<TestWorkspace> {
  const root = await mkdtemp(join(tmpdir(), 'brud-exposed-api-model-'));
  const workspaceRoot = join(root, 'workspace');
  const operatorRoot = join(root, 'operator');
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(operatorRoot, { recursive: true });

  const identityRegistryPath = join(operatorRoot, 'identity-registry.json');
  const scopeRecordPath = join(operatorRoot, 'scope-record.json');
  provisionIdentityRegistryStorage(identityRegistryPath);

  const configPath = join(operatorRoot, 'brud.config.json');
  await writeFile(
    configPath,
    JSON.stringify({
      services: [
        { path: 'kernel:serviceModules/exposedApiRegistry.js', official: true },
        { path: 'kernel:serviceModules/identityRegistry.js', official: true },
      ],
      plugins: [],
    }, null, 2),
    'utf8',
  );

  return {
    root,
    workspaceRoot,
    identityRegistryPath,
    scopeRecordPath,
    configPath,
    options: {
      'workspace.root': workspaceRoot,
      'identity.registry.path': identityRegistryPath,
      'exposedApi.scopeRecord.path': scopeRecordPath,
    },
  };
}

function createProbe(
  tokenId: string,
  registrations: readonly ProbeRegistration[],
): ProbeFixture {
  const token = createServiceToken<ProbeService>(
    tokenId,
    `Exposed API model probe ${tokenId}`,
  );

  const descriptor: ServiceDescriptor<ProbeService, ProbeService> = {
    token,
    tier: 'core',
    dependencies: [],
    factory: (): ProbeService => withExposedApis(
      {
        marker: tokenId,
        initialize: async (): Promise<void> => undefined,
        dispose: async (): Promise<void> => undefined,
      },
      (registry) => {
        for (const entry of registrations) {
          registry.registerApi(entry.apiName, token, entry.registration);
        }
      },
    ),
  };

  return { descriptor, tokenId: token.id };
}

async function boot(
  probes: readonly ProbeFixture[],
): Promise<BrudKernel> {
  const kernel = createDeferredKernel(workspace.configPath, {
    options: workspace.options,
  });

  for (const probe of probes) {
    kernel.register(probe.descriptor);
  }

  await kernel.boot({ options: workspace.options });
  bootedKernels.push(kernel);

  return kernel;
}

function caller(): ServiceContext {
  return {
    callerId: 'kernel',
    tier: 'core',
    options: workspace.options,
  };
}

function registryOf(kernel: BrudKernel): IExposedApiRegistry {
  return kernel.requestAccess<IExposedApiRegistry>(
    caller(),
    ExposedApiRegistryToken,
  );
}

function access(
  origin: 'kernel' | 'runtime' | 'host',
  overrides: Partial<{
    readonly callerId: string;
    readonly subjectId: string;
    readonly official: boolean;
  }> = {},
): {
  readonly callerId: string;
  readonly tier: 'core';
  readonly workspaceRoot: string;
  readonly origin: 'kernel' | 'runtime' | 'host';
  readonly subjectId?: string;
  readonly official?: boolean;
} {
  return {
    callerId: overrides.callerId ?? 'test.external.caller',
    tier: 'core',
    workspaceRoot: workspace.workspaceRoot,
    origin,
    ...(overrides.subjectId === undefined ? {} : { subjectId: overrides.subjectId }),
    ...(overrides.official === undefined ? {} : { official: overrides.official }),
  };
}

function scopeRecord(): {
  readonly records: readonly {
    readonly name: string;
    readonly version: ExposedApiVersion;
    readonly scope: ExposedApiScope;
  }[];
} {
  return JSON.parse(readFileSync(workspace.scopeRecordPath, 'utf8')) as {
    readonly records: readonly {
      readonly name: string;
      readonly version: ExposedApiVersion;
      readonly scope: ExposedApiScope;
    }[];
  };
}

function recordFor(name: string, version: ExposedApiVersion = 1): {
  readonly name: string;
  readonly version: ExposedApiVersion;
  readonly scope: ExposedApiScope;
} | undefined {
  return scopeRecord().records.find(
    (record) => record.name === name && record.version === version,
  );
}

async function shutdown(kernel: BrudKernel): Promise<void> {
  if (kernel.lifecycleState === 'RUNNING') {
    await kernel.shutdown();
  }
}

describe('universal exposed API scope model', () => {
  it('kernel scope accepts only kernel origin', async (t) => {
    const kernel = await boot([
      createProbe('test.scope.kernel', [{
        apiName: 'test.scope.kernel',
        registration: { capability: 'test:read', scope: 'kernel', projection: () => 'kernel-handle' },
      }]),
    ]);
    t.after(() => shutdown(kernel));
    const registry = registryOf(kernel);

    assert.equal(registry.resolve('test.scope.kernel', ['test:read'], access('kernel')), 'kernel-handle');
    assert.equal(registry.resolve('test.scope.kernel', ['test:read'], access('runtime')), null);
    assert.equal(registry.resolve('test.scope.kernel', ['test:read'], access('host')), null);
  });

  it('runtime scope accepts kernel and runtime origins, not host', async (t) => {
    const kernel = await boot([
      createProbe('test.scope.runtime', [{
        apiName: 'test.scope.runtime',
        registration: { capability: 'test:read', scope: 'runtime', projection: () => 'runtime-handle' },
      }]),
    ]);
    t.after(() => shutdown(kernel));
    const registry = registryOf(kernel);

    assert.equal(registry.resolve('test.scope.runtime', ['test:read'], access('kernel')), 'runtime-handle');
    assert.equal(registry.resolve('test.scope.runtime', ['test:read'], access('runtime')), 'runtime-handle');
    assert.equal(registry.resolve('test.scope.runtime', ['test:read'], access('host')), null);
  });

  it('host scope accepts only host origin', async (t) => {
    const kernel = await boot([
      createProbe('test.scope.host', [{
        apiName: 'test.scope.host',
        registration: { capability: 'test:read', scope: 'host', projection: () => 'host-handle' },
      }]),
    ]);
    t.after(() => shutdown(kernel));
    const registry = registryOf(kernel);

    assert.equal(registry.resolve('test.scope.host', ['test:read'], access('host')), 'host-handle');
    assert.equal(registry.resolve('test.scope.host', ['test:read'], access('kernel')), null);
    assert.equal(registry.resolve('test.scope.host', ['test:read'], access('runtime')), null);
  });

  it('any scope accepts every origin', async (t) => {
    const kernel = await boot([
      createProbe('test.scope.any', [{
        apiName: 'test.scope.any',
        registration: { capability: 'test:read', scope: 'any', projection: () => 'any-handle' },
      }]),
    ]);
    t.after(() => shutdown(kernel));
    const registry = registryOf(kernel);

    for (const origin of ['kernel', 'runtime', 'host'] as const) {
      assert.equal(registry.resolve('test.scope.any', ['test:read'], access(origin)), 'any-handle');
    }
  });

  it('defaults an omitted version, scope, and policy to 1, kernel, and empty', async (t) => {
    const kernel = await boot([
      createProbe('test.scope.default', [{
        apiName: 'test.scope.default',
        registration: { capability: 'test:read', projection: () => 'default-handle' },
      }]),
    ]);
    t.after(() => shutdown(kernel));
    const registry = registryOf(kernel);
    const resolved = registry.resolveWithMetadata(
      'test.scope.default',
      ['test:read'],
      access('kernel'),
    );

    assert.equal(resolved?.handle, 'default-handle');
    assert.equal(resolved?.version, 1);
    assert.equal(resolved?.scope, 'kernel');
    assert.deepEqual(resolved?.policy, {});
    assert.equal(registry.scopeOf('test.scope.default'), 'kernel');
    assert.deepEqual(recordFor('test.scope.default'), {
      name: 'test.scope.default',
      version: 1,
      scope: 'kernel',
    });
    assert.equal(registry.resolve('test.scope.default', ['test:read'], access('runtime')), null);
    assert.equal(registry.resolve('test.scope.default', ['test:read'], access('host')), null);
  });

  it('persists the scope record across shutdown and reboot', async () => {
    const first = await boot([
      createProbe('test.persist', [{
        apiName: 'test.persist',
        registration: { capability: 'test:read', scope: 'runtime', projection: () => 'persisted' },
      }]),
    ]);

    assert.deepEqual(recordFor('test.persist'), {
      name: 'test.persist',
      version: 1,
      scope: 'runtime',
    });
    await shutdown(first);

    const second = await boot([
      createProbe('test.persist', [{
        apiName: 'test.persist',
        registration: { capability: 'test:read', scope: 'runtime', projection: () => 'persisted-again' },
      }]),
    ]);

    try {
      const registry = registryOf(second);
      assert.equal(registry.scopeOf('test.persist'), 'runtime');
      assert.equal(
        registry.resolve('test.persist', ['test:read'], access('runtime')),
        'persisted-again',
      );
      assert.equal(registry.resolve('test.persist', ['test:read'], access('host')), null);
    } finally {
      await shutdown(second);
    }
  });

  it('refuses narrowing within one version on reboot and names both scopes', async () => {
    const first = await boot([
      createProbe('test.narrow', [{
        apiName: 'test.narrow',
        registration: { capability: 'test:read', scope: 'runtime' },
      }]),
    ]);
    await shutdown(first);

    const second = createDeferredKernel(workspace.configPath, {
      options: workspace.options,
    });
    const probe = createProbe('test.narrow', [{
      apiName: 'test.narrow',
      registration: { capability: 'test:read', scope: 'kernel' },
    }]);
    second.register(probe.descriptor);

    await assert.rejects(
      second.boot({ options: workspace.options }),
      (error: unknown) => {
        assert.ok(error instanceof ExposedApiScopeNarrowingError);
        assert.equal(error.code, 'EXPOSED_API_SCOPE_NARROWED');
        assert.equal(error.apiName, 'test.narrow');
        assert.equal(error.version, '1');
        assert.equal(error.persistedScope, 'runtime');
        assert.equal(error.requestedScope, 'kernel');
        assert.match(error.message, /runtime/u);
        assert.match(error.message, /kernel/u);
        return true;
      },
    );

    assert.deepEqual(recordFor('test.narrow'), {
      name: 'test.narrow',
      version: 1,
      scope: 'runtime',
    });
  });

  it('allows widening within one version and records it', async () => {
    const first = await boot([
      createProbe('test.widen', [{
        apiName: 'test.widen',
        registration: { capability: 'test:read', scope: 'kernel' },
      }]),
    ]);
    await shutdown(first);

    const second = await boot([
      createProbe('test.widen', [{
        apiName: 'test.widen',
        registration: { capability: 'test:read', scope: 'runtime', projection: () => 'widened' },
      }]),
    ]);

    try {
      assert.deepEqual(recordFor('test.widen'), {
        name: 'test.widen',
        version: 1,
        scope: 'runtime',
      });
      const registry = registryOf(second);
      assert.equal(registry.scopeOf('test.widen'), 'runtime');
      assert.equal(registry.resolve('test.widen', ['test:read'], access('runtime')), 'widened');
    } finally {
      await shutdown(second);
    }
  });

  it('allows a new major version with a narrower scope and keeps both versions callable', async (t) => {
    const kernel = await boot([
      createProbe('test.coexist', [
        {
          apiName: 'test.coexist',
          registration: {
            capability: 'test:read',
            version: 1,
            scope: 'runtime',
            projection: () => 'v1',
          },
        },
        {
          apiName: 'test.coexist',
          registration: {
            capability: 'test:read',
            version: 2,
            scope: 'kernel',
            projection: () => 'v2',
          },
        },
      ]),
    ]);
    t.after(() => shutdown(kernel));
    const registry = registryOf(kernel);

    assert.equal(registry.resolve('test.coexist', ['test:read'], access('runtime'), 1), 'v1');
    assert.equal(registry.resolve('test.coexist', ['test:read'], access('kernel'), 1), 'v1');
    assert.equal(registry.resolve('test.coexist', ['test:read'], access('host'), 1), null);
    assert.equal(registry.resolve('test.coexist', ['test:read'], access('kernel'), 2), 'v2');
    assert.equal(registry.resolve('test.coexist', ['test:read'], access('runtime'), 2), null);
    assert.deepEqual(registry.registeredApiIdentities().map(
      (identity) => `${identity.name}@${String(identity.version)}`,
    ), ['test.coexist@1', 'test.coexist@2']);

    assert.deepEqual(recordFor('test.coexist', 1), {
      name: 'test.coexist',
      version: 1,
      scope: 'runtime',
    });
    assert.deepEqual(recordFor('test.coexist', 2), {
      name: 'test.coexist',
      version: 2,
      scope: 'kernel',
    });
  });

  it('stores and returns the policy with the resolved handle without enforcing it', async (t) => {
    const policy = Object.freeze({
      allowedCallers: ['nobody'],
      requireOfficial: true,
    });
    const kernel = await boot([
      createProbe('test.policy', [{
        apiName: 'test.policy',
        registration: {
          capability: 'test:read',
          scope: 'runtime',
          policy,
          projection: () => 'policy-handle',
        },
      }]),
    ]);
    t.after(() => shutdown(kernel));
    const registry = registryOf(kernel);

    const resolved = registry.resolveWithMetadata(
      'test.policy',
      ['test:read'],
      access('runtime', { official: false }),
    );

    assert.equal(resolved?.handle, 'policy-handle');
    assert.deepEqual(resolved?.policy, policy);
    assert.deepEqual(resolved?.policies, [policy]);
    assert.equal(
      registry.resolve('test.policy', ['test:read'], access('runtime', { official: false })),
      'policy-handle',
    );
  });

  it('checks the root origin before the immediate caller shape', async (t) => {
    const kernel = await boot([
      createProbe('test.origin', [
        {
          apiName: 'test.origin.host',
          registration: { capability: 'test:read', scope: 'host', projection: () => 'host' },
        },
        {
          apiName: 'test.origin.runtime',
          registration: { capability: 'test:read', scope: 'runtime', projection: () => 'runtime' },
        },
        {
          apiName: 'test.origin.kernel',
          registration: { capability: 'test:read', scope: 'kernel', projection: () => 'kernel' },
        },
      ]),
    ]);
    t.after(() => shutdown(kernel));
    const registry = registryOf(kernel);
    const hostShaped = access('runtime', { callerId: 'brud.host.daemon' });
    const pluginShaped = access('kernel', {
      callerId: 'brud.core.pluginManager',
      subjectId: 'acme.plugin',
      official: false,
    });

    assert.equal(registry.resolve('test.origin.host', ['test:read'], hostShaped), null);
    assert.equal(
      registry.resolve('test.origin.host', ['test:read'], access('host', { callerId: 'brud.host.daemon' })),
      'host',
    );

    const inferredPlugin = {
      callerId: 'brud.core.pluginManager',
      tier: 'core' as const,
      workspaceRoot: workspace.workspaceRoot,
      subjectId: 'acme.plugin',
      official: false,
    };

    assert.equal(registry.resolve('test.origin.kernel', ['test:read'], inferredPlugin), null);
    assert.equal(registry.resolve('test.origin.runtime', ['test:read'], inferredPlugin), 'runtime');
    assert.equal(registry.resolve('test.origin.host', ['test:read'], pluginShaped), null);
  });

  it('write-protects the scope record while the kernel runs', async (t) => {
    const kernel = await boot([
      createProbe('test.protected', [{
        apiName: 'test.protected',
        registration: { capability: 'test:read', scope: 'kernel' },
      }]),
    ]);
    t.after(() => shutdown(kernel));

    const before = readFileSync(workspace.scopeRecordPath, 'utf8');

    assert.throws(() => writeFileSync(workspace.scopeRecordPath, 'tampered'));
    assert.throws(() => writeFileSync(workspace.scopeRecordPath, `${before}\n`));
    await assert.rejects(appendFile(workspace.scopeRecordPath, 'tampered'));
    await assert.rejects(unlink(workspace.scopeRecordPath));
    assert.equal(readFileSync(workspace.scopeRecordPath, 'utf8'), before);
  });

  it('refuses boot when the persisted scope record is corrupt', async () => {
    const first = await boot([
      createProbe('test.corrupt', [{
        apiName: 'test.corrupt',
        registration: { capability: 'test:read', scope: 'runtime' },
      }]),
    ]);
    await shutdown(first);

    await writeFile(workspace.scopeRecordPath, '{not-json', 'utf8');

    const second = createDeferredKernel(workspace.configPath, {
      options: workspace.options,
    });
    second.register(createProbe('test.corrupt', [{
      apiName: 'test.corrupt',
      registration: { capability: 'test:read', scope: 'runtime' },
    }]).descriptor);

    await assert.rejects(
      second.boot({ options: workspace.options }),
      (error: unknown) => {
        assert.ok(error instanceof ExposedApiScopeRecordCorruptError);
        assert.equal(error.code, 'EXPOSED_API_SCOPE_RECORD_CORRUPT');
        return true;
      },
    );
  });

  it('refuses boot when a valid-looking scope record fails its integrity digest', async () => {
    const first = await boot([
      createProbe('test.digest', [{
        apiName: 'test.digest',
        registration: { capability: 'test:read', scope: 'runtime' },
      }]),
    ]);
    await shutdown(first);

    const document = JSON.parse(
      readFileSync(workspace.scopeRecordPath, 'utf8'),
    ) as {
      records: { name: string; version: ExposedApiVersion; scope: ExposedApiScope }[];
    };
    const record = document.records.find((entry) => entry.name === 'test.digest');
    assert.ok(record);
    record.scope = 'kernel';
    await writeFile(workspace.scopeRecordPath, JSON.stringify(document), 'utf8');

    const second = createDeferredKernel(workspace.configPath, {
      options: workspace.options,
    });
    second.register(createProbe('test.digest', [{
      apiName: 'test.digest',
      registration: { capability: 'test:read', scope: 'runtime' },
    }]).descriptor);

    await assert.rejects(
      second.boot({ options: workspace.options }),
      (error: unknown) => {
        assert.ok(error instanceof ExposedApiScopeRecordCorruptError);
        assert.match(error.reason, /integrity digest mismatch/u);
        return true;
      },
    );
  });

  it('refuses invalid version, scope, and policy declarations', async () => {
    const cases: readonly {
      readonly probe: ProbeFixture;
      readonly expected: new (...args: never[]) => Error;
    }[] = [
      {
        probe: createProbe('test.invalid.version', [{
          apiName: 'test.invalid.version',
          registration: { capability: 'test:read', version: 0 },
        }]),
        expected: ExposedApiInvalidVersionError,
      },
      {
        probe: createProbe('test.invalid.scope', [{
          apiName: 'test.invalid.scope',
          registration: { capability: 'test:read', scope: 'inside' as ExposedApiScope },
        }]),
        expected: ExposedApiInvalidScopeError,
      },
      {
        probe: createProbe('test.invalid.policy', [{
          apiName: 'test.invalid.policy',
          registration: {
            capability: 'test:read',
            policy: { callback: () => undefined } as unknown as Readonly<Record<string, unknown>>,
          },
        }]),
        expected: ExposedApiInvalidPolicyError,
      },
    ];

    for (const testCase of cases) {
      const kernel = createDeferredKernel(workspace.configPath, {
        options: workspace.options,
      });
      kernel.register(testCase.probe.descriptor);

      await assert.rejects(
        kernel.boot({ options: workspace.options }),
        (error: unknown) => {
          assert.ok(error instanceof testCase.expected);
          return true;
        },
      );
    }
  });
});