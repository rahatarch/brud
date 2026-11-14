import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createStandardKernel } from '../bootstrap/index.js';
import type {
  IServiceLifecycle,
  ServiceContext,
} from '../contracts/lifecycle.js';
import type { ServiceDescriptor } from '../contracts/serviceDescriptor.js';
import { createServiceToken } from '../contracts/serviceToken.js';
import type { BrudKernel } from '../engine/BrudKernel.js';
import type { OperationResult } from '../contracts/handler.js';
import {
  ExposedApiNameCollisionError,
  ExposedApiRegistrationClosedError,
} from '../../services/ExposedApiRegistry/contracts/errors.js';
import { CORE_API_NAME } from '../../services/ExposedApiRegistry/contracts/coreApis.js';
import type { IExposedApiRegistry } from '../../services/ExposedApiRegistry/contracts/IExposedApiRegistry.js';
import { ExposedApiRegistryToken } from '../../services/ExposedApiRegistry/descriptor/tokens.js';
import { withExposedApis } from '../../services/ExposedApiRegistry/contracts/registrant.js';
import type { ExposedApiRegistration } from '../../services/ExposedApiRegistry/contracts/types.js';
import type { IBrudPlugin } from '../../../services/PluginManager/contracts/IBrudPlugin.js';
import { PluginPermissionError } from '../../../services/PluginManager/contracts/errors.js';
import { PluginManagerService } from '../../../services/PluginManager/orchestrator/PluginManagerService.js';
import { workspaceContextOptions } from './support/workspaceContext.js';

interface ProbeService extends IServiceLifecycle {
  readonly marker: string;
}

interface ProbeFixture {
  readonly descriptor: ServiceDescriptor<ProbeService, ProbeService>;
  readonly tokenId: string;
}

function caller(root: string): ServiceContext {
  return { callerId: 'kernel', tier: 'core', options: {...workspaceContextOptions(root)} };
}

function createProbe(options: {
  readonly tokenId: string;
  readonly apiName: string;
  readonly entries: readonly ExposedApiRegistration[];
}): ProbeFixture {
  const token = createServiceToken<ProbeService>(
    options.tokenId,
    `Test probe service ${options.tokenId}`,
  );

  const descriptor: ServiceDescriptor<ProbeService, ProbeService> = {
    token,
    tier: 'core',
    dependencies: [],
    factory: (): ProbeService => {
      const service: ProbeService = {
        marker: options.tokenId,
        initialize: async (): Promise<void> => undefined,
        dispose: async (): Promise<void> => undefined,
      };

      return withExposedApis(service, (registry) => {
        for (const entry of options.entries) {
          registry.registerApi(options.apiName, token, entry);
        }
      });
    },
  };

  return { descriptor, tokenId: token.id };
}

async function prepare(
  t: TestContext,
  fixtures: readonly (() => ProbeFixture)[],
  initialPlugins: readonly IBrudPlugin[] = [],
): Promise<{ kernel: BrudKernel; root: string; domains: readonly ProbeFixture[] }> {
  const root = await mkdtemp(join(tmpdir(), 'brud-exposed-api-'));
  const kernel = createStandardKernel({
    history: { inMemory: true },
    'pluginManager.plugins': { entries: initialPlugins },
  });
  const domains = fixtures.map((fixture) => fixture());

  for (const domain of domains) {
    kernel.register(domain.descriptor);
  }

  t.after(async () => {
    if (kernel.lifecycleState === 'RUNNING') {
      await kernel.shutdown().catch(() => undefined);
    }

    await rm(root, { recursive: true, force: true });
  });

  return { kernel, root, domains };
}

async function compose(
  t: TestContext,
  fixtures: readonly (() => ProbeFixture)[],
  initialPlugins: readonly IBrudPlugin[] = [],
): Promise<{ kernel: BrudKernel; root: string; domains: readonly ProbeFixture[] }> {
  const prepared = await prepare(t, fixtures, initialPlugins);

  await prepared.kernel.boot({ options: {...workspaceContextOptions(prepared.root)} });

  return prepared;
}

describe('Exposed API Registry', () => {
  it('resolves a projection only for a caller with the registered capability', async (t) => {
    const { kernel, root } = await compose(t, [() => createProbe({
      tokenId: 'test.api.one',
      apiName: 'test.one',
      entries: [{
        capability: 'test:read',
        projection: (service) => ({ source: (service as ProbeService).marker }),
      }],
    })]);
    const registry = kernel.requestAccess<IExposedApiRegistry>(
      caller(root),
      ExposedApiRegistryToken,
    );

    assert.deepEqual(registry.resolve('test.one', ['test:read']), {
      source: 'test.api.one',
    });
    assert.equal(registry.resolve('test.one', ['other:capability']), null);
    assert.equal(registry.resolve('test.missing', ['test:read']), null);
  });

  it('merges matching projections and returns null without any capability', async (t) => {
    const { kernel, root } = await compose(t, [() => createProbe({
      tokenId: 'test.api.multi',
      apiName: 'test.multi',
      entries: [
        {
          capability: 'test:read',
          projection: () => ({ read: true }),
        },
        {
          capability: 'test:write',
          projection: () => ({ write: true }),
        },
      ],
    })]);
    const registry = kernel.requestAccess<IExposedApiRegistry>(
      caller(root),
      ExposedApiRegistryToken,
    );

    assert.deepEqual(registry.resolve('test.multi', ['test:read']), { read: true });
    assert.deepEqual(registry.resolve('test.multi', ['test:write']), { write: true });
    assert.deepEqual(registry.resolve('test.multi', ['test:read', 'test:write']), {
      read: true,
      write: true,
    });
    assert.equal(registry.resolve('test.multi', []), null);
    assert.equal(registry.resolve('test.multi', ['other:capability']), null);
  });

  it('fails boot when two services register the same apiName', async (t) => {
    const { kernel, root } = await prepare(t, [
      () => createProbe({
        tokenId: 'test.api.collision.a',
        apiName: 'test.collision',
        entries: [{ capability: 'test:read' }],
      }),
      () => createProbe({
        tokenId: 'test.api.collision.b',
        apiName: 'test.collision',
        entries: [{ capability: 'test:read' }],
      }),
    ]);

    await assert.rejects(
      kernel.boot({ options: {...workspaceContextOptions(root)} }),
      (error: unknown) => {
        assert.ok(error instanceof ExposedApiNameCollisionError);
        assert.equal(error.code, 'EXPOSED_API_NAME_COLLISION');
        assert.equal(error.apiName, 'test.collision');
        assert.equal(error.existingTokenId, 'test.api.collision.a');
        return true;
      },
    );

    assert.equal(kernel.lifecycleState, 'DISPOSED');
  });

  it('rejects registration after RUNNING', async (t) => {
    const { kernel, root, domains } = await compose(t, [() => createProbe({
      tokenId: 'test.api.late',
      apiName: 'test.late',
      entries: [{ capability: 'test:read' }],
    })]);
    const registry = kernel.requestAccess<IExposedApiRegistry>(
      caller(root),
      ExposedApiRegistryToken,
    );
    const domain = domains[0];

    assert.ok(domain);
    assert.equal(registry.isRegistrationOpen(), false);

    assert.throws(
      () => registry.registerApi(
        'test.late.extra',
        createServiceToken<ProbeService>(
          domain.tokenId,
          'Late probe token',
        ),
        { capability: 'test:read' },
      ),
      (error: unknown) => {
        assert.ok(error instanceof ExposedApiRegistrationClosedError);
        assert.equal(error.code, 'EXPOSED_API_REGISTRATION_CLOSED');
        assert.equal(error.apiName, 'test.late.extra');
        return true;
      },
    );
  });

  it('gives fs:read a read-only filesystem and withholds it entirely without the capability', async (t) => {
    let readOnlyFs: unknown;
    let writeError: unknown;
    let deniedError: unknown;

    const readerPlugin: IBrudPlugin = {
      manifest: {
        id: 'acme.test.fs-reader',
        name: 'FS Reader',
        version: '1.0.0',
        permissions: ['fs:read'],
      },
      activate: async (context): Promise<void> => {
        const fs = context.getFileSystem();

        readOnlyFs = fs;
        writeError = await fs.writeAtomic('denied.txt', 'nope').catch((error: unknown) => error);
      },
    };

    const noFsPlugin: IBrudPlugin = {
      manifest: {
        id: 'acme.test.fs-denied',
        name: 'FS Denied',
        version: '1.0.0',
        permissions: [],
      },
      activate: (context): void => {
        try {
          context.getFileSystem();
        } catch (error: unknown) {
          deniedError = error;
        }
      },
    };

    await compose(t, [], [readerPlugin, noFsPlugin]);

    assert.ok(readOnlyFs);
    assert.ok(writeError instanceof Error);
    assert.equal((writeError as { readonly code?: unknown }).code, 'READ_ONLY_VIOLATION');

    assert.ok(deniedError instanceof PluginPermissionError);
    assert.equal(deniedError.code, 'PLUGIN_PERMISSION');
    assert.equal(deniedError.operation, 'getFileSystem');
    assert.deepEqual(deniedError.requiredPermissions, ['fs:read', 'fs:write']);
  });

  it('generic resolve shares the typed projection and returns null for an unknown API', async (t) => {
    let sameProjection = false;
    let photoshop: unknown = 'unset';

    const plugin: IBrudPlugin = {
      manifest: {
        id: 'acme.test.generic-resolve',
        name: 'Generic Resolve',
        version: '1.0.0',
        permissions: ['fs:read'],
      },
      activate: (context): void => {
        const typed = context.getFileSystem();

        sameProjection = context.resolve('filesystem') === typed;
        photoshop = context.resolve('photoshop');
      },
    };

    await compose(t, [], [plugin]);

    assert.equal(sameProjection, true);
    assert.equal(photoshop, null);
  });

  it('builds a plugin context from registry projections, not direct dependencies', async () => {
    const sentinel = Object.freeze({ marker: 'registry-filesystem' });
    const resolvedNames: string[] = [];
    const registry: IExposedApiRegistry = {
      registerApi: (): never => {
        throw new Error('registerApi is not used in this test');
      },
      resolve: <T = unknown>(
        name: string,
        capabilities: Iterable<string>,
      ): T | null => {
        resolvedNames.push(name);

        return name === CORE_API_NAME.fileSystem
          && new Set(capabilities).has('fs:read')
          ? sentinel as T
          : null;
      },
      resolveWithMetadata: <T = unknown>(
        name: string,
        capabilities: Iterable<string>,
      ) => {
        resolvedNames.push(name);

        return name === CORE_API_NAME.fileSystem
          && new Set(capabilities).has('fs:read')
          ? {
              name,
              version: 1,
              scope: 'runtime',
              policy: Object.freeze({}),
              policies: Object.freeze([Object.freeze({})]),
              handle: sentinel as T,
            }
          : null;
      },
      scopeOf: (): null => null,
      closeRegistration: (): void => undefined,
      isRegistrationOpen: (): boolean => false,
      registeredApiNames: (): readonly string[] => [],
      registeredApiIdentities: () => [],
    };
    let captured: unknown;

    const plugin: IBrudPlugin = {
      manifest: {
        id: 'acme.test.registry-sentinel',
        name: 'Registry Sentinel',
        version: '1.0.0',
        permissions: ['fs:read'],
      },
      activate: (context): void => {
        captured = context.getFileSystem();
      },
    };

    const manager = new PluginManagerService({
      workspaceRoot: '/workspace',
      apiRegistry: () => registry,
    });

    manager.register(plugin);
    await manager.initialize();
    await manager.onRunning();

    assert.equal(captured, sentinel);
    assert.ok(resolvedNames.includes(CORE_API_NAME.fileSystem));

    await manager.dispose();
  });

  it('accepts an unregistered extensible capability and yields no projection', async (t) => {
    let captured: unknown;

    const plugin: IBrudPlugin = {
      manifest: {
        id: 'acme.test.photoshop',
        name: 'Photoshop Probe',
        version: '1.0.0',
        permissions: ['photoshop:access'],
      },
      activate: (context): void => {
        captured = [...context.permissions];
      },
    };

    const { kernel, root } = await compose(t, [], [plugin]);
    const registry = kernel.requestAccess<IExposedApiRegistry>(
      caller(root),
      ExposedApiRegistryToken,
    );

    assert.deepEqual(captured, ['photoshop:access']);
    assert.equal(registry.resolve(CORE_API_NAME.fileSystem, ['photoshop:access']), null);
  });
});
