import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ConfigScope } from '../contracts/ISettingsService.js';
import {
  SettingsConcurrencyError,
  SettingsIOError,
  SettingsScopeError,
} from '../contracts/errors.js';
import { InMemoryConfigStore } from './InMemoryConfigStore.js';

describe('InMemoryConfigStore', () => {
  it('stores documents per scope', async () => {
    const store = new InMemoryConfigStore({
      userContent: '{"scope":"user"}',
      workspaceContent: '{"scope":"workspace"}',
    });

    assert.deepEqual(await store.readSnapshot('user'), {
      content: '{"scope":"user"}',
      mtimeMs: 1,
    });
    assert.deepEqual(await store.readSnapshot('workspace'), {
      content: '{"scope":"workspace"}',
      mtimeMs: 1,
    });

    const result = await store.transact('user', () => '{"scope":"updated"}');

    assert.equal(result.writtenContent, '{"scope":"updated"}');
    assert.equal(store.getRaw('user'), '{"scope":"updated"}');
    assert.equal(result.mtimeMs, 2);
  });

  it('passes the current disk content to the mutator', async () => {
    const store = new InMemoryConfigStore({ userContent: '{"a":1}' });
    const seen: (string | null)[] = [];

    await store.transact('user', (current) => {
      seen.push(current);
      return '{"a":2}';
    });

    assert.deepEqual(seen, ['{"a":1}']);
  });

  it('refuses a transaction whose expected mtime is stale', async () => {
    const store = new InMemoryConfigStore({ userContent: '{"a":1}' });

    await assert.rejects(
      store.transact('user', () => '{"a":2}', { expectedMtimeMs: 999 }),
      (error: unknown) => error instanceof SettingsConcurrencyError
        && error.code === 'SETTINGS_CONCURRENCY_CONFLICT'
        && error.expectedMtimeMs === 999
        && error.actualMtimeMs === 1,
    );

    assert.equal(store.getRaw('user'), '{"a":1}');
  });

  it('returns deterministic diagnostic paths', () => {
    const store = new InMemoryConfigStore();

    assert.equal(store.getTargetPath('user'), '/home/brud/.brud/settings.json');
    assert.equal(store.getTargetPath('workspace'), '/workspace/.brud/settings.json');
  });

  it('reports no orphaned staging files', async () => {
    const store = new InMemoryConfigStore();

    assert.equal(await store.sweepOrphanedTemps(), 0);
  });

  it('injects read and write faults', async () => {
    const store = new InMemoryConfigStore({
      readErrorCodes: { user: 'EACCES' },
      writeErrorCodes: { workspace: 'EROFS' },
    });

    await assert.rejects(
      store.readSnapshot('user'),
      (error: unknown) => error instanceof SettingsIOError && error.syscallCode === 'EACCES',
    );

    await assert.rejects(
      store.transact('workspace', () => '{}'),
      (error: unknown) => error instanceof SettingsIOError && error.syscallCode === 'EROFS',
    );

    store.setReadError('user', null);
    assert.deepEqual(await store.readSnapshot('user'), { content: null, mtimeMs: 0 });
  });

  it('rejects unknown scopes at runtime', async () => {
    const store = new InMemoryConfigStore();

    await assert.rejects(
      store.readSnapshot('root' as ConfigScope),
      (error: unknown) => error instanceof SettingsScopeError,
    );
  });
});
