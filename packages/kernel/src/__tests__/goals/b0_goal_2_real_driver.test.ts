import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  KERNEL_ROOT,
  REPO_ROOT,
  stripComments,
  walkSourceFiles,
} from './_support.js';

/**
 * The 33 kernel test files the B0 execution artifact records as rewritten.
 *
 * Keep this list in lockstep with Section 4 of the artifact. The first test in
 * this file fails if the artifact no longer names a file.
 */
const REWRITTEN_TESTS: readonly string[] = [
  'packages/services/BrudFileSystem/descriptor/descriptor.test.ts',
  'packages/services/BrudFileSystem/operations/create_file/createFile.test.ts',
  'packages/services/BrudFileSystem/operations/delete_file/deleteFile.test.ts',
  'packages/services/BrudFileSystem/operations/read_directory/readDirectory.test.ts',
  'packages/services/BrudFileSystem/operations/read_file/readFile.test.ts',
  'packages/services/BrudFileSystem/operations/stat_path/statPath.test.ts',
  'packages/services/BrudFileSystem/operations/write_atomic/writeAtomic.test.ts',
  'packages/services/BrudFileSystem/orchestrator/BrudFileSystem.test.ts',
  'packages/services/BrudFileSystem/projection/ScopedPartitionFacade/ScopedPartitionFacade.test.ts',
  'packages/services/BrudFileSystem/__tests__/bootstrapIntegration.test.ts',
  'packages/services/BrudFileSystem/__tests__/journalAtomicity.test.ts',
  'packages/services/BrudFileSystem/__tests__/mutationEvents.test.ts',
  'packages/services/BrudFileSystem/__tests__/protectedPaths.test.ts',
  'packages/services/BrudFileSystem/__tests__/rootAndMetadata.test.ts',
  'packages/services/BrudFileSystem/__tests__/scopedDriver.test.ts',
  'packages/services/BrudFileSystem/__tests__/stagingSecurity.test.ts',
  'packages/services/BrudFileSystem/__tests__/workspaceContainment.test.ts',
  'packages/services/BrudTools/__tests__/descriptor.test.ts',
  'packages/services/PluginManager/descriptor/PluginManagerDescriptor.test.ts',
  'packages/services/TerminalService/__tests__/descriptor.test.ts',
  'packages/services/UniversalHistory/unified/__tests__/unifiedCarryOver.test.ts',
  'packages/services/UniversalHistory/unified/__tests__/unifiedEngine.test.ts',
  'packages/services/UniversalHistory/unified/__tests__/unifiedRetention.test.ts',
  'packages/services/UniversalHistory/unified/__tests__/unifiedService.test.ts',
  'packages/services/UniversalHistory/unified/__tests__/unifiedStore.test.ts',
  'packages/services/ValidationService/__tests__/validationService.test.ts',
  'packages/services/WorkspaceService/descriptor/descriptor.test.ts',
  'packages/services/WorkspaceService/model/canonicalization.test.ts',
  'packages/services/WorkspaceService/orchestrator/WorkspaceService.test.ts',
  'packages/services/WorkspaceService/orchestrator/WorkspaceService.remediation.test.ts',
  'packages/kernel/src/__tests__/bootstrap.test.ts',
  'packages/kernel/src/__tests__/bootstrapSettings.test.ts',
  'packages/kernel/src/__tests__/bootstrapPlugins.test.ts',
];

const CATEGORIES: Readonly<Record<string, { readonly keyword: RegExp; readonly file: string }>> = {
  containment: {
    keyword: /containment|escape|symlink/iu,
    file: 'packages/services/BrudFileSystem/__tests__/workspaceContainment.test.ts',
  },
  concurrency: {
    keyword: /concurr|race|simultaneous|parallel|serializ/iu,
    file: 'packages/services/BrudFileSystem/orchestrator/BrudFileSystem.test.ts',
  },
  durability: {
    keyword: /fsync|durab|syncFile|syncDirectory|flush/iu,
    file: 'packages/services/BrudFileSystem/__tests__/journalAtomicity.test.ts',
  },
  staging: {
    keyword: /staging|O_EXCL|EEXIST|sweep/iu,
    file: 'packages/services/BrudFileSystem/__tests__/stagingSecurity.test.ts',
  },
  symlinks: {
    keyword: /symlink|dangling|escape/iu,
    file: 'packages/services/BrudFileSystem/__tests__/stagingSecurity.test.ts',
  },
};

function runTestFile(relativePath: string): { readonly status: number | null; readonly output: string } {
  const absolutePath = join(REPO_ROOT, relativePath);
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--test', absolutePath],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 180_000,
    },
  );
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
    .trim()
    .split('\n')
    .slice(-40)
    .join('\n');

  return { status: result.status, output };
}

describe('B0 Goal 2 — every rewritten filesystem test exercises the real driver', () => {
  it('lists exactly 33 rewritten test files that all exist and use a real driver', async () => {
    assert.equal(REWRITTEN_TESTS.length, 33);

    for (const relativePath of REWRITTEN_TESTS) {
      const source = await readFile(join(REPO_ROOT, relativePath), 'utf8');
      const code = stripComments(source);

      assert.match(source, /mkdtemp/u, `${relativePath} must allocate a real temporary directory`);
      assert.match(
        code,
        /(?:DurableNodeStorageDriver|NodeStorageDriver|createStandardKernel)/u,
        `${relativePath} must construct a real driver or the standard kernel's durable default`,
      );
    }
  });

  it('uses the durable driver as the standard-kernel default', async () => {
    const source = await readFile(
      join(REPO_ROOT, 'packages/services/BrudFileSystem/serviceModule.ts'),
      'utf8',
    );

    assert.match(source, /new DurableNodeStorageDriver\(\)/u);
  });

  for (const relativePath of REWRITTEN_TESTS) {
    it(`runs ${relativePath} on a real filesystem`, async () => {
      const source = await readFile(join(REPO_ROOT, relativePath), 'utf8');
      const code = stripComments(source);

      for (const name of ['InMemoryStorageDriver', 'MapPathPort']) {
        assert.equal(
          code.includes(name),
          false,
          `${relativePath} must not use ${name}`,
        );
      }

      assert.match(source, /mkdtemp/u, `${relativePath} must allocate a real temporary directory`);
      assert.match(
        code,
        /(?:DurableNodeStorageDriver|NodeStorageDriver|createStandardKernel)/u,
        `${relativePath} must construct a real driver or the standard kernel's durable default`,
      );

      const { status, output } = runTestFile(relativePath);
      assert.equal(status, 0, `${relativePath} failed:\n${output}`);
    });
  }

  for (const [category, specification] of Object.entries(CATEGORIES)) {
    it(`covers ${category} with a passing real-driver test`, async () => {
      const testFiles = (
        await walkSourceFiles(join(REPO_ROOT, 'packages/services/BrudFileSystem'))
      ).filter((file) => file.endsWith('.test.ts'));

      const matching: string[] = [];

      for (const file of testFiles) {
        if (specification.keyword.test(await readFile(file, 'utf8'))) {
          matching.push(file);
        }
      }

      assert.ok(
        matching.length > 0,
        `no BrudFileSystem test file exercises ${category}`,
      );
      assert.ok(
        REWRITTEN_TESTS.includes(specification.file),
        `${category} representative must be one of the rewritten files`,
      );

      const { status, output } = runTestFile(specification.file);
      assert.equal(status, 0, `${category} representative failed:\n${output}`);
    });
  }
});