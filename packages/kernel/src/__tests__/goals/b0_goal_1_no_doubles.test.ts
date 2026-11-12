import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  DEFERRED_DAEMON_TESTS,
  GOALS_DIR,
  KERNEL_ROOT,
  REPO_ROOT,
  liveOccurrences,
  repoRelative,
  stripComments,
  walkSourceFiles,
} from './_support.js';

const DOUBLES = ['InMemoryStorageDriver', 'MapPathPort'] as const;

const DELETED_PATHS = [
  'packages/kernel/drivers/memory/InMemoryStorageDriver/InMemoryStorageDriver.ts',
  'packages/kernel/drivers/memory/InMemoryStorageDriver/InMemoryStorageDriver.test.ts',
  'packages/kernel/drivers/memory/index.ts',
  'packages/services/WorkspaceService/testing/MapPathPort.ts',
] as const;

const DEFERRED_DAEMON_SET = new Set(DEFERRED_DAEMON_TESTS);

describe('B0 Goal 1 — no substitution double for the filesystem layer', () => {
  it('deletes both double implementations and their barrel', () => {
    for (const relativePath of DELETED_PATHS) {
      assert.equal(
        existsSync(join(REPO_ROOT, relativePath)),
        false,
        `${relativePath} must not exist`,
      );
    }
  });

  it('fails to resolve any module that would import the deleted doubles', () => {
    const require = createRequire(import.meta.url);

    for (const relativePath of DELETED_PATHS) {
      assert.throws(
        () => require.resolve(join(REPO_ROOT, relativePath)),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /MODULE_NOT_FOUND|Cannot find module/u);
          return true;
        },
        `${relativePath} must not be resolvable`,
      );
    }
  });

  it('does not expose either double from the kernel source entry point', async () => {
    const entry = join(KERNEL_ROOT, 'index.ts');
    const module: Record<string, unknown> = await import(pathToFileURL(entry).href);

    for (const name of [...DOUBLES, 'StorageError']) {
      assert.equal(name in module, false, `${name} must not be a kernel export`);
    }
  });

  it('fails a static named import of either double from the kernel entry point', () => {
    const entryUrl = pathToFileURL(join(KERNEL_ROOT, 'index.ts')).href;

    for (const name of DOUBLES) {
      const script = `import { ${name} } from '${entryUrl}'; void ${name};`;
      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '--eval', script],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      );

      assert.notEqual(
        result.status,
        0,
        `importing ${name} from the kernel entry point must fail; stdout=${result.stdout} stderr=${result.stderr}`,
      );
      assert.match(
        `${result.stdout}${result.stderr}`,
        /does not provide an export|not found|SyntaxError/u,
        `unexpected failure for ${name}: ${result.stderr}`,
      );
    }
  });

  it('has no live reference to either double outside the deferred daemon tests', async () => {
    for (const daemonPath of DEFERRED_DAEMON_TESTS) {
      assert.equal(
        existsSync(join(REPO_ROOT, daemonPath)),
        true,
        `${daemonPath} must exist as a deferred daemon test`,
      );
    }

    const files = await walkSourceFiles(REPO_ROOT, {
      skipPaths: [join(REPO_ROOT, 'deprecated'), GOALS_DIR],
    });

    const violations: string[] = [];

    for (const file of files) {
      const relativePath = repoRelative(file);
      const source = stripComments(await readFile(file, 'utf8'));

      for (const name of DOUBLES) {
        const count = source.split(name).length - 1;

        if (count === 0) {
          continue;
        }

        // The only tolerated double references are the two daemon test files
        // recorded as Phase 10 deferrals, and only for the driver name. The
        // path fake is tolerated nowhere.
        if (name === 'InMemoryStorageDriver' && DEFERRED_DAEMON_SET.has(relativePath)) {
          continue;
        }

        violations.push(`${relativePath} references ${name} (${count})`);
      }
    }

    assert.deepEqual(violations, [], `live references remain:\n${violations.join('\n')}`);
  });

  it('confines deferred double references to the daemon tests recorded as Phase 10 deferrals', async () => {
    for (const relativePath of DEFERRED_DAEMON_TESTS) {
      assert.equal(
        DEFERRED_DAEMON_SET.has(relativePath),
        true,
        `${relativePath} must be listed in DEFERRED_DAEMON_TESTS`,
      );
      assert.equal(
        existsSync(join(REPO_ROOT, relativePath)),
        true,
        `${relativePath} must exist as a deferred daemon test`,
      );
    }

    const daemonTests = (await walkSourceFiles(join(REPO_ROOT, 'packages/daemon/src/__tests__')))
      .filter((file) => file.endsWith('.test.ts'));

    for (const file of daemonTests) {
      const relativePath = repoRelative(file);

      if (DEFERRED_DAEMON_SET.has(relativePath)) {
        continue;
      }

      assert.equal(
        liveOccurrences(await readFile(file, 'utf8'), 'InMemoryStorageDriver'),
        0,
        `${relativePath} is not a recorded deferral and must not reference the deleted driver`,
      );
    }
  });

  it('does not export either name from any kernel source barrel', async () => {
    const files = await walkSourceFiles(join(KERNEL_ROOT, 'src'));
    const driverFiles = await walkSourceFiles(join(KERNEL_ROOT, 'drivers'));
    const violations: string[] = [];

    for (const file of [...files, ...driverFiles]) {
      const source = await readFile(file, 'utf8');

      for (const name of DOUBLES) {
        if (new RegExp(`\\bexport\\b[^\\n]*\\b${name}\\b`, 'u').test(source)) {
          violations.push(`${repoRelative(file)} exports ${name}`);
        }
      }
    }

    assert.deepEqual(violations, []);
  });

  it('has no definition of either double anywhere outside the frozen core', async () => {
    const files = await walkSourceFiles(REPO_ROOT, {
      skipPaths: [join(REPO_ROOT, 'deprecated'), GOALS_DIR],
    });
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');

      for (const name of DOUBLES) {
        if (new RegExp(`\\bclass\\s+${name}\\b`, 'u').test(source)) {
          violations.push(`${repoRelative(file)} defines class ${name}`);
        }
      }
    }

    assert.deepEqual(violations, []);
  });
});