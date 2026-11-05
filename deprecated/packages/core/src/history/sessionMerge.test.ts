import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as pathModule from 'path';
import { createTwoFilesPatch } from 'diff';
import { NodeFileSystem } from '../testing/nodeFileSystem.js';
import { TestHistoryStore } from '../testing/testHistoryStore.js';
import { createTestWorkspace, cleanupTestWorkspace } from '../testing/testUtils.js';
import { executeFileOperations } from '../file-operations/index.js';
import { revertOperations } from './revert.js';

function makeDiff(oldStr: string, newStr: string): string {
  if (oldStr === newStr) return '';
  return createTwoFilesPatch('file', 'file', oldStr, newStr, 'pre', 'post');
}

describe('Session snapshot merge regression tests', () => {
  let tempDir: string;
  let nodeFs: NodeFileSystem;
  let store: TestHistoryStore;
  let workspaceFolders: string[];

  before(async () => {
    tempDir = await createTestWorkspace('brud-session-merge-');
    nodeFs = new NodeFileSystem();
    store = new TestHistoryStore(tempDir, nodeFs);
    workspaceFolders = [tempDir];
  });

  after(async () => {
    await cleanupTestWorkspace(tempDir);
  });

  async function cleanTempDir() {
    const entries = await fs.readdir(tempDir);
    for (const entry of entries) {
      if (entry === '.brud') continue;
      await fs.rm(pathModule.join(tempDir, entry), { recursive: true, force: true });
    }
  }

  function resolve(relPath: string): string {
    return pathModule.join(tempDir, relPath);
  }

  async function writeFile(relPath: string, content: string): Promise<void> {
    await nodeFs.writeFile(resolve(relPath), content);
  }

  async function readFile(relPath: string): Promise<string> {
    return nodeFs.readFile(resolve(relPath));
  }

  async function fileExists(relPath: string): Promise<boolean> {
    return nodeFs.exists(resolve(relPath));
  }

  // ─────────────────────────────────────────────────
  // Test 1: Patch A → Patch B → Cancel
  // Verify pre-snapshot preserves original content for both files
  // and post-snapshot has non-empty diffs for both.
  // ─────────────────────────────────────────────────
  it('Test 1: Patch A → Patch B → Cancel (verify pre and post snapshots)', async () => {
    await cleanTempDir();
    const sessionId = 'BR-20260911-001';
    const fileA = 'test1_fileA.txt';
    const fileB = 'test1_fileB.txt';

    await writeFile(fileA, 'originalA');
    await writeFile(fileB, 'originalB');

    // Execute 1: patch fileA
    const result1 = await executeFileOperations(
      [{ kind: 'search_replace', path: fileA, index: '0', search: 'originalA', replace: 'patchedA' }],
      nodeFs,
      workspaceFolders,
      store,
      'patch fileA',
      undefined,
      sessionId,
    );
    assert.strictEqual(result1.success, true);

    // Execute 2: patch fileB (same session ID)
    const result2 = await executeFileOperations(
      [{ kind: 'search_replace', path: fileB, index: '0', search: 'originalB', replace: 'patchedB' }],
      nodeFs,
      workspaceFolders,
      store,
      'patch fileB',
      undefined,
      sessionId,
    );
    assert.strictEqual(result2.success, true);

    // Read merged session from store
    const entry = await store.getSession(sessionId);
    assert.ok(entry, 'session should exist');

    const resolvedA = resolve(fileA);
    const resolvedB = resolve(fileB);

    // BUG 1 regression: pre-snapshot must preserve original content
    assert.ok(entry.preSnapshot.files.has(resolvedA), 'pre should have fileA');
    assert.strictEqual(entry.preSnapshot.files.get(resolvedA), 'originalA',
      'pre-snapshot fileA must be original content, not patched');

    assert.ok(entry.preSnapshot.files.has(resolvedB), 'pre should have fileB');
    assert.strictEqual(entry.preSnapshot.files.get(resolvedB), 'originalB',
      'pre-snapshot fileB must be original content');

    // BUG 2 regression: post-snapshot must have non-empty diffs
    assert.ok(entry.postSnapshot.files.has(resolvedA), 'post should have fileA diff');
    assert.notStrictEqual(entry.postSnapshot.files.get(resolvedA), '',
      'post-snapshot fileA diff must not be empty');

    assert.ok(entry.postSnapshot.files.has(resolvedB), 'post should have fileB diff');
    assert.notStrictEqual(entry.postSnapshot.files.get(resolvedB), '',
      'post-snapshot fileB diff must not be empty');
  });

  // ─────────────────────────────────────────────────
  // Test 2: Patch A → Patch B → Done
  // Verify both files patched on disk and session recorded correctly.
  // ─────────────────────────────────────────────────
  it('Test 2: Patch A → Patch B → Done (verify disk content and session)', async () => {
    await cleanTempDir();
    const sessionId = 'BR-20260911-002';
    const fileA = 'test2_fileA.txt';
    const fileB = 'test2_fileB.txt';

    await writeFile(fileA, 'originalA');
    await writeFile(fileB, 'originalB');

    const result1 = await executeFileOperations(
      [{ kind: 'search_replace', path: fileA, index: '0', search: 'originalA', replace: 'patchedA' }],
      nodeFs,
      workspaceFolders,
      store,
      'patch fileA',
      undefined,
      sessionId,
    );
    assert.strictEqual(result1.success, true);

    const result2 = await executeFileOperations(
      [{ kind: 'search_replace', path: fileB, index: '0', search: 'originalB', replace: 'patchedB' }],
      nodeFs,
      workspaceFolders,
      store,
      'patch fileB',
      undefined,
      sessionId,
    );
    assert.strictEqual(result2.success, true);

    // Verify disk content
    assert.strictEqual(await readFile(fileA), 'patchedA', 'fileA should be patched on disk');
    assert.strictEqual(await readFile(fileB), 'patchedB', 'fileB should be patched on disk');

    // Verify session has 2 operations
    const entry = await store.getSession(sessionId);
    assert.ok(entry);
    assert.strictEqual(entry.session.operations.length, 2, 'session should have 2 operations');

    // Verify post-snapshot has both diffs
    const resolvedA = resolve(fileA);
    const resolvedB = resolve(fileB);
    assert.strictEqual(entry.postSnapshot.files.size, 2, 'post-snapshot should have 2 diffs');
    assert.ok(entry.postSnapshot.files.has(resolvedA));
    assert.ok(entry.postSnapshot.files.has(resolvedB));
  });

  // ─────────────────────────────────────────────────
  // Test 3: Patch A → Patch A again → Cancel
  // Verify pre = v1, post = cumulative diff (v1 → v3).
  // ─────────────────────────────────────────────────
  it('Test 3: Patch A → Patch A again → Cancel (cumulative diff)', async () => {
    await cleanTempDir();
    const sessionId = 'BR-20260911-003';
    const fileA = 'test3_fileA.txt';

    await writeFile(fileA, 'v1 content');

    // Execute 1: v1 → v2
    const result1 = await executeFileOperations(
      [{ kind: 'search_replace', path: fileA, index: '0', search: 'v1 content', replace: 'v2 content' }],
      nodeFs,
      workspaceFolders,
      store,
      'patch fileA v1→v2',
      undefined,
      sessionId,
    );
    assert.strictEqual(result1.success, true);

    // Execute 2: v2 → v3
    const result2 = await executeFileOperations(
      [{ kind: 'search_replace', path: fileA, index: '0', search: 'v2 content', replace: 'v3 content' }],
      nodeFs,
      workspaceFolders,
      store,
      'patch fileA v2→v3',
      undefined,
      sessionId,
    );
    assert.strictEqual(result2.success, true);

    const entry = await store.getSession(sessionId);
    assert.ok(entry);

    const resolvedA = resolve(fileA);

    // BUG 1 regression: pre must be v1, not v3
    assert.strictEqual(entry.preSnapshot.files.get(resolvedA), 'v1 content',
      'pre-snapshot must be v1');

    // BUG 2 regression: post must be non-empty cumulative diff
    assert.ok(entry.postSnapshot.files.has(resolvedA), 'post should have fileA');
    const diffStr = entry.postSnapshot.files.get(resolvedA)!;
    assert.notStrictEqual(diffStr, '', 'diff must not be empty');
    assert.ok(diffStr.includes('v1 content'), 'diff should reference v1');
    assert.ok(diffStr.includes('v3 content'), 'diff should reference v3');
  });

  // ─────────────────────────────────────────────────
  // Test 4: Create A → Cancel
  // Verify pre-snapshot does not contain the created file,
  // and revert removes it.
  // ─────────────────────────────────────────────────
  it('Test 4: Create A → Cancel (file absent from pre, removed on revert)', async () => {
    await cleanTempDir();
    const sessionId = 'BR-20260911-004';
    const fileA = 'test4_newfile.txt';

    const result = await executeFileOperations(
      [{ kind: 'create_file', path: fileA, index: '0', content: 'new content' }],
      nodeFs,
      workspaceFolders,
      store,
      'create fileA',
      undefined,
      sessionId,
    );
    assert.strictEqual(result.success, true);

    const resolvedA = resolve(fileA);

    // File should exist on disk
    assert.strictEqual(await fileExists(fileA), true);

    const entry = await store.getSession(sessionId);
    assert.ok(entry);

    // Pre-snapshot should NOT have the created file
    assert.strictEqual(entry.preSnapshot.files.has(resolvedA), false,
      'pre-snapshot should not contain created file');

    // Revert to pre should delete the file
    const opIds = entry.session.operations.map(o => o.operationId);
    const revertResult = await revertOperations(sessionId, opIds, 'pre', store, nodeFs, workspaceFolders);
    assert.strictEqual(revertResult.success, true);

    assert.strictEqual(await fileExists(fileA), false,
      'file should be deleted after revert to pre');
  });

  // ─────────────────────────────────────────────────
  // Test 5: Delete A → Cancel
  // Verify pre-snapshot captures original content,
  // revert restores it.
  // ─────────────────────────────────────────────────
  it('Test 5: Delete A → Cancel (pre captures original, revert restores)', async () => {
    await cleanTempDir();
    const sessionId = 'BR-20260911-005';
    const fileA = 'test5_delete.txt';

    await writeFile(fileA, 'content to delete');

    const result = await executeFileOperations(
      [{ kind: 'delete_file', path: fileA, index: '0' }],
      nodeFs,
      workspaceFolders,
      store,
      'delete fileA',
      undefined,
      sessionId,
    );
    assert.strictEqual(result.success, true);

    // File should not exist on disk
    assert.strictEqual(await fileExists(fileA), false);

    const entry = await store.getSession(sessionId);
    assert.ok(entry);

    const resolvedA = resolve(fileA);

    // Pre-snapshot must have original content
    assert.ok(entry.preSnapshot.files.has(resolvedA));
    assert.strictEqual(entry.preSnapshot.files.get(resolvedA), 'content to delete');

    // Revert to pre should restore
    const opIds = entry.session.operations.map(o => o.operationId);
    const revertResult = await revertOperations(sessionId, opIds, 'pre', store, nodeFs, workspaceFolders);
    assert.strictEqual(revertResult.success, true);

    assert.strictEqual(await readFile(fileA), 'content to delete',
      'file should be restored after revert to pre');
  });

  // ─────────────────────────────────────────────────
  // Test 6: Create A → Patch A → Cancel
  // Verify revert removes file entirely.
  // ─────────────────────────────────────────────────
  it('Test 6: Create A → Patch A → Cancel (revert removes file entirely)', async () => {
    await cleanTempDir();
    const sessionId = 'BR-20260911-006';
    const fileA = 'test6_create_patch.txt';

    // Execute 1: create file
    const result1 = await executeFileOperations(
      [{ kind: 'create_file', path: fileA, index: '0', content: 'initial' }],
      nodeFs,
      workspaceFolders,
      store,
      'create fileA',
      undefined,
      sessionId,
    );
    assert.strictEqual(result1.success, true);

    // Execute 2: patch file (search_replace won't work on "initial" -> change to append)
    // Actually use search_replace on a file that was just created
    const result2 = await executeFileOperations(
      [{ kind: 'search_replace', path: fileA, index: '0', search: 'initial', replace: 'patched' }],
      nodeFs,
      workspaceFolders,
      store,
      'patch fileA',
      undefined,
      sessionId,
    );
    assert.strictEqual(result2.success, true);

    const entry = await store.getSession(sessionId);
    assert.ok(entry);

    const resolvedA = resolve(fileA);

    // Pre-snapshot should NOT have fileA (it was created during session)
    assert.strictEqual(entry.preSnapshot.files.has(resolvedA), false,
      'pre-snapshot should not have fileA since it was created mid-session');

    // Revert to pre should delete file
    const opIds = entry.session.operations.map(o => o.operationId);
    const revertResult = await revertOperations(sessionId, opIds, 'pre', store, nodeFs, workspaceFolders);
    assert.strictEqual(revertResult.success, true);

    assert.strictEqual(await fileExists(fileA), false,
      'file should not exist after revert to pre');
  });

  // ─────────────────────────────────────────────────
  // Test 7: Create A → Patch A → Done
  // Verify file exists with final patched content.
  // ─────────────────────────────────────────────────
  it('Test 7: Create A → Patch A → Done (file exists with final content)', async () => {
    await cleanTempDir();
    const sessionId = 'BR-20260911-007';
    const fileA = 'test7_create_patch_done.txt';

    const result1 = await executeFileOperations(
      [{ kind: 'create_file', path: fileA, index: '0', content: 'initial' }],
      nodeFs,
      workspaceFolders,
      store,
      'create fileA',
      undefined,
      sessionId,
    );
    assert.strictEqual(result1.success, true);

    const result2 = await executeFileOperations(
      [{ kind: 'search_replace', path: fileA, index: '0', search: 'initial', replace: 'final content' }],
      nodeFs,
      workspaceFolders,
      store,
      'patch fileA',
      undefined,
      sessionId,
    );
    assert.strictEqual(result2.success, true);

    // Verify file content on disk
    assert.strictEqual(await readFile(fileA), 'final content',
      'file should have final patched content');

    // Verify session has 2 operations
    const entry = await store.getSession(sessionId);
    assert.ok(entry);
    assert.strictEqual(entry.session.operations.length, 2, 'session should have 2 operations');
  });

  // ─────────────────────────────────────────────────
  // Test 8: Execute All vs Manual Completion (equivalence)
  // ─────────────────────────────────────────────────
  it('Test 8: Execute All vs Manual Completion (equivalent state)', async () => {
    await cleanTempDir();

    // Scenario A: Execute All on 3 files at once
    const sessionIdA = 'BR-20260911-008A';
    const fileA = 'test8_a.txt';
    const fileB = 'test8_b.txt';
    const fileC = 'test8_c.txt';

    await writeFile(fileA, 'aaa');
    await writeFile(fileB, 'bbb');
    await writeFile(fileC, 'ccc');

    const resultA = await executeFileOperations(
      [
        { kind: 'search_replace', path: fileA, index: '0', search: 'aaa', replace: 'AAA' },
        { kind: 'search_replace', path: fileB, index: '1', search: 'bbb', replace: 'BBB' },
        { kind: 'search_replace', path: fileC, index: '2', search: 'ccc', replace: 'CCC' },
      ],
      nodeFs,
      workspaceFolders,
      store,
      'execute all 3 files',
      undefined,
      sessionIdA,
    );
    assert.strictEqual(resultA.success, true);

    // Scenario B: Execute file1, then file2, then file3 (auto-complete)
    const sessionIdB = 'BR-20260911-008B';
    await writeFile(fileA, 'aaa');
    await writeFile(fileB, 'bbb');
    await writeFile(fileC, 'ccc');

    const resultB1 = await executeFileOperations(
      [{ kind: 'search_replace', path: fileA, index: '0', search: 'aaa', replace: 'AAA' }],
      nodeFs,
      workspaceFolders,
      store,
      'patch fileA',
      undefined,
      sessionIdB,
    );
    assert.strictEqual(resultB1.success, true);

    const resultB2 = await executeFileOperations(
      [{ kind: 'search_replace', path: fileB, index: '0', search: 'bbb', replace: 'BBB' }],
      nodeFs,
      workspaceFolders,
      store,
      'patch fileB',
      undefined,
      sessionIdB,
    );
    assert.strictEqual(resultB2.success, true);

    const resultB3 = await executeFileOperations(
      [{ kind: 'search_replace', path: fileC, index: '0', search: 'ccc', replace: 'CCC' }],
      nodeFs,
      workspaceFolders,
      store,
      'patch fileC',
      undefined,
      sessionIdB,
    );
    assert.strictEqual(resultB3.success, true);

    // Both scenarios should produce equivalent filesystem state
    assert.strictEqual(await readFile(fileA), 'AAA', 'fileA should be patched in both scenarios');
    assert.strictEqual(await readFile(fileB), 'BBB', 'fileB should be patched in both scenarios');
    assert.strictEqual(await readFile(fileC), 'CCC', 'fileC should be patched in both scenarios');
  });

  // ─────────────────────────────────────────────────
  // Test 9: Session ID reuse verification
  // ─────────────────────────────────────────────────
  it('Test 9: Session ID reuse verification (all three IDs identical)', async () => {
    await cleanTempDir();
    const sessionId = 'BR-20260911-009';
    const fileA = 'test9_fileA.txt';
    const fileB = 'test9_fileB.txt';

    await writeFile(fileA, 'originalA');
    await writeFile(fileB, 'originalB');

    // Execute 1
    const result1 = await executeFileOperations(
      [{ kind: 'search_replace', path: fileA, index: '0', search: 'originalA', replace: 'patchedA' }],
      nodeFs,
      workspaceFolders,
      store,
      'patch fileA',
      undefined,
      sessionId,
    );
    assert.strictEqual(result1.success, true);
    assert.strictEqual(result1.sessionId, sessionId, 'execution 1 must use expected session ID');

    // Execute 2
    const result2 = await executeFileOperations(
      [{ kind: 'search_replace', path: fileB, index: '0', search: 'originalB', replace: 'patchedB' }],
      nodeFs,
      workspaceFolders,
      store,
      'patch fileB',
      undefined,
      sessionId,
    );
    assert.strictEqual(result2.success, true);
    assert.strictEqual(result2.sessionId, sessionId, 'execution 2 must use expected session ID');

    // Read from store
    const entry = await store.getSession(sessionId);
    assert.ok(entry);

    // All three IDs must match
    assert.strictEqual(result1.sessionId, result2.sessionId, 'result session IDs must match');
    assert.strictEqual(result2.sessionId, entry.session.sessionId, 'store session ID must match');
  });

  // ─────────────────────────────────────────────────
  // Test 10: Same file patched twice, verify pre and post
  // ─────────────────────────────────────────────────
  it('Test 10: Same file patched twice, verify pre = v1, post = v1→v3', async () => {
    await cleanTempDir();
    const sessionId = 'BR-20260911-010';
    const fileA = 'test10_fileA.txt';

    await writeFile(fileA, 'v1');

    // Execute 1: v1 → v2
    const result1 = await executeFileOperations(
      [{ kind: 'search_replace', path: fileA, index: '0', search: 'v1', replace: 'v2' }],
      nodeFs,
      workspaceFolders,
      store,
      'patch v1→v2',
      undefined,
      sessionId,
    );
    assert.strictEqual(result1.success, true);

    // Execute 2: v2 → v3
    const result2 = await executeFileOperations(
      [{ kind: 'search_replace', path: fileA, index: '0', search: 'v2', replace: 'v3' }],
      nodeFs,
      workspaceFolders,
      store,
      'patch v2→v3',
      undefined,
      sessionId,
    );
    assert.strictEqual(result2.success, true);

    const entry = await store.getSession(sessionId);
    assert.ok(entry);

    const resolvedA = resolve(fileA);

    // Pre = v1
    assert.strictEqual(entry.preSnapshot.files.get(resolvedA), 'v1',
      'pre-snapshot must be v1');

    // Post = non-empty diff showing v1 → v3
    assert.ok(entry.postSnapshot.files.has(resolvedA));
    const diffStr = entry.postSnapshot.files.get(resolvedA)!;
    assert.notStrictEqual(diffStr, '', 'diff must not be empty');
    assert.ok(diffStr.includes('v1'), 'diff should reference v1');
    assert.ok(diffStr.includes('v3'), 'diff should reference v3');
  });

  // ─────────────────────────────────────────────────
  // Test 11: History reload between executions
  // ─────────────────────────────────────────────────
  it('Test 11: History reload between executions (pre survives store reload)', async () => {
    await cleanTempDir();
    const sessionId = 'BR-20260911-011';
    const fileA = 'test11_fileA.txt';
    const fileB = 'test11_fileB.txt';

    await writeFile(fileA, 'originalA');
    await writeFile(fileB, 'originalB');

    // Execute 1: patch fileA
    const result1 = await executeFileOperations(
      [{ kind: 'search_replace', path: fileA, index: '0', search: 'originalA', replace: 'patchedA' }],
      nodeFs,
      workspaceFolders,
      store,
      'patch fileA',
      undefined,
      sessionId,
    );
    assert.strictEqual(result1.success, true);

    // Simulate history reload: create a fresh store loading from same disk
    const store2 = new TestHistoryStore(tempDir, nodeFs);

    // Execute 2: patch fileB using the fresh store (same session ID)
    const result2 = await executeFileOperations(
      [{ kind: 'search_replace', path: fileB, index: '0', search: 'originalB', replace: 'patchedB' }],
      nodeFs,
      workspaceFolders,
      store2,
      'patch fileB',
      undefined,
      sessionId,
    );
    assert.strictEqual(result2.success, true);

    // Read from store2
    const entry = await store2.getSession(sessionId);
    assert.ok(entry);

    const resolvedA = resolve(fileA);
    const resolvedB = resolve(fileB);

    // BUG 1 regression: pre-snapshot must survive store reload
    assert.strictEqual(entry.preSnapshot.files.get(resolvedA), 'originalA',
      'pre-snapshot fileA must be original after store reload');
    assert.strictEqual(entry.preSnapshot.files.get(resolvedB), 'originalB',
      'pre-snapshot fileB must be original after store reload');
  });

  // ─────────────────────────────────────────────────
  // Test 12: Mixed operations cancel (create, patch, delete)
  // ─────────────────────────────────────────────────
  it('Test 12: Mixed operations cancel (create, patch, delete)', async () => {
    await cleanTempDir();
    const sessionId = 'BR-20260911-012';
    const fileA = 'test12_create.txt';
    const fileB = 'test12_patch.txt';
    const fileC = 'test12_delete.txt';

    // Set up pre-existing files
    await writeFile(fileB, 'originalB');
    await writeFile(fileC, 'originalC');

    // Execute 1: create fileA, patch fileB, delete fileC (all in one batch)
    const result = await executeFileOperations(
      [
        { kind: 'create_file', path: fileA, index: '0', content: 'new content' },
        { kind: 'search_replace', path: fileB, index: '1', search: 'originalB', replace: 'patchedB' },
        { kind: 'delete_file', path: fileC, index: '2' },
      ],
      nodeFs,
      workspaceFolders,
      store,
      'mixed operations',
      undefined,
      sessionId,
    );
    assert.strictEqual(result.success, true);

    // Verify session
    const entry = await store.getSession(sessionId);
    assert.ok(entry);
    assert.strictEqual(entry.session.operations.length, 3);

    // Revert to pre
    const opIds = entry.session.operations.map(o => o.operationId);
    const revertResult = await revertOperations(sessionId, opIds, 'pre', store, nodeFs, workspaceFolders);
    assert.strictEqual(revertResult.success, true);

    // Verify exact pre-session state restored
    assert.strictEqual(await fileExists(fileA), false, 'created fileA should not exist');
    assert.strictEqual(await readFile(fileB), 'originalB', 'patched fileB should be restored');
    assert.strictEqual(await readFile(fileC), 'originalC', 'deleted fileC should be restored');
  });

  // ─────────────────────────────────────────────────
  // Test 13: No-op merge (single execution)
  // Verify pre and post are correct without merge.
  // ─────────────────────────────────────────────────
  it('Test 13: No-op merge (single execution, pre and post correct)', async () => {
    await cleanTempDir();
    const sessionId = 'BR-20260911-013';
    const fileA = 'test13_fileA.txt';

    await writeFile(fileA, 'original');

    const result = await executeFileOperations(
      [{ kind: 'search_replace', path: fileA, index: '0', search: 'original', replace: 'patched' }],
      nodeFs,
      workspaceFolders,
      store,
      'patch fileA',
      undefined,
      sessionId,
    );
    assert.strictEqual(result.success, true);

    const entry = await store.getSession(sessionId);
    assert.ok(entry);

    const resolvedA = resolve(fileA);

    // Pre-snapshot has original content
    assert.strictEqual(entry.preSnapshot.files.get(resolvedA), 'original',
      'pre must be original content');

    // Post-snapshot has non-empty diff
    assert.ok(entry.postSnapshot.files.has(resolvedA));
    const diffStr = entry.postSnapshot.files.get(resolvedA)!;
    assert.notStrictEqual(diffStr, '', 'post diff must not be empty');

    // No existing session data to merge — pre/post should have exactly one entry each
    assert.strictEqual(entry.preSnapshot.files.size, 1, 'pre should have 1 file');
    assert.strictEqual(entry.postSnapshot.files.size, 1, 'post should have 1 file');
  });
});