import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStorageDriver } from '../../../drivers/memory/index.js';
import type { ServiceContext } from '../../../src/contracts/lifecycle.js';
import { BrudKernel } from '../../../src/engine/BrudKernel.js';
import { SettingsReaderToken, SettingsToken } from '../../SettingsService/descriptor/tokens.js';
import { createSettingsReaderDescriptor, createSettingsDescriptor } from '../../SettingsService/descriptor/descriptor.js';
import { InMemoryConfigStore } from '../../SettingsService/storage/InMemoryConfigStore.js';
import { WorkspaceService } from '../orchestrator/WorkspaceService.js';
import { createIdentityPathPort } from '../testing/MapPathPort.js';
import { WORKSPACE_SERVICE_TIER, createWorkspaceDescriptor } from './descriptor.js';
import { WorkspaceToken } from './tokens.js';

const WORKSPACE_ROOT = '/workspace';

function caller(overrides?: Partial<ServiceContext>): ServiceContext {
  return {
    callerId: 'test.workspace',
    tier: 'core',
    workspaceRoot: WORKSPACE_ROOT,
    ...overrides,
  };
}

function createKernel(): BrudKernel {
  const kernel = new BrudKernel();
  kernel.register(createSettingsDescriptor({ store: new InMemoryConfigStore() }));
  kernel.register(createSettingsReaderDescriptor());
  kernel.register(createWorkspaceDescriptor({ port: createIdentityPathPort() }));

  return kernel;
}

describe('createWorkspaceDescriptor', () => {
  it('describes a core service that depends on the settings reader', () => {
    const descriptor = createWorkspaceDescriptor();

    assert.equal(descriptor.token, WorkspaceToken);
    assert.equal(WorkspaceToken.id, 'brud.core.workspace');
    assert.equal(
      WorkspaceToken.description,
      'Canonical workspace identity and absolute/relative path translation service',
    );
    assert.equal(descriptor.tier, 'core');
    assert.equal(descriptor.tier, WORKSPACE_SERVICE_TIER);
    assert.deepEqual(
      descriptor.dependencies.map((token) => token.id),
      ['brud.core.settings.reader'],
    );
    assert.equal(descriptor.accessPolicy, undefined);
  });

  it('boots after settings and before the filesystem in the standard kernel', async () => {
    const { createStandardKernel } = await import('../../../src/bootstrap/index.js');
    const kernel = createStandardKernel({
      storageDriver: new InMemoryStorageDriver(),
      history: { inMemory: true },
      workspace: { port: createIdentityPathPort() },
    });

    await kernel.boot({ workspaceRoot: WORKSPACE_ROOT });

    try {
      const ids = kernel.listServices().map((service) => service.id);

      assert.ok(ids.indexOf('brud.core.settings') < ids.indexOf('brud.core.workspace'));
      assert.ok(ids.indexOf('brud.core.settings.reader') < ids.indexOf('brud.core.workspace'));
      assert.equal(kernel.hasService(WorkspaceToken), true);
      assert.equal(kernel.hasService(SettingsToken), true);
      assert.equal(kernel.hasService(SettingsReaderToken), true);
    } finally {
      await kernel.shutdown();
    }
  });

  it('builds a service over the boot workspace root', async () => {
    const kernel = createKernel();

    await kernel.boot({ workspaceRoot: '/workspace/' });

    try {
      const workspace = kernel.requestAccess(caller(), WorkspaceToken);

      assert.ok(workspace instanceof WorkspaceService);
      assert.deepEqual(workspace.roots, ['/workspace']);
      assert.equal(workspace.primaryRoot, '/workspace');
      assert.equal(workspace.isInitialized, true);
      assert.equal((await workspace.toKernelPath('/workspace/a.md')), 'a.md');
    } finally {
      await kernel.shutdown();
    }
  });

  it('is resolvable by userland callers without widening authority', async () => {
    const kernel = createKernel();

    await kernel.boot({ workspaceRoot: WORKSPACE_ROOT });

    try {
      const workspace = kernel.requestAccess(caller({ tier: 'userland', callerId: 'plugin.demo' }), WorkspaceToken);

      assert.equal(await workspace.contains('/workspace/a.md'), true);
      assert.equal(await workspace.contains('/workspace-evil/a.md'), false);
    } finally {
      await kernel.shutdown();
    }
  });

  it('honors a declared root registry and primary root', async () => {
    const kernel = new BrudKernel();
    kernel.register(createSettingsDescriptor({ store: new InMemoryConfigStore() }));
    kernel.register(createSettingsReaderDescriptor());
    kernel.register(createWorkspaceDescriptor({
      roots: ['/workspace/client', '/workspace/server'],
      port: createIdentityPathPort(),
    }));

    await kernel.boot({ workspaceRoot: '/workspace/server' });

    try {
      const workspace = kernel.requestAccess(caller({ workspaceRoot: '/workspace/server' }), WorkspaceToken);

      assert.deepEqual(workspace.roots, ['/workspace/client', '/workspace/server']);
      assert.equal(workspace.primaryRoot, '/workspace/server');
      assert.equal((await workspace.resolve('/workspace/client/a.md')).root, '/workspace/client');
    } finally {
      await kernel.shutdown();
    }
  });

  it('surfaces an invalid root registry as a boot failure', async () => {
    const kernel = new BrudKernel();
    kernel.register(createSettingsDescriptor({ store: new InMemoryConfigStore() }));
    kernel.register(createSettingsReaderDescriptor());
    kernel.register(createWorkspaceDescriptor({
      roots: ['relative/path'],
      port: createIdentityPathPort(),
    }));

    await assert.rejects(kernel.boot({ workspaceRoot: 'relative/path' }));
    assert.equal(kernel.lifecycleState, 'DISPOSED');
  });
});
