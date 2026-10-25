import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CONFIG_STORE_MODULE_URL = new URL('../storage/ConfigStore.ts', import.meta.url).href;
const SETTINGS_SERVICE_MODULE_URL = new URL('./SettingsService.ts', import.meta.url).href;

const WORKER_COUNT = 20;

function updateWorkerSource(): string {
  return [
    `import { ConfigStore } from ${JSON.stringify(CONFIG_STORE_MODULE_URL)};`,
    `import { SettingsService } from ${JSON.stringify(SETTINGS_SERVICE_MODULE_URL)};`,
    'const service = new SettingsService({',
    '  store: new ConfigStore({',
    '    workspaceRoot: process.env.BRUD_SETTINGS_ROOT,',
    '    homeDirectory: process.env.BRUD_SETTINGS_HOME,',
    '    lockTimeoutMs: 60000,',
    '    lockRetryMs: 5,',
    '  }),',
    '});',
    'await service.initialize();',
    'const toolName = `tool_${process.env.BRUD_SETTINGS_INDEX}`;',
    "await service.update('user', { toolAllowList: { [toolName]: true } });",
    'service.dispose();',
  ].join('\n');
}

describe('SettingsService concurrent updates', () => {
  it(
    'persists every key from 20 concurrent processes with zero lost updates',
    { timeout: 120_000 },
    async (context) => {
      const root = await mkdtemp(join(tmpdir(), 'brud-settings-update-'));
      const home = join(root, 'home');

      context.after(async () => {
        await rm(root, { recursive: true, force: true });
      });

      const workerSource = updateWorkerSource();

      await Promise.all(Array.from({ length: WORKER_COUNT }, async (_unused, index) => {
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
      const document = JSON.parse(raw) as { toolAllowList: Record<string, boolean> };
      const persisted = Object.keys(document.toolAllowList);

      assert.equal(persisted.length, WORKER_COUNT, `persisted keys: ${persisted.join(',')}`);

      for (let index = 0; index < WORKER_COUNT; index += 1) {
        assert.equal(document.toolAllowList[`tool_${index}`], true);
      }

      const entries = await readdir(join(home, '.brud'));
      assert.deepEqual(
        entries.filter((entry) => entry.endsWith('.tmp') || entry.endsWith('.lock')),
        [],
      );
    },
  );
});
