import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import { NodeFileSystem } from '../testing/nodeFileSystem';
import { createTestWorkspace, cleanupTestWorkspace } from '../testing/testUtils';
import { executeFileOperations } from './index';
import type { FileOperation } from '../types/patch';

/**
 * A10 protected-path coverage for the legacy execution surface.
 *
 * The kernel filesystem denies `.brud/settings.json`, `.brud/history/**` and
 * `.git/**` for file mutations, but `create_directory` and `delete_directory`
 * execute through the legacy `FileSystem` interface, which has no denylist
 * check of its own (Phase 3 audit §5.4). The execution gate is the layer that
 * knows the operation kind, so these cases pin the closure.
 */
describe('A10 protected paths across directory kinds', () => {
  let tempDir: string;
  let fs: NodeFileSystem;

  before(async () => {
    tempDir = await createTestWorkspace('brud-a10-kinds-');
    fs = new NodeFileSystem();
  });

  after(async () => {
    await cleanupTestWorkspace(tempDir);
  });

  const protectedTargets = ['.git', '.brud/history', '.brud/settings.json'];

  for (const target of protectedTargets) {
    it(`denies create_directory on "${target}"`, async () => {
      const operations: FileOperation[] = [
        { kind: 'create_directory', directoryPath: path.join(tempDir, target), files: [], index: '1' },
      ];

      const result = await executeFileOperations(operations, fs, [tempDir]);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.errors[0]?.code, 'VALIDATION_ERROR');
      assert.match(result.errors[0]?.details ?? '', /protected-path denylist/);
    });

    it(`denies delete_directory on "${target}"`, async () => {
      const operations: FileOperation[] = [
        { kind: 'delete_directory', directoryPath: path.join(tempDir, target), index: '1' },
      ];

      const result = await executeFileOperations(operations, fs, [tempDir]);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.errors[0]?.code, 'VALIDATION_ERROR');
    });

    it(`denies create_file on "${target}/x"`, async () => {
      const operations: FileOperation[] = [
        { kind: 'create_file', path: path.join(tempDir, target, 'x.txt'), content: 'x', index: '1' },
      ];

      const result = await executeFileOperations(operations, fs, [tempDir]);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.errors[0]?.code, 'VALIDATION_ERROR');
    });
  }

  it('denies per-file targets under a create_directory', async () => {
    const operations: FileOperation[] = [
      {
        kind: 'create_directory',
        directoryPath: tempDir,
        files: ['.git/config'],
        index: '1',
      },
    ];

    const result = await executeFileOperations(operations, fs, [tempDir]);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errors[0]?.code, 'VALIDATION_ERROR');
  });

  it('allows ordinary directories', async () => {
    const operations: FileOperation[] = [
      { kind: 'create_directory', directoryPath: path.join(tempDir, 'ordinary'), files: [], index: '1' },
    ];

    const result = await executeFileOperations(operations, fs, [tempDir]);

    assert.strictEqual(result.success, true);
    assert.strictEqual(await fs.exists(path.join(tempDir, 'ordinary')), true);
  });
});
