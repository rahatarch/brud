import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as pathModule from 'path';
import { createTwoFilesPatch } from 'diff';
import { NodeFileSystem } from '../testing/nodeFileSystem.js';
import { TestHistoryStore } from '../testing/testHistoryStore.js';
import type { HistoryEntry, OperationResult, RevertHistoryEntry, SnapshotData } from './types.js';
import { revertOperations } from './revert.js';

function makeOp(overrides: Partial<OperationResult> & { kind: string }): OperationResult {
  return {
    operationId: `op-${overrides.kind}-${Date.now()}-${Math.random()}`,
    operationIndex: 0,
    status: 'success',
    message: '',
    path: '',
    ...overrides,
  };
}

function makeSnapshot(
  files: Record<string, string>,
  snapshotType: 'pre' | 'post' = 'pre',
): SnapshotData {
  return {
    sessionId: 'test-session',
    snapshotType,
    files: new Map(Object.entries(files)),
    diffFromPrevious: '',
  };
}

function makeEntry(
  operations: OperationResult[],
  preSnapshot: SnapshotData,
  postSnapshot: SnapshotData,
  sessionId = 'test-session',
): HistoryEntry {
  return {
    session: {
      sessionId,
      timestamp: new Date().toISOString(),
      originalPrompt: 'test',
      status: 'success',
      operationCount: operations.length,
      operationTypes: operations.map(o => o.kind),
      operations,
      filesAffected: [],
      metadataUsed: {},
      terminalCommands: [],
      revertCommands: [],
    },
    preSnapshot,
    postSnapshot,
  };
}

function makeDiff(oldStr: string, newStr: string): string {
  if (oldStr === newStr) return '';
  return createTwoFilesPatch('file', 'file', oldStr, newStr, 'pre', 'post');
}

describe('revertOperations', () => {
  let tempDir: string;
  let nodeFs: NodeFileSystem;
  let store: TestHistoryStore;
  let workspaceFolders: string[];
  let revertEntries: RevertHistoryEntry[] = [];

  before(async () => {
    tempDir = await fs.mkdtemp('/tmp/brud-revert-test-');
    nodeFs = new NodeFileSystem();
    store = new TestHistoryStore(tempDir, nodeFs);
    workspaceFolders = [tempDir];
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function onRevertComplete(entry: RevertHistoryEntry): void {
    revertEntries.push(entry);
  }

  async function cleanTempDir(): Promise<void> {
    const entries = await fs.readdir(tempDir);
    for (const entry of entries) {
      await fs.rm(pathModule.join(tempDir, entry), { recursive: true, force: true });
    }
    revertEntries = [];
  }

  // ── CREATE_FILE ──

  it('CREATE_FILE revert to pre: file should be deleted', async () => {
    await cleanTempDir();
    const filePath = pathModule.join(tempDir, 'newfile.txt');
    const op = makeOp({ kind: 'create_file', path: filePath, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({}),
      makeSnapshot({ [filePath]: makeDiff('', 'hello world') }, 'post'),
    );
    await store.saveSession(entry);
    await nodeFs.writeFile(filePath, 'hello world');

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, nodeFs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(await nodeFs.exists(filePath), false);
    assert.strictEqual(revertEntries.length, 1);
    assert.strictEqual(revertEntries[0].targetState, 'pre');
  });

  it('CREATE_FILE revert to post: file should be restored with content', async () => {
    await cleanTempDir();
    const filePath = pathModule.join(tempDir, 'newfile.txt');
    const op = makeOp({ kind: 'create_file', path: filePath, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({}),
      makeSnapshot({ [filePath]: makeDiff('', 'hello world') }, 'post'),
    );
    await store.saveSession(entry);

    const result = await revertOperations('test-session', [op.operationId], 'post', store, nodeFs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(await nodeFs.readFile(filePath), 'hello world');
    assert.strictEqual(revertEntries.length, 1);
    assert.strictEqual(revertEntries[0].targetState, 'post');
  });

  // ── DELETE_FILE ──

  it('DELETE_FILE revert to pre: file should be restored', async () => {
    await cleanTempDir();
    const filePath = pathModule.join(tempDir, 'oldfile.txt');
    const op = makeOp({ kind: 'delete_file', path: filePath, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({ [filePath]: 'content to restore' }),
      makeSnapshot({ [filePath]: makeDiff('content to restore', '') }, 'post'),
    );
    await store.saveSession(entry);

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, nodeFs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(await nodeFs.readFile(filePath), 'content to restore');
    assert.strictEqual(revertEntries.length, 1);
  });

  it('DELETE_FILE revert to post: file should stay deleted', async () => {
    await cleanTempDir();
    const filePath = pathModule.join(tempDir, 'oldfile.txt');
    const op = makeOp({ kind: 'delete_file', path: filePath, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({ [filePath]: 'content to restore' }),
      makeSnapshot({ [filePath]: makeDiff('content to restore', '') }, 'post'),
    );
    await store.saveSession(entry);

    const result = await revertOperations('test-session', [op.operationId], 'post', store, nodeFs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(await nodeFs.exists(filePath), false);
    assert.strictEqual(revertEntries.length, 1);
  });

  // ── SEARCH_REPLACE ──

  it('SEARCH_REPLACE revert to pre: original content restored', async () => {
    await cleanTempDir();
    const filePath = pathModule.join(tempDir, 'search.txt');
    const op = makeOp({ kind: 'search_replace', path: filePath, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({ [filePath]: 'original content' }),
      makeSnapshot({ [filePath]: makeDiff('original content', 'new content') }, 'post'),
    );
    await store.saveSession(entry);
    await nodeFs.writeFile(filePath, 'new content');

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, nodeFs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(await nodeFs.readFile(filePath), 'original content');
    assert.strictEqual(revertEntries.length, 1);
  });

  it('SEARCH_REPLACE revert to post: new content restored', async () => {
    await cleanTempDir();
    const filePath = pathModule.join(tempDir, 'search.txt');
    const op = makeOp({ kind: 'search_replace', path: filePath, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({ [filePath]: 'original content' }),
      makeSnapshot({ [filePath]: makeDiff('original content', 'new content') }, 'post'),
    );
    await store.saveSession(entry);
    await nodeFs.writeFile(filePath, 'original content');

    const result = await revertOperations('test-session', [op.operationId], 'post', store, nodeFs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(await nodeFs.readFile(filePath), 'new content');
    assert.strictEqual(revertEntries.length, 1);
  });

  // ── APPEND_FILE ──

  it('APPEND_FILE revert to pre: appended content removed', async () => {
    await cleanTempDir();
    const filePath = pathModule.join(tempDir, 'append.txt');
    const op = makeOp({ kind: 'append_file', path: filePath, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({ [filePath]: 'base\ntext' }),
      makeSnapshot({ [filePath]: makeDiff('base\ntext', 'base\ntext\nappended') }, 'post'),
    );
    await store.saveSession(entry);
    await nodeFs.writeFile(filePath, 'base\ntext\nappended');

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, nodeFs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(await nodeFs.readFile(filePath), 'base\ntext');
    assert.strictEqual(revertEntries.length, 1);
  });

  it('APPEND_FILE revert to pre: file was created during session, should be deleted', async () => {
    await cleanTempDir();
    const filePath = pathModule.join(tempDir, 'created-and-appended.txt');
    const op = makeOp({ kind: 'append_file', path: filePath, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({}),
      makeSnapshot({ [filePath]: makeDiff('', 'appended content') }, 'post'),
    );
    await store.saveSession(entry);
    await nodeFs.writeFile(filePath, 'appended content');

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, nodeFs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(await nodeFs.exists(filePath), false, 'file should be deleted when reverting to pre');
    assert.strictEqual(revertEntries.length, 1);
  });

  it('APPEND_FILE revert to post: appended content kept', async () => {
    await cleanTempDir();
    const filePath = pathModule.join(tempDir, 'append.txt');
    const op = makeOp({ kind: 'append_file', path: filePath, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({ [filePath]: 'base\ntext' }),
      makeSnapshot({ [filePath]: makeDiff('base\ntext', 'base\ntext\nappended') }, 'post'),
    );
    await store.saveSession(entry);
    await nodeFs.writeFile(filePath, 'base\ntext');

    const result = await revertOperations('test-session', [op.operationId], 'post', store, nodeFs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(await nodeFs.readFile(filePath), 'base\ntext\nappended');
    assert.strictEqual(revertEntries.length, 1);
  });

  // ── RENAME_FILE ──

  it('RENAME_FILE revert to pre: file renamed back', async () => {
    await cleanTempDir();
    const from = pathModule.join(tempDir, 'oldName.txt');
    const to = pathModule.join(tempDir, 'newName.txt');
    const op = makeOp({ kind: 'rename_file', from, to, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({}),
      makeSnapshot({}, 'post'),
    );
    await store.saveSession(entry);
    await nodeFs.writeFile(to, 'file content');

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, nodeFs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(await nodeFs.exists(to), false);
    assert.strictEqual(await nodeFs.readFile(from), 'file content');
    assert.strictEqual(revertEntries.length, 1);
  });

  it('RENAME_FILE revert to post: file keeps new name', async () => {
    await cleanTempDir();
    const from = pathModule.join(tempDir, 'oldName.txt');
    const to = pathModule.join(tempDir, 'newName.txt');
    const op = makeOp({ kind: 'rename_file', from, to, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({}),
      makeSnapshot({}, 'post'),
    );
    await store.saveSession(entry);
    await nodeFs.writeFile(from, 'file content');

    const result = await revertOperations('test-session', [op.operationId], 'post', store, nodeFs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(await nodeFs.exists(from), false);
    assert.strictEqual(await nodeFs.readFile(to), 'file content');
    assert.strictEqual(revertEntries.length, 1);
  });

  // ── MOVE_FILE ──

  it('MOVE_FILE revert to pre: file moved back', async () => {
    await cleanTempDir();
    const from = pathModule.join(tempDir, 'subdirA', 'file.txt');
    const to = pathModule.join(tempDir, 'subdirB', 'file.txt');
    const op = makeOp({ kind: 'move_file', from, to, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({}),
      makeSnapshot({}, 'post'),
    );
    await store.saveSession(entry);
    await nodeFs.writeFile(to, 'content');

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, nodeFs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(await nodeFs.exists(to), false);
    assert.strictEqual(await nodeFs.readFile(from), 'content');
    assert.strictEqual(revertEntries.length, 1);
  });

  // ── COPY_FILE ──

  it('COPY_FILE revert to pre: copy removed', async () => {
    await cleanTempDir();
    const from = pathModule.join(tempDir, 'source.txt');
    const to = pathModule.join(tempDir, 'copy.txt');
    const op = makeOp({ kind: 'copy_file', from, to, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({}),
      makeSnapshot({}, 'post'),
    );
    await store.saveSession(entry);
    await nodeFs.writeFile(from, 'source content');
    await nodeFs.writeFile(to, 'source content');

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, nodeFs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(await nodeFs.exists(to), false);
    assert.strictEqual(await nodeFs.readFile(from), 'source content');
    assert.strictEqual(revertEntries.length, 1);
  });

  // ── CREATE_DIRECTORY ──

  it('CREATE_DIRECTORY revert to pre: directory removed', async () => {
    await cleanTempDir();
    const dirPath = pathModule.join(tempDir, 'newdir');
    const op = makeOp({ kind: 'create_directory', directoryPath: dirPath, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({}),
      makeSnapshot({}, 'post'),
    );
    await store.saveSession(entry);
    await nodeFs.createDirectory(dirPath);

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, nodeFs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(await nodeFs.exists(dirPath), false);
    assert.strictEqual(revertEntries.length, 1);
  });

  // ── DELETE_DIRECTORY ──

  it('DELETE_DIRECTORY revert to pre: directory restored', async () => {
    await cleanTempDir();
    const dirPath = pathModule.join(tempDir, 'deleteddir');
    const file1 = pathModule.join(dirPath, 'a.txt');
    const file2 = pathModule.join(dirPath, 'sub', 'b.txt');
    const op = makeOp({ kind: 'delete_directory', directoryPath: dirPath, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({ [file1]: 'file a', [file2]: 'file b' }),
      makeSnapshot({}, 'post'),
    );
    await store.saveSession(entry);

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, nodeFs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(await nodeFs.exists(dirPath), true);
    assert.strictEqual(await nodeFs.readFile(file1), 'file a');
    assert.strictEqual(await nodeFs.readFile(file2), 'file b');
    assert.strictEqual(revertEntries.length, 1);
  });

  // ── MOVE_DIRECTORY ──

  it('MOVE_DIRECTORY revert to pre: directory moved back', async () => {
    await cleanTempDir();
    const from = pathModule.join(tempDir, 'oldDir');
    const to = pathModule.join(tempDir, 'newDir');
    const op = makeOp({ kind: 'move_directory', from, to, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({}),
      makeSnapshot({}, 'post'),
    );
    await store.saveSession(entry);
    await nodeFs.createDirectory(to);
    await nodeFs.writeFile(pathModule.join(to, 'file.txt'), 'content');

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, nodeFs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(await nodeFs.exists(to), false);
    assert.strictEqual(await nodeFs.exists(from), true);
    assert.strictEqual(await nodeFs.readFile(pathModule.join(from, 'file.txt')), 'content');
    assert.strictEqual(revertEntries.length, 1);
  });

  // ── EXTRACT_STRUCTURE (cannot revert) ──

  it('EXTRACT_STRUCTURE: cannot revert (error expected)', async () => {
    await cleanTempDir();
    const op = makeOp({ kind: 'extract_structure', directoryPath: tempDir, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({}),
      makeSnapshot({}, 'post'),
    );
    await store.saveSession(entry);

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, nodeFs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, false);
    assert.ok(result.errors.some((e: string) => e.includes('Cannot revert operation kind')));
    assert.strictEqual(revertEntries.length, 1);
    assert.strictEqual(revertEntries[0].status, 'failed');
  });

  // ── CODEBASE_METADATA (cannot revert) ──

  it('CODEBASE_METADATA: cannot revert (error expected)', async () => {
    await cleanTempDir();
    const op = makeOp({ kind: 'codebase_metadata', operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({}),
      makeSnapshot({}, 'post'),
    );
    await store.saveSession(entry);

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, nodeFs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, false);
    assert.ok(result.errors.some((e: string) => e.includes('Cannot revert operation kind')));
    assert.strictEqual(revertEntries.length, 1);
    assert.strictEqual(revertEntries[0].status, 'failed');
  });

  // ── APPEND_FILE_MULTI ──

  it('APPEND_FILE_MULTI revert to pre: all files restored to original', async () => {
    await cleanTempDir();
    const file1 = pathModule.join(tempDir, 'a.txt');
    const file2 = pathModule.join(tempDir, 'b.txt');
    const op = makeOp({ kind: 'append_file_multi', path: tempDir, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({ [file1]: 'original a', [file2]: 'original b' }),
      makeSnapshot({
        [file1]: makeDiff('original a', 'original a\n\nappended'),
        [file2]: makeDiff('original b', 'original b\n\nappended'),
      }, 'post'),
    );
    await store.saveSession(entry);
    await nodeFs.writeFile(file1, 'original a\n\nappended');
    await nodeFs.writeFile(file2, 'original b\n\nappended');

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, nodeFs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(await nodeFs.readFile(file1), 'original a');
    assert.strictEqual(await nodeFs.readFile(file2), 'original b');
    assert.strictEqual(revertEntries.length, 1);
    assert.strictEqual(revertEntries[0].targetState, 'pre');
  });

  it('APPEND_FILE_MULTI revert to post: all files have appended content', async () => {
    await cleanTempDir();
    const file1 = pathModule.join(tempDir, 'a.txt');
    const file2 = pathModule.join(tempDir, 'b.txt');
    const op = makeOp({ kind: 'append_file_multi', path: tempDir, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({ [file1]: 'original a', [file2]: 'original b' }),
      makeSnapshot({
        [file1]: makeDiff('original a', 'original a\n\nappended'),
        [file2]: makeDiff('original b', 'original b\n\nappended'),
      }, 'post'),
    );
    await store.saveSession(entry);
    await nodeFs.writeFile(file1, 'original a');
    await nodeFs.writeFile(file2, 'original b');

    const result = await revertOperations('test-session', [op.operationId], 'post', store, nodeFs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(await nodeFs.readFile(file1), 'original a\n\nappended');
    assert.strictEqual(await nodeFs.readFile(file2), 'original b\n\nappended');
    assert.strictEqual(revertEntries.length, 1);
    assert.strictEqual(revertEntries[0].targetState, 'post');
  });

  // ── SEARCH_REPLACE_MULTI ──

  it('SEARCH_REPLACE_MULTI revert to pre: all files restored to original', async () => {
    await cleanTempDir();
    const file1 = pathModule.join(tempDir, 'x.txt');
    const file2 = pathModule.join(tempDir, 'y.txt');
    const op = makeOp({ kind: 'search_replace_multi', path: tempDir, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({ [file1]: 'old text', [file2]: 'old text' }),
      makeSnapshot({
        [file1]: makeDiff('old text', 'new text'),
        [file2]: makeDiff('old text', 'new text'),
      }, 'post'),
    );
    await store.saveSession(entry);
    await nodeFs.writeFile(file1, 'new text');
    await nodeFs.writeFile(file2, 'new text');

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, nodeFs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(await nodeFs.readFile(file1), 'old text');
    assert.strictEqual(await nodeFs.readFile(file2), 'old text');
    assert.strictEqual(revertEntries.length, 1);
    assert.strictEqual(revertEntries[0].targetState, 'pre');
  });

  it('SEARCH_REPLACE_MULTI revert to post: all files have replaced content', async () => {
    await cleanTempDir();
    const file1 = pathModule.join(tempDir, 'x.txt');
    const file2 = pathModule.join(tempDir, 'y.txt');
    const op = makeOp({ kind: 'search_replace_multi', path: tempDir, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({ [file1]: 'old text', [file2]: 'old text' }),
      makeSnapshot({
        [file1]: makeDiff('old text', 'new text'),
        [file2]: makeDiff('old text', 'new text'),
      }, 'post'),
    );
    await store.saveSession(entry);
    await nodeFs.writeFile(file1, 'old text');
    await nodeFs.writeFile(file2, 'old text');

    const result = await revertOperations('test-session', [op.operationId], 'post', store, nodeFs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(await nodeFs.readFile(file1), 'new text');
    assert.strictEqual(await nodeFs.readFile(file2), 'new text');
    assert.strictEqual(revertEntries.length, 1);
    assert.strictEqual(revertEntries[0].targetState, 'post');
  });
});