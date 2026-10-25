import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStorageDriver } from '../../drivers/memory/index.js';
import {
  SettingsReaderToken,
  SettingsToken,
} from '../../services/SettingsService/descriptor/tokens.js';
import { DEFAULT_SETTINGS } from '../../services/SettingsService/model/defaults.js';
import { ConfigStore } from '../../services/SettingsService/storage/ConfigStore.js';
import { InMemoryConfigStore } from '../../services/SettingsService/storage/InMemoryConfigStore.js';
import { createStandardKernel } from '../bootstrap/index.js';
import type { ServiceContext } from '../contracts/lifecycle.js';
import type { BrudKernel } from '../engine/BrudKernel.js';

const WORKSPACE_ROOT = '/workspace';

function caller(overrides?: Partial<ServiceContext>): ServiceContext {
  return {
    callerId: 'kernel',
    tier: 'kernel',
    workspaceRoot: WORKSPACE_ROOT,
    ...overrides,
  };
}

function createKernel(settingsStore: InMemoryConfigStore | ConfigStore): BrudKernel {
  return createStandardKernel({
    storageDriver: new InMemoryStorageDriver(),
    history: { inMemory: true },
    settings: { store: settingsStore },
  });
}

describe('createStandardKernel settings boot', () => {
  it('registers settings first and boots to RUNNING despite malformed and unreadable scopes', async () => {
    const store = new InMemoryConfigStore({
      userContent: '{ malformed',
      readErrorCodes: { workspace: 'EACCES' },
    });
    const kernel = createKernel(store);

    await kernel.boot({ workspaceRoot: WORKSPACE_ROOT });

    try {
      assert.equal(kernel.lifecycleState, 'RUNNING');
      assert.equal(kernel.listServices()[0]?.id, 'brud.core.settings');

      const settings = kernel.requestAccess(caller(), SettingsToken);

      assert.deepEqual(settings.getSnapshot(), DEFAULT_SETTINGS);
    } finally {
      await kernel.shutdown();
    }
  });

  it('boots when both settings directories are missing', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'brud-settings-boot-'));

    context.after(async () => {
      await rm(root, { recursive: true, force: true });
    });

    const store = new ConfigStore({
      workspaceRoot: join(root, 'workspace'),
      homeDirectory: join(root, 'home'),
    });
    const kernel = createKernel(store);

    await kernel.boot({ workspaceRoot: WORKSPACE_ROOT });

    try {
      assert.equal(kernel.lifecycleState, 'RUNNING');

      const settings = kernel.requestAccess(caller(), SettingsToken);
      assert.deepEqual(settings.getSnapshot(), DEFAULT_SETTINGS);

      const updated = await settings.update('user', { readConcurrency: 4 });

      assert.equal(updated.readConcurrency, 4);
      assert.notEqual((await store.readSnapshot('user')).content, null);
    } finally {
      await kernel.shutdown();
    }
  });

  it('exposes only the reader to userland through the standard kernel', async () => {
    const kernel = createKernel(new InMemoryConfigStore());

    await kernel.boot({ workspaceRoot: WORKSPACE_ROOT });

    try {
      const reader = kernel.requestAccess(
        caller({ callerId: 'brud.plugin.sample', tier: 'userland' }),
        SettingsReaderToken,
      );

      assert.equal(typeof reader.getSnapshot, 'function');
      assert.equal('update' in reader, false);
      assert.equal('reload' in reader, false);

      assert.throws(
        () => kernel.requestAccess(
          caller({ callerId: 'brud.plugin.sample', tier: 'userland' }),
          SettingsToken,
        ),
        (error: unknown) => error instanceof Error && error.name === 'AllowlistViolationError',
      );
    } finally {
      await kernel.shutdown();
    }
  });
});
