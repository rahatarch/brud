import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  PluginRolloutMode,
  SettingsSnapshot,
} from '../contracts/ISettingsService.js';
import {
  SettingsIOError,
  SettingsParseError,
  SettingsScopeError,
} from '../contracts/errors.js';
import { DEFAULT_SETTINGS } from '../model/defaults.js';
import { ConfigStore } from '../storage/ConfigStore.js';
import { InMemoryConfigStore } from '../storage/InMemoryConfigStore.js';
import { SettingsService } from './SettingsService.js';

function asMutableToolAllowList(snapshot: SettingsSnapshot): Record<string, boolean> {
  return snapshot.toolAllowList as unknown as Record<string, boolean>;
}

function asMutablePlugins(snapshot: SettingsSnapshot): Record<string, PluginRolloutMode> {
  return snapshot.plugins as unknown as Record<string, PluginRolloutMode>;
}

async function createService(
  store: InMemoryConfigStore = new InMemoryConfigStore(),
): Promise<SettingsService> {
  const service = new SettingsService({ store });
  await service.initialize();
  return service;
}

describe('SettingsService', () => {
  it('publishes defaults when both scopes are missing', async () => {
    const service = await createService();

    assert.deepEqual(service.getSnapshot(), DEFAULT_SETTINGS);
    assert.deepEqual(service.getWarnings(), []);
  });

  it('never throws on malformed documents and leaves them untouched', async () => {
    const userDocument = '{ this is not json';
    const store = new InMemoryConfigStore({
      userContent: userDocument,
      workspaceContent: 'null',
    });
    const service = await createService(store);

    assert.deepEqual(service.getSnapshot(), DEFAULT_SETTINGS);
    assert.equal(store.getRaw('user'), userDocument);

    const codes = service.getWarnings().map((warning) => warning.code);
    assert.equal(codes.includes('MALFORMED_DOCUMENT'), true);
    assert.equal(codes.includes('INVALID_FIELD'), true);
  });

  it('falls back to defaults on simulated EACCES without throwing', async () => {
    const store = new InMemoryConfigStore({
      readErrorCodes: { user: 'EACCES', workspace: 'EACCES' },
    });
    const service = await createService(store);

    assert.deepEqual(service.getSnapshot(), DEFAULT_SETTINGS);

    const readWarnings = service.getWarnings().filter((warning) => warning.code === 'READ_FAILED');
    assert.equal(readWarnings.length, 2);
    assert.equal(readWarnings.some((warning) => warning.scope === 'user'), true);
    assert.equal(readWarnings.some((warning) => warning.scope === 'workspace'), true);

    for (const warning of service.getWarnings()) {
      assert.doesNotMatch(warning.message, /\/home\/|\/workspace\//u);
    }
  });

  it('keeps the boot snapshot deeply immutable', async () => {
    const store = new InMemoryConfigStore({
      userContent: JSON.stringify({
        toolAllowList: { any: true },
        plugins: { 'brud.search': 'shadow' },
        readConcurrency: 8,
      }),
    });
    const service = await createService(store);
    const snapshot = service.getSnapshot();

    assert.equal(snapshot.toolAllowList.any, true);
    assert.equal(snapshot.plugins['brud.search'], 'shadow');

    assert.throws(() => {
      asMutableToolAllowList(snapshot).any = false;
    }, TypeError);

    assert.throws(() => {
      asMutablePlugins(snapshot)['brud.search'] = 'active';
    }, TypeError);

    assert.throws(() => {
      const mutable = snapshot as unknown as { readConcurrency: number };
      mutable.readConcurrency = 1;
    }, TypeError);
  });

  it('ignores workspace attempts to disable a safety policy and warns', async () => {
    const store = new InMemoryConfigStore({
      workspaceContent: JSON.stringify({ workspaceBoundaryEnabled: false }),
    });
    const service = await createService(store);

    assert.equal(service.getSnapshot().workspaceBoundaryEnabled, true);

    const warning = service.getWarnings().find(
      (entry) => entry.code === 'SAFETY_LOOSENING_IGNORED',
    );

    assert.ok(warning !== undefined);
    assert.equal(warning.field, 'workspaceBoundaryEnabled');
    assert.match(warning.message, /ignored/u);
    assert.doesNotMatch(warning.message, /\/workspace\//u);
  });

  it('lets the user scope disable a safety policy', async () => {
    const service = await createService();

    const snapshot = await service.update('user', { workspaceBoundaryEnabled: false });

    assert.equal(snapshot.workspaceBoundaryEnabled, false);
    assert.equal(service.getWarnings().length, 0);
  });

  it('filters unsafe workspace updates before writing them', async () => {
    const store = new InMemoryConfigStore({ workspaceContent: '{}' });
    const service = await createService(store);

    const snapshot = await service.update('workspace', {
      workspaceBoundaryEnabled: false,
      commandValidationEnabled: false,
      readConcurrency: 999,
    });

    assert.equal(snapshot.workspaceBoundaryEnabled, true);
    assert.equal(snapshot.commandValidationEnabled, true);
    assert.equal(snapshot.readConcurrency, 32);

    const warnings = service.getWarnings();
    assert.equal(
      warnings.filter((warning) => warning.code === 'SAFETY_LOOSENING_IGNORED').length,
      2,
    );
    assert.equal(
      warnings.filter((warning) => warning.code === 'VALUE_CLAMPED').length,
      1,
    );

    const raw = store.getRaw('workspace');
    assert.ok(raw !== null);
    const document: unknown = JSON.parse(raw);
    assert.ok(typeof document === 'object' && document !== null);

    assert.equal('workspaceBoundaryEnabled' in document, false);
    assert.equal('commandValidationEnabled' in document, false);
    assert.equal((document as Record<string, unknown>).readConcurrency, 32);
  });

  it('preserves unknown keys when updating a document', async () => {
    const store = new InMemoryConfigStore({
      userContent: JSON.stringify({ futureKey: 'kept', toolAllowList: { create_file: false } }),
    });
    const service = await createService(store);

    await service.update('user', { readConcurrency: 4 });

    const raw = store.getRaw('user');
    assert.ok(raw !== null);
    const document = JSON.parse(raw) as Record<string, unknown>;

    assert.equal(document.futureKey, 'kept');
    assert.equal(document.readConcurrency, 4);
    assert.deepEqual(document.toolAllowList, { create_file: false });
  });

  it('refuses to overwrite a malformed document', async () => {
    const malformed = '{ broken';
    const store = new InMemoryConfigStore({ userContent: malformed });
    const service = await createService(store);

    await assert.rejects(
      service.update('user', { readConcurrency: 4 }),
      (error: unknown) => error instanceof SettingsParseError
        && error.code === 'SETTINGS_PARSE_FAILED',
    );

    assert.equal(store.getRaw('user'), malformed);
  });

  it('rejects unsupported scopes at runtime', async () => {
    const service = await createService();

    await assert.rejects(
      service.update('root' as never, { readConcurrency: 4 }),
      (error: unknown) => error instanceof SettingsScopeError,
    );
  });

  it('keeps the previous snapshot when an update write fails', async () => {
    const store = new InMemoryConfigStore();
    const service = await createService(store);
    const previous = service.getSnapshot();

    store.setWriteError('user', 'EACCES');

    await assert.rejects(
      service.update('user', { readConcurrency: 4 }),
      (error: unknown) => error instanceof SettingsIOError && error.syscallCode === 'EACCES',
    );

    assert.equal(service.getSnapshot(), previous);
    assert.equal(store.getRaw('user'), null);
  });

  it('publishes reloaded snapshots and notifies listeners', async () => {
    const store = new InMemoryConfigStore({
      userContent: JSON.stringify({ readConcurrency: 4 }),
    });
    const service = await createService(store);
    const published: SettingsSnapshot[] = [];
    const unsubscribe = service.onChange((snapshot) => {
      published.push(snapshot);
    });

    store.setRaw('user', JSON.stringify({ readConcurrency: 8 }));
    const snapshot = await service.reload();

    assert.equal(snapshot.readConcurrency, 8);
    assert.equal(published.length, 1);
    assert.equal(published[0]?.readConcurrency, 8);

    unsubscribe();
    store.setRaw('user', JSON.stringify({ readConcurrency: 12 }));
    await service.reload();

    assert.equal(published.length, 1);
  });

  it('retains the previous snapshot when a reload read fails', async () => {
    const store = new InMemoryConfigStore({
      userContent: JSON.stringify({ readConcurrency: 4 }),
    });
    const service = await createService(store);
    const previous = service.getSnapshot();
    const published: SettingsSnapshot[] = [];
    service.onChange((snapshot) => {
      published.push(snapshot);
    });

    store.setReadError('user', 'EACCES');
    const snapshot = await service.reload();

    assert.equal(snapshot, previous);
    assert.equal(published.length, 0);
    assert.equal(
      service.getWarnings().some((warning) => warning.code === 'READ_FAILED'),
      true,
    );
  });

  it('ignores a malformed document on reload but still publishes', async () => {
    const store = new InMemoryConfigStore({
      userContent: JSON.stringify({ readConcurrency: 4 }),
    });
    const service = await createService(store);

    store.setRaw('user', '{ malformed');
    const snapshot = await service.reload();

    assert.equal(snapshot.readConcurrency, DEFAULT_SETTINGS.readConcurrency);
    assert.equal(
      service.getWarnings().some((warning) => warning.code === 'MALFORMED_DOCUMENT'),
      true,
    );
  });

  it('pins the boot safety policy against a mid-session user-scope tamper', async () => {
    const store = new InMemoryConfigStore({
      userContent: JSON.stringify({ workspaceBoundaryEnabled: true }),
    });
    const service = await createService(store);

    store.setRaw('user', JSON.stringify({ workspaceBoundaryEnabled: false }));
    const snapshot = await service.reload();

    assert.equal(snapshot.workspaceBoundaryEnabled, true);
    assert.equal(Object.isFrozen(snapshot), true);

    const warning = service.getWarnings().find(
      (entry) => entry.field === 'workspaceBoundaryEnabled',
    );

    assert.ok(warning !== undefined);
    assert.match(warning.message, /MID_SESSION_SAFETY_LOOSENING_REJECTED:workspaceBoundaryEnabled/u);
  });

  it('pins both safety policies against a mid-session workspace-scope tamper', async () => {
    const store = new InMemoryConfigStore({
      workspaceContent: JSON.stringify({}),
    });
    const service = await createService(store);

    store.setRaw('workspace', JSON.stringify({
      workspaceBoundaryEnabled: false,
      commandValidationEnabled: false,
    }));
    const snapshot = await service.reload();

    assert.equal(snapshot.workspaceBoundaryEnabled, true);
    assert.equal(snapshot.commandValidationEnabled, true);

    const codes = service.getWarnings().map((warning) => warning.code);

    assert.equal(codes.includes('SAFETY_LOOSENING_IGNORED'), true);
  });

  it('allows a reload to tighten a safety policy the user relaxed at boot', async () => {
    const store = new InMemoryConfigStore({
      userContent: JSON.stringify({ workspaceBoundaryEnabled: false }),
    });
    const service = await createService(store);

    assert.equal(service.getSnapshot().workspaceBoundaryEnabled, false);

    store.setRaw('user', JSON.stringify({ workspaceBoundaryEnabled: true }));
    const snapshot = await service.reload();

    assert.equal(snapshot.workspaceBoundaryEnabled, true);
  });

  it('keeps the user rollout of off when the workspace attempts an escalation', async () => {
    const store = new InMemoryConfigStore({
      userContent: JSON.stringify({ plugins: { 'brud.terminal': 'off' } }),
      workspaceContent: JSON.stringify({}),
    });
    const service = await createService(store);

    const snapshot = await service.update('workspace', {
      plugins: { 'brud.terminal': 'active' },
    });

    assert.equal(snapshot.plugins['brud.terminal'], 'off');

    const warning = service.getWarnings().find(
      (entry) => entry.code === 'SAFETY_LOOSENING_IGNORED',
    );

    assert.ok(warning !== undefined);
    assert.equal(warning.field, 'plugins.brud.terminal');
    assert.match(warning.message, /SAFETY_LOOSENING_IGNORED/u);

    const raw = store.getRaw('workspace');
    assert.ok(raw !== null);
    const document = JSON.parse(raw) as Record<string, unknown>;

    assert.equal('plugins' in document, false);
  });

  it('sweeps orphaned staging files during initialize', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'brud-settings-init-'));

    context.after(async () => {
      await rm(root, { recursive: true, force: true });
    });

    const home = join(root, 'home');
    const directory = join(home, '.brud');
    const stale = join(directory, `settings.json.2147483647.${Date.now() - 60_000}.0badf00d.tmp`);

    await mkdir(directory, { recursive: true });
    await writeFile(stale, '{}', 'utf8');

    const service = new SettingsService({
      store: new ConfigStore({ workspaceRoot: join(root, 'workspace'), homeDirectory: home }),
    });

    await service.initialize();

    assert.equal(existsSync(stale), false);
    assert.deepEqual(service.getSnapshot(), DEFAULT_SETTINGS);
  });
});
