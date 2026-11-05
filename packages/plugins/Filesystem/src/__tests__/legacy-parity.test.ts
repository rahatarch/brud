/**
 * Legacy parity checks.
 *
 * The frozen legacy engine cannot be imported in a bare Node process (it
 * depends on the VS Code host), so parity is asserted against the legacy
 * registrations and branch messages documented in
 * `.internal_docs/audits/2026-11-05_phase_9_filesystem_discovery.md`, and the
 * pure match helpers are compared directly against
 * `packages/core/src/types/legacy.ts`.
 *
 * Intentional divergences:
 * - `create_file` on an existing target reports `CONFLICT` (legacy:
 *   `FILE_ALREADY_EXISTS`) and never overwrites the file.
 * - The envelope is plugin-native (`data.files` / `data.skipped` /
 *   `data.errors`) instead of legacy `operationResults` / `errors`.
 * - `create_directory` still overwrites listed files with empty content, as
 *   the legacy branch does; this is preserved, not hidden.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OperationResult } from '@brud/kernel';
import { NodeStorageDriver } from '../../../../kernel/drivers/node/index.js';
import {
  applySingleMatch as legacyApply,
  findSingleMatch as legacyFind,
  stripNumericLinePrefixes as legacyStrip,
} from '../../../../core/src/types/legacy.js';
import { appendFile } from '../groups/file/appendFile/index.js';
import { copyFile } from '../groups/file/copyFile/index.js';
import { createFile } from '../groups/file/createFile/index.js';
import { deleteFile } from '../groups/file/deleteFile/index.js';
import { moveFile } from '../groups/file/moveFile/index.js';
import { renameFile } from '../groups/file/renameFile/index.js';
import { createDirectory } from '../groups/directory/createDirectory/index.js';
import { deleteDirectory } from '../groups/directory/deleteDirectory/index.js';
import { moveDirectory } from '../groups/directory/moveDirectory/index.js';
import { appendFileMulti } from '../groups/multi/appendFileMulti/index.js';
import { searchReplace } from '../groups/multi/searchReplace/index.js';
import { searchReplaceMulti } from '../groups/multi/searchReplaceMulti/index.js';
import {
  applySingleMatch,
  findSingleMatch,
  stripNumericLinePrefixes,
} from '../match/index.js';
import type { FilesystemRuntime } from '../runtime.js';
import {
  bootTestKernel,
  createRuntime,
  errorCode,
  fakeSearch,
  mutationData,
} from './support/testHarness.js';
import type { TestKernel } from './support/testHarness.js';
import { acquireCrossTestLock, releaseCrossTestLock } from './support/serialLock.js';

let kernel: TestKernel;
let runtime: FilesystemRuntime;

before(async () => {
  await acquireCrossTestLock();
  kernel = await bootTestKernel({ prefix: 'brud-filesystem-parity-', storageDriver: new NodeStorageDriver() });
  runtime = createRuntime(kernel, fakeSearch(['p/a.txt']));
});

after(async () => {
  await kernel.shutdown();
  await releaseCrossTestLock();
});

function assertCommitted(result: OperationResult): void {
  // Assertions are intentionally synchronous; callers await the manifest.
  assert.ok(mutationData(result).sessionId);
}

describe('legacy parity', () => {
  it('matches the frozen pure match helpers', () => {
    const cases: Array<{ content: string; search: string; replace: string }> = [
      { content: 'alpha beta gamma', search: 'beta', replace: 'BETA' },
      { content: 'alpha beta', search: 'missing', replace: 'x' },
      { content: 'foo bar foo', search: 'foo', replace: 'bar' },
      { content: '1 | alpha\n2 | beta', search: '1 | alpha', replace: 'first' },
    ];

    for (const testCase of cases) {
      const legacy = legacyFind(testCase.content, testCase.search);
      const current = findSingleMatch(testCase.content, testCase.search);

      assert.equal(current.ok, legacy.ok);
      if (!current.ok && !legacy.ok) {
        assert.equal(current.code, legacy.error.code);
      }

      const legacyApplied = legacyApply(
        testCase.content,
        testCase.search,
        testCase.replace,
      );
      const currentApplied = applySingleMatch(
        testCase.content,
        testCase.search,
        testCase.replace,
      );

      assert.equal(currentApplied.ok, legacyApplied.ok);
      if (currentApplied.ok && legacyApplied.ok) {
        assert.equal(currentApplied.value.content, legacyApplied.value.content);
      }
    }

    for (const text of ['1 | a\n2 | b', '10 | x\n20 | y', 'no prefixes']) {
      assert.equal(stripNumericLinePrefixes(text), legacyStrip(text));
    }
  });

  it('matches the legacy success messages across all twelve tools', async () => {
    const created = await createFile({ path: 'p/a.txt', content: 'A' }, runtime);
    assert.equal(created.message, 'Created p/a.txt.');
    assertCommitted(created);

    const appended = await appendFile({ path: 'p/a.txt', content: 'B' }, runtime);
    assert.equal(appended.message, 'Appended content to p/a.txt.');

    const replaced = await searchReplace(
      { path: 'p/a.txt', search: 'A', replace: 'C' },
      runtime,
    );
    assert.equal(replaced.message, 'Patched p/a.txt.');

    const copied = await copyFile({ from: 'p/a.txt', to: 'p/b.txt' }, runtime);
    assert.equal(copied.message, 'Copied p/a.txt to p/b.txt.');

    const renamed = await renameFile(
      { from: 'p/b.txt', to: 'p/c.txt' },
      runtime,
    );
    assert.equal(renamed.message, 'Renamed p/b.txt to p/c.txt.');

    const moved = await moveFile(
      { from: 'p/c.txt', to: 'p/d.txt' },
      runtime,
    );
    assert.equal(moved.message, 'Moved p/c.txt to p/d.txt.');

    const directory = await createDirectory(
      { directoryPath: 'q', files: ['x.txt'] },
      runtime,
    );
    assert.equal(directory.message, 'Created directory q with 1 files.');

    const movedDirectory = await moveDirectory(
      { from: 'q', to: 'r' },
      runtime,
    );
    assert.equal(movedDirectory.message, 'Moved directory q to r.');

    const deletedFile = await deleteFile({ path: 'p/d.txt' }, runtime);
    assert.equal(deletedFile.message, 'Deleted p/d.txt.');

    const deletedDirectory = await deleteDirectory(
      { directoryPath: 'r' },
      runtime,
    );
    assert.equal(deletedDirectory.message, 'Deleted directory r and all its contents.');

    const appendedMulti = await appendFileMulti(
      { pattern: '**/*.txt', scope: 'p', content: 'Z' },
      runtime,
    );
    assert.equal(appendedMulti.message, 'Appended content to 1 files.');

    const replacedMulti = await searchReplaceMulti(
      { pattern: '**/*.txt', scope: 'p', search: 'Z', replace: 'W' },
      runtime,
    );
    assert.equal(replacedMulti.message, 'Patched 1 files.');
  });

  it('leaves the same final file state as the legacy branches', async () => {
    assert.equal(await kernel.fs.readText('p/a.txt'), 'C\n\nB\n\nW');
    assert.equal(await kernel.fs.exists('p/b.txt'), false);
    assert.equal(await kernel.fs.exists('p/c.txt'), false);
    assert.equal(await kernel.fs.exists('p/d.txt'), false);
    assert.equal(await kernel.fs.exists('q'), false);
    assert.equal(await kernel.fs.exists('r'), false);
  });

  it('creates a committed history entry for a legacy-shaped mutation', async () => {
    const result = await createFile({ path: 'history/entry.txt', content: 'x' }, runtime);
    const sessionId = mutationData(result).sessionId;

    assert.ok(sessionId);
    const session = await kernel.history.getSession(sessionId);

    assert.equal(session?.status, 'committed');
    assert.deepEqual(session?.filesAffected, ['history/entry.txt']);
  });

  it('documents the intentional create_file conflict divergence', async () => {
    const result = await createFile({ path: 'p/a.txt', content: 'overwritten?' }, runtime);

    assert.equal(errorCode(result), 'CONFLICT');
    assert.equal(await kernel.fs.readText('p/a.txt'), 'C\n\nB\n\nW');
  });
});