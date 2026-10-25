import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import type { ConfigScope } from '../contracts/ISettingsService.js';
import {
  SettingsConcurrencyError,
  SettingsLockTimeoutError,
  SettingsPathError,
  SettingsScopeError,
} from '../contracts/errors.js';
import { ConfigStore } from './ConfigStore.js';

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CONFIG_STORE_MODULE_URL = new URL('./ConfigStore.ts', import.meta.url).href;

/** Dead PID used to simulate an abandoned owner. */
const DEAD_PID = 2_147_483_647;

function transactWorkerSource(): string {
  return [
    `import { ConfigStore } from ${JSON.stringify(CONFIG_STORE_MODULE_URL)};`,
    'const store = new ConfigStore({',
    '  workspaceRoot: process.env.BRUD_SETTINGS_ROOT,',
    '  homeDirectory: process.env.BRUD_SETTINGS_HOME,',
    '  lockTimeoutMs: 60000,',
    '  lockRetryMs: 5,',
    '});',
    'const key = `tool_${process.env.BRUD_SETTINGS_INDEX}`;',
    "await store.transact('user', (current) => {",
    '  const document = current === null',
    '    ? { schemaVersion: 1, toolAllowList: {} }',
    '    : JSON.parse(current);',
    '  document.toolAllowList[key] = true;',
    '  return JSON.stringify(document);',
    '});',
  ].join('\n');
}

async function createWorkspace(context: { after: (callback: () => Promise<void>) => void }): Promise<{
  root: string;
  home: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'brud-settings-'));
  const home = join(root, 'home');

  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  return { root, home };
}

function stagingEntries(entries: readonly string[]): readonly string[] {
  return entries.filter((entry) => entry.endsWith('.tmp') || entry.endsWith('.lock'));
}

describe('ConfigStore', () => {
  it('resolves exactly two immutable scope paths', () => {
    const store = new ConfigStore({
      workspaceRoot: '/workspace',
      homeDirectory: '/home/tester',
    });

    assert.equal(store.getTargetPath('user'), join('/home/tester', '.brud', 'settings.json'));
    assert.equal(
      store.getTargetPath('workspace'),
      join('/workspace', '.brud', 'settings.json'),
    );
  });

  it('reports a null snapshot for a missing document', async (context) => {
    const { root, home } = await createWorkspace(context);
    const store = new ConfigStore({
      workspaceRoot: join(root, 'workspace'),
      homeDirectory: home,
    });

    assert.deepEqual(await store.readSnapshot('user'), { content: null, mtimeMs: 0 });
    assert.deepEqual(await store.readSnapshot('workspace'), { content: null, mtimeMs: 0 });
  });

  it('creates missing parent directories and cleans staging files', async (context) => {
    const { root, home } = await createWorkspace(context);
    const store = new ConfigStore({
      workspaceRoot: join(root, 'workspace'),
      homeDirectory: home,
    });

    const result = await store.transact('workspace', () => '{"schemaVersion":1}\n');

    assert.equal(result.writtenContent, '{"schemaVersion":1}\n');
    assert.ok(result.mtimeMs > 0);
    assert.deepEqual(await store.readSnapshot('workspace'), {
      content: '{"schemaVersion":1}\n',
      mtimeMs: result.mtimeMs,
    });
    assert.equal(existsSync(join(root, 'workspace', '.brud', 'settings.json')), true);

    assert.deepEqual(stagingEntries(await readdir(join(root, 'workspace', '.brud'))), []);
  });

  it('passes the on-disk document to the mutator', async (context) => {
    const { root, home } = await createWorkspace(context);
    const store = new ConfigStore({
      workspaceRoot: join(root, 'workspace'),
      homeDirectory: home,
    });

    const seen: (string | null)[] = [];
    await store.transact('user', (current) => {
      seen.push(current);
      return '{"schemaVersion":1}';
    });
    await store.transact('user', (current) => {
      seen.push(current);
      return '{"schemaVersion":1,"readConcurrency":4}';
    });

    assert.deepEqual(seen, [null, '{"schemaVersion":1}']);
  });

  it('refuses a transaction when the expected mtime is stale', async (context) => {
    const { root, home } = await createWorkspace(context);
    const store = new ConfigStore({
      workspaceRoot: join(root, 'workspace'),
      homeDirectory: home,
    });
    const first = await store.transact('user', () => '{"schemaVersion":1}');

    await assert.rejects(
      store.transact('user', () => '{"schemaVersion":2}', {
        expectedMtimeMs: first.mtimeMs - 1,
      }),
      (error: unknown) => error instanceof SettingsConcurrencyError
        && error.code === 'SETTINGS_CONCURRENCY_CONFLICT'
        && !error.message.includes(root),
    );

    assert.equal((await store.readSnapshot('user')).content, '{"schemaVersion":1}');
  });

  it('rejects relative and null-byte paths without leaking them', () => {
    assert.throws(
      () => new ConfigStore({ workspaceRoot: 'relative/workspace' }),
      (error: unknown) => error instanceof SettingsPathError
        && error.code === 'SETTINGS_INVALID_PATH'
        && !error.message.includes('relative/workspace'),
    );

    assert.throws(
      () => new ConfigStore({ workspaceRoot: '/work\0space' }),
      (error: unknown) => error instanceof SettingsPathError
        && !error.message.includes('/work'),
    );
  });

  it('resolves a symlinked parent directory through realpath', async (context) => {
    const { root, home } = await createWorkspace(context);
    const realWorkspace = join(root, 'real-workspace');
    const linkedWorkspace = join(root, 'linked-workspace');

    await mkdir(realWorkspace, { recursive: true });
    await symlink(realWorkspace, linkedWorkspace);

    const store = new ConfigStore({
      workspaceRoot: linkedWorkspace,
      homeDirectory: home,
    });

    await store.transact('workspace', () => '{"schemaVersion":1}');

    assert.equal(
      existsSync(join(realWorkspace, '.brud', 'settings.json')),
      true,
    );
  });

  it('rejects a dangling symlink parent with a scrubbed path error', async (context) => {
    const { root, home } = await createWorkspace(context);
    const linkedWorkspace = join(root, 'dangling-workspace');

    await symlink(join(root, 'missing-target'), linkedWorkspace);

    const store = new ConfigStore({
      workspaceRoot: linkedWorkspace,
      homeDirectory: home,
    });

    await assert.rejects(
      store.readSnapshot('workspace'),
      (error: unknown) => error instanceof SettingsPathError
        && error.code === 'SETTINGS_INVALID_PATH'
        && error.scope === 'workspace'
        && !error.message.includes(root),
    );

    await assert.rejects(
      store.transact('workspace', () => '{}'),
      (error: unknown) => error instanceof SettingsPathError,
    );
  });

  it('rejects unknown scopes at runtime', () => {
    const store = new ConfigStore({ workspaceRoot: '/workspace', homeDirectory: '/home' });
    const getTargetPath = store.getTargetPath.bind(store);

    assert.throws(
      () => getTargetPath('root' as ConfigScope),
      (error: unknown) => error instanceof SettingsScopeError,
    );
  });

  it('applies 40 concurrent read-modify-write transactions without lost updates', async (context) => {
    const { root, home } = await createWorkspace(context);
    const store = new ConfigStore({
      workspaceRoot: root,
      homeDirectory: home,
      lockTimeoutMs: 30_000,
      lockRetryMs: 2,
    });

    const results = await Promise.allSettled(
      Array.from({ length: 40 }, (_unused, index) => store.transact('user', (current) => {
        const document = current === null
          ? { schemaVersion: 1, toolAllowList: {} as Record<string, boolean> }
          : JSON.parse(current) as { schemaVersion: number; toolAllowList: Record<string, boolean> };

        document.toolAllowList[`tool_${index}`] = true;

        return JSON.stringify(document);
      })),
    );

    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    assert.deepEqual(failures.map((failure) => String(failure.reason)), []);

    const raw = (await store.readSnapshot('user')).content;
    assert.ok(raw !== null);
    const parsed = JSON.parse(raw) as { toolAllowList: Record<string, boolean> };

    assert.equal(Object.keys(parsed.toolAllowList).length, 40);

    for (let index = 0; index < 40; index += 1) {
      assert.equal(parsed.toolAllowList[`tool_${index}`], true);
    }

    assert.deepEqual(stagingEntries(await readdir(join(home, '.brud'))), []);
  });

  it(
    'applies 20 concurrent transactions from separate OS processes without lost updates',
    { timeout: 90_000 },
    async (context) => {
      const { root, home } = await createWorkspace(context);
      const workerSource = transactWorkerSource();

      await Promise.all(Array.from({ length: 20 }, async (_unused, index) => {
        await execFileAsync(
          process.execPath,
          ['--import', 'tsx', '--input-type=module', '-e', workerSource],
          {
            cwd: PACKAGE_ROOT,
            env: {
              ...process.env,
              BRUD_SETTINGS_ROOT: root,
              BRUD_SETTINGS_HOME: home,
              BRUD_SETTINGS_INDEX: String(index),
            },
          },
        );
      }));

      const raw = await readFile(join(home, '.brud', 'settings.json'), 'utf8');
      const parsed = JSON.parse(raw) as { toolAllowList: Record<string, boolean> };

      assert.equal(Object.keys(parsed.toolAllowList).length, 20);

      for (let index = 0; index < 20; index += 1) {
        assert.equal(parsed.toolAllowList[`tool_${index}`], true);
      }

      assert.deepEqual(stagingEntries(await readdir(join(home, '.brud'))), []);
    },
  );

  it('takes over a lock left behind by a dead process', async (context) => {
    const { root, home } = await createWorkspace(context);
    const store = new ConfigStore({
      workspaceRoot: root,
      homeDirectory: home,
      lockTimeoutMs: 2_000,
      lockRetryMs: 2,
    });
    const target = store.getTargetPath('workspace');
    const directory = join(root, '.brud');

    await mkdir(directory, { recursive: true });
    await writeFile(
      `${target}.lock`,
      JSON.stringify({ pid: DEAD_PID, createdAt: Date.now(), token: 'dead-owner' }),
      'utf8',
    );

    await store.transact('workspace', () => '{"schemaVersion":1}\n');

    assert.equal((await store.readSnapshot('workspace')).content, '{"schemaVersion":1}\n');
    assert.equal(existsSync(`${target}.lock`), false);
  });

  it('times out against a live lock with a scrubbed error', async (context) => {
    const { root, home } = await createWorkspace(context);
    const store = new ConfigStore({
      workspaceRoot: root,
      homeDirectory: home,
      lockTimeoutMs: 100,
      lockRetryMs: 2,
    });
    const target = store.getTargetPath('workspace');

    await mkdir(join(root, '.brud'), { recursive: true });
    await writeFile(
      `${target}.lock`,
      JSON.stringify({ pid: process.pid, createdAt: Date.now(), token: 'live-owner' }),
      'utf8',
    );

    await assert.rejects(
      store.transact('workspace', () => '{}'),
      (error: unknown) => error instanceof SettingsLockTimeoutError
        && error.code === 'SETTINGS_LOCK_TIMEOUT'
        && !error.message.includes(root),
    );
  });

  it('never exposes a partially written document to concurrent readers', async (context) => {
    const { root, home } = await createWorkspace(context);
    const store = new ConfigStore({
      workspaceRoot: root,
      homeDirectory: home,
      lockTimeoutMs: 30_000,
      lockRetryMs: 2,
    });

    const writers = Array.from({ length: 20 }, async (_unused, index) => {
      await store.transact('workspace', () => JSON.stringify({
        index,
        padding: 'x'.repeat(2048),
      }));
    });

    const readers = Array.from({ length: 10 }, async () => {
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const { content } = await store.readSnapshot('workspace');

        if (content !== null) {
          const parsed: unknown = JSON.parse(content);
          assert.ok(typeof parsed === 'object' && parsed !== null);
        }
      }
    });

    await Promise.all([...writers, ...readers]);

    const raw = await readFile(join(root, '.brud', 'settings.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    assert.ok(typeof parsed === 'object' && parsed !== null);
  });

  it('sweeps stale staging files from dead processes only', async (context) => {
    const { root, home } = await createWorkspace(context);
    const store = new ConfigStore({
      workspaceRoot: root,
      homeDirectory: home,
    });
    const directory = join(root, '.brud');

    await mkdir(directory, { recursive: true });

    const stale = join(directory, `settings.json.${DEAD_PID}.${Date.now() - 60_000}.deadbeef.tmp`);
    const fresh = join(directory, `settings.json.${DEAD_PID}.${Date.now()}.cafebabe.tmp`);
    const live = join(directory, `settings.json.${process.pid}.${Date.now() - 60_000}.feedface.tmp`);
    const unrelated = join(directory, 'notes.txt');

    await Promise.all([
      writeFile(stale, '{}', 'utf8'),
      writeFile(fresh, '{}', 'utf8'),
      writeFile(live, '{}', 'utf8'),
      writeFile(unrelated, 'keep', 'utf8'),
    ]);

    assert.equal(await store.sweepOrphanedTemps(), 1);

    assert.equal(existsSync(stale), false);
    assert.equal(existsSync(fresh), true);
    assert.equal(existsSync(live), true);
    assert.equal(existsSync(unrelated), true);
  });

  it('reports nothing to sweep when the settings directories are absent', async (context) => {
    const { root, home } = await createWorkspace(context);
    const store = new ConfigStore({
      workspaceRoot: join(root, 'workspace'),
      homeDirectory: home,
    });

    assert.equal(await store.sweepOrphanedTemps(), 0);
  });

  it('resolves both targets once and ignores later construction inputs', async (context) => {
    const { root, home } = await createWorkspace(context);
    const options = {
      workspaceRoot: root,
      homeDirectory: home,
    };
    const store = new ConfigStore(options);
    const userTarget = store.getTargetPath('user');
    const workspaceTarget = store.getTargetPath('workspace');

    options.workspaceRoot = join(root, 'other');
    options.homeDirectory = join(root, 'other-home');

    assert.equal(store.getTargetPath('user'), userTarget);
    assert.equal(store.getTargetPath('workspace'), workspaceTarget);
  });
});
