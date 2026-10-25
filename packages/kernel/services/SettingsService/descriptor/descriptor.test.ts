import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ServiceContext } from '../../../src/contracts/lifecycle.js';
import { AccessDeniedError } from '../../../src/contracts/policy.js';
import { BrudKernel } from '../../../src/engine/BrudKernel.js';
import { DEFAULT_SETTINGS } from '../model/defaults.js';
import { InMemoryConfigStore } from '../storage/InMemoryConfigStore.js';
import {
  SETTINGS_MUTATOR_CALLERS,
  createSettingsDescriptor,
  createSettingsReaderDescriptor,
} from './descriptor.js';
import { SettingsReaderToken, SettingsToken } from './tokens.js';

function caller(overrides: Partial<ServiceContext>): ServiceContext {
  return {
    callerId: 'test.settings',
    tier: 'core',
    workspaceRoot: '/workspace',
    ...overrides,
  };
}

function createKernel(): BrudKernel {
  const kernel = new BrudKernel();
  kernel.register(createSettingsDescriptor({ store: new InMemoryConfigStore() }));
  kernel.register(createSettingsReaderDescriptor());
  return kernel;
}

describe('createSettingsDescriptor', () => {
  it('describes a core service with no dependencies', () => {
    const descriptor = createSettingsDescriptor();

    assert.equal(descriptor.token, SettingsToken);
    assert.equal(SettingsToken.id, 'brud.core.settings');
    assert.equal(SettingsToken.description, 'Immutable kernel settings and policy snapshot service');
    assert.equal(descriptor.tier, 'core');
    assert.deepEqual(descriptor.dependencies, []);
  });

  it('restricts the mutating token to the kernel and trusted hosts', () => {
    const descriptor = createSettingsDescriptor();

    assert.deepEqual(descriptor.accessPolicy?.allowedCallers, SETTINGS_MUTATOR_CALLERS);
    assert.deepEqual(descriptor.accessPolicy?.allowedCallers, [
      'kernel',
      'brud.host.daemon',
      'brud.host.desktop',
    ]);
  });

  it('rejects a caller outside the access policy with AccessDeniedError', async () => {
    const kernel = createKernel();

    await kernel.boot({ workspaceRoot: '/workspace' });

    try {
      assert.throws(
        () => kernel.requestAccess(
          caller({ callerId: 'untrusted.plugin', tier: 'core' }),
          SettingsToken,
        ),
        (error: unknown) => error instanceof AccessDeniedError
          && error.code === 'NOT_IN_ALLOWLIST'
          && error.callerId === 'untrusted.plugin'
          && error.targetServiceId === 'brud.core.settings',
      );
    } finally {
      await kernel.shutdown();
    }
  });

  it('keeps the mutating service for allowlisted kernel and host callers', async () => {
    const kernel = createKernel();

    await kernel.boot({ workspaceRoot: '/workspace' });

    try {
      for (const callerId of SETTINGS_MUTATOR_CALLERS) {
        const host = kernel.requestAccess(caller({ callerId, tier: 'kernel' }), SettingsToken);

        assert.equal(typeof host.update, 'function');
        assert.equal(typeof host.reload, 'function');
      }
    } finally {
      await kernel.shutdown();
    }
  });

  it('lets userland resolve the reader token without mutators', async () => {
    const kernel = createKernel();

    await kernel.boot({ workspaceRoot: '/workspace' });

    try {
      const reader = kernel.requestAccess(
        caller({ callerId: 'brud.plugin.userland', tier: 'userland' }),
        SettingsReaderToken,
      );

      assert.equal(typeof reader.getSnapshot, 'function');
      assert.equal(typeof reader.onChange, 'function');
      assert.equal('update' in reader, false);
      assert.equal('reload' in reader, false);
    } finally {
      await kernel.shutdown();
    }
  });
});

describe('createSettingsReaderDescriptor', () => {
  it('is a core-tier dependency of the settings service with no access policy', () => {
    const descriptor = createSettingsReaderDescriptor();

    assert.equal(descriptor.token, SettingsReaderToken);
    assert.equal(SettingsReaderToken.id, 'brud.core.settings.reader');
    assert.equal(descriptor.tier, 'core');
    assert.deepEqual(descriptor.dependencies, [SettingsToken]);
    assert.equal(descriptor.accessPolicy, undefined);
  });

  it('serves the same frozen snapshot as the mutating service', async () => {
    const kernel = createKernel();

    await kernel.boot({ workspaceRoot: '/workspace' });

    try {
      const settings = kernel.requestAccess(caller({ callerId: 'kernel', tier: 'kernel' }), SettingsToken);
      const reader = kernel.requestAccess(
        caller({ callerId: 'untrusted.plugin', tier: 'userland' }),
        SettingsReaderToken,
      );

      assert.deepEqual(reader.getSnapshot(), DEFAULT_SETTINGS);
      assert.deepEqual(reader.getSnapshot(), settings.getSnapshot());

      let notifications = 0;
      const unsubscribe = reader.onChange(() => {
        notifications += 1;
      });

      await settings.update('user', { readConcurrency: 4 });

      assert.equal(notifications, 1);
      assert.equal(reader.getSnapshot().readConcurrency, 4);

      unsubscribe();
    } finally {
      await kernel.shutdown();
    }
  });

  it('keeps the settings service first in the standard boot order', async () => {
    const kernel = createKernel();

    await kernel.boot({ workspaceRoot: '/workspace' });

    try {
      assert.equal(kernel.listServices()[0]?.id, 'brud.core.settings');
    } finally {
      await kernel.shutdown();
    }
  });
});
