import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { createTwoFilesPatch } from 'diff';
import type { FileSystem } from '../types/filesystem.js';
import type { HistoryStore } from './store.js';
import type { HistoryEntry, OperationResult, RevertHistoryEntry, SnapshotData } from './types.js';
import { revertOperations } from './revert.js';

const WORKSPACE = '/workspace';

class MockFileSystem implements FileSystem {
  files: Map<string, string> = new Map();
  dirs: Set<string> = new Set();
  ops: string[] = [];

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    this.ops.push(`writeFile:${path}`);
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
    this.ops.push(`deleteFile:${path}`);
  }

  async renameFile(from: string, to: string): Promise<void> {
    const content = this.files.get(from);
    if (content !== undefined) {
      this.files.delete(from);
      this.files.set(to, content);
    }
    this.ops.push(`renameFile:${from}->${to}`);
  }

  async copyFile(from: string, to: string): Promise<void> {
    const content = this.files.get(from);
    if (content !== undefined) {
      this.files.set(to, content);
    }
    this.ops.push(`copyFile:${from}->${to}`);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }

  async createDirectory(path: string): Promise<void> {
    this.dirs.add(path);
    this.ops.push(`createDirectory:${path}`);
  }

  async deleteDirectoryRecursive(path: string): Promise<void> {
    this.dirs.delete(path);
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(path + '/')) {
        this.files.delete(key);
      }
    }
    this.ops.push(`deleteDirectoryRecursive:${path}`);
  }

  async moveDirectory(from: string, to: string): Promise<void> {
    if (this.dirs.has(from)) {
      this.dirs.delete(from);
      this.dirs.add(to);
    }
    for (const [key, val] of [...this.files.entries()]) {
      if (key.startsWith(from + '/')) {
        this.files.delete(key);
        this.files.set(key.replace(from, to), val);
      }
    }
    this.ops.push(`moveDirectory:${from}->${to}`);
  }

  async listDirectory(_path: string): Promise<string[]> {
    return [];
  }

  async listDirectoryContents(_path: string): Promise<{ name: string; isDirectory: boolean }[]> {
    return [];
  }

  reset(): void {
    this.files.clear();
    this.dirs.clear();
    this.ops = [];
  }
}

class MockHistoryStore implements HistoryStore {
  sessions: Map<string, HistoryEntry> = new Map();
  revertEntries: RevertHistoryEntry[] = [];

  async saveSession(entry: HistoryEntry): Promise<void> {
    this.sessions.set(entry.session.sessionId, entry);
  }

  async getSession(sessionId: string): Promise<HistoryEntry | undefined> {
    return this.sessions.get(sessionId);
  }

  async getAllSessions() { return []; }
  async deleteSession(_id: string) {}
  async deleteSingleSession(_id: string, _triggeredBy: 'user' | 'system') { return 0; }
  async getSessionsByDateRange(_start: Date, _end: Date) { return []; }
  async getRecentSessions(_limit: number) { return []; }
  async cleanupOldSessions(_retentionMonths: number) { return 0; }
  async wipeAllHistory() { return 0; }
  async saveRevertHistory(_sessionId: string, entry: RevertHistoryEntry) {
    this.revertEntries.push(entry);
  }
  async getRevertHistory(_sessionId: string) { return { sessionId: _sessionId, reverts: [] }; }
}

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
  let fs: MockFileSystem;
  let store: MockHistoryStore;
  const workspaceFolders = [WORKSPACE];
  let revertEntries: RevertHistoryEntry[] = [];

  before(() => {
    fs = new MockFileSystem();
    store = new MockHistoryStore();
    revertEntries = [];
  });

  function reset(): void {
    fs.reset();
    store.sessions.clear();
    store.revertEntries = [];
    revertEntries = [];
  }

  function onRevertComplete(entry: RevertHistoryEntry): void {
    revertEntries.push(entry);
  }

  // ── CREATE_FILE ──

  it('CREATE_FILE revert to pre: file should be deleted', async () => {
    reset();
    const filePath = `${WORKSPACE}/newfile.txt`;
    const op = makeOp({ kind: 'create_file', path: filePath, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({}),
      makeSnapshot({ [filePath]: makeDiff('', 'hello world') }, 'post'),
    );
    await store.saveSession(entry);
    fs.files.set(filePath, 'hello world');

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, fs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(fs.files.has(filePath), false);
    assert.strictEqual(revertEntries.length, 1);
    assert.strictEqual(revertEntries[0].targetState, 'pre');
  });

  it('CREATE_FILE revert to post: file should be restored with content', async () => {
    reset();
    const filePath = `${WORKSPACE}/newfile.txt`;
    const op = makeOp({ kind: 'create_file', path: filePath, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({}),
      makeSnapshot({ [filePath]: makeDiff('', 'hello world') }, 'post'),
    );
    await store.saveSession(entry);

    const result = await revertOperations('test-session', [op.operationId], 'post', store, fs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(fs.files.get(filePath), 'hello world');
    assert.strictEqual(revertEntries.length, 1);
    assert.strictEqual(revertEntries[0].targetState, 'post');
  });

  // ── DELETE_FILE ──

  it('DELETE_FILE revert to pre: file should be restored', async () => {
    reset();
    const filePath = `${WORKSPACE}/oldfile.txt`;
    const op = makeOp({ kind: 'delete_file', path: filePath, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({ [filePath]: 'content to restore' }),
      makeSnapshot({ [filePath]: makeDiff('content to restore', '') }, 'post'),
    );
    await store.saveSession(entry);

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, fs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(fs.files.get(filePath), 'content to restore');
    assert.strictEqual(revertEntries.length, 1);
  });

  it('DELETE_FILE revert to post: file should stay deleted', async () => {
    reset();
    const filePath = `${WORKSPACE}/oldfile.txt`;
    const op = makeOp({ kind: 'delete_file', path: filePath, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({ [filePath]: 'content to restore' }),
      makeSnapshot({ [filePath]: makeDiff('content to restore', '') }, 'post'),
    );
    await store.saveSession(entry);

    const result = await revertOperations('test-session', [op.operationId], 'post', store, fs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(fs.files.has(filePath), false);
    assert.strictEqual(revertEntries.length, 1);
  });

  // ── SEARCH_REPLACE ──

  it('SEARCH_REPLACE revert to pre: original content restored', async () => {
    reset();
    const filePath = `${WORKSPACE}/search.txt`;
    const op = makeOp({ kind: 'search_replace', path: filePath, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({ [filePath]: 'original content' }),
      makeSnapshot({ [filePath]: makeDiff('original content', 'new content') }, 'post'),
    );
    await store.saveSession(entry);
    fs.files.set(filePath, 'new content');

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, fs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(fs.files.get(filePath), 'original content');
    assert.strictEqual(revertEntries.length, 1);
  });

  it('SEARCH_REPLACE revert to post: new content restored', async () => {
    reset();
    const filePath = `${WORKSPACE}/search.txt`;
    const op = makeOp({ kind: 'search_replace', path: filePath, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({ [filePath]: 'original content' }),
      makeSnapshot({ [filePath]: makeDiff('original content', 'new content') }, 'post'),
    );
    await store.saveSession(entry);
    fs.files.set(filePath, 'original content');

    const result = await revertOperations('test-session', [op.operationId], 'post', store, fs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(fs.files.get(filePath), 'new content');
    assert.strictEqual(revertEntries.length, 1);
  });

  // ── APPEND_FILE ──

  it('APPEND_FILE revert to pre: appended content removed', async () => {
    reset();
    const filePath = `${WORKSPACE}/append.txt`;
    const op = makeOp({ kind: 'append_file', path: filePath, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({ [filePath]: 'base\ntext' }),
      makeSnapshot({ [filePath]: makeDiff('base\ntext', 'base\ntext\nappended') }, 'post'),
    );
    await store.saveSession(entry);
    fs.files.set(filePath, 'base\ntext\nappended');

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, fs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(fs.files.get(filePath), 'base\ntext');
    assert.strictEqual(revertEntries.length, 1);
  });

  it('APPEND_FILE revert to pre: file was created during session, should be deleted', async () => {
    reset();
    const filePath = `${WORKSPACE}/created-and-appended.txt`;
    const op = makeOp({ kind: 'append_file', path: filePath, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({}), // file does NOT exist in pre-snapshot
      makeSnapshot({ [filePath]: makeDiff('', 'appended content') }, 'post'),
    );
    await store.saveSession(entry);
    fs.files.set(filePath, 'appended content');

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, fs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(fs.files.has(filePath), false, 'file should be deleted when reverting to pre');
    assert.strictEqual(revertEntries.length, 1);
  });

  it('APPEND_FILE revert to post: appended content kept', async () => {
    reset();
    const filePath = `${WORKSPACE}/append.txt`;
    const op = makeOp({ kind: 'append_file', path: filePath, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({ [filePath]: 'base\ntext' }),
      makeSnapshot({ [filePath]: makeDiff('base\ntext', 'base\ntext\nappended') }, 'post'),
    );
    await store.saveSession(entry);
    fs.files.set(filePath, 'base\ntext');

    const result = await revertOperations('test-session', [op.operationId], 'post', store, fs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(fs.files.get(filePath), 'base\ntext\nappended');
    assert.strictEqual(revertEntries.length, 1);
  });

  // ── RENAME_FILE ──

  it('RENAME_FILE revert to pre: file renamed back', async () => {
    reset();
    const from = `${WORKSPACE}/oldName.txt`;
    const to = `${WORKSPACE}/newName.txt`;
    const op = makeOp({ kind: 'rename_file', from, to, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({}),
      makeSnapshot({}, 'post'),
    );
    await store.saveSession(entry);
    fs.files.set(to, 'file content');

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, fs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(fs.files.has(to), false);
    assert.strictEqual(fs.files.get(from), 'file content');
    assert.strictEqual(revertEntries.length, 1);
  });

  it('RENAME_FILE revert to post: file keeps new name', async () => {
    reset();
    const from = `${WORKSPACE}/oldName.txt`;
    const to = `${WORKSPACE}/newName.txt`;
    const op = makeOp({ kind: 'rename_file', from, to, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({}),
      makeSnapshot({}, 'post'),
    );
    await store.saveSession(entry);
    fs.files.set(from, 'file content');

    const result = await revertOperations('test-session', [op.operationId], 'post', store, fs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(fs.files.has(from), false);
    assert.strictEqual(fs.files.get(to), 'file content');
    assert.strictEqual(revertEntries.length, 1);
  });

  // ── MOVE_FILE ──

  it('MOVE_FILE revert to pre: file moved back', async () => {
    reset();
    const from = `${WORKSPACE}/subdirA/file.txt`;
    const to = `${WORKSPACE}/subdirB/file.txt`;
    const op = makeOp({ kind: 'move_file', from, to, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({}),
      makeSnapshot({}, 'post'),
    );
    await store.saveSession(entry);
    fs.files.set(to, 'content');

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, fs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(fs.files.has(to), false);
    assert.strictEqual(fs.files.get(from), 'content');
    assert.strictEqual(revertEntries.length, 1);
  });

  // ── COPY_FILE ──

  it('COPY_FILE revert to pre: copy removed', async () => {
    reset();
    const from = `${WORKSPACE}/source.txt`;
    const to = `${WORKSPACE}/copy.txt`;
    const op = makeOp({ kind: 'copy_file', from, to, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({}),
      makeSnapshot({}, 'post'),
    );
    await store.saveSession(entry);
    fs.files.set(from, 'source content');
    fs.files.set(to, 'source content');

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, fs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(fs.files.has(to), false);
    assert.strictEqual(fs.files.get(from), 'source content');
    assert.strictEqual(revertEntries.length, 1);
  });

  // ── CREATE_DIRECTORY ──

  it('CREATE_DIRECTORY revert to pre: directory removed', async () => {
    reset();
    const dirPath = `${WORKSPACE}/newdir`;
    const op = makeOp({ kind: 'create_directory', directoryPath: dirPath, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({}),
      makeSnapshot({}, 'post'),
    );
    await store.saveSession(entry);
    fs.dirs.add(dirPath);

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, fs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(fs.dirs.has(dirPath), false);
    assert.strictEqual(revertEntries.length, 1);
  });

  // ── DELETE_DIRECTORY ──

  it('DELETE_DIRECTORY revert to pre: directory restored', async () => {
    reset();
    const dirPath = `${WORKSPACE}/deleteddir`;
    const file1 = `${dirPath}/a.txt`;
    const file2 = `${dirPath}/sub/b.txt`;
    const op = makeOp({ kind: 'delete_directory', directoryPath: dirPath, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({ [file1]: 'file a', [file2]: 'file b' }),
      makeSnapshot({}, 'post'),
    );
    await store.saveSession(entry);

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, fs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(fs.dirs.has(dirPath), true);
    assert.strictEqual(fs.files.get(file1), 'file a');
    assert.strictEqual(fs.files.get(file2), 'file b');
    assert.strictEqual(revertEntries.length, 1);
  });

  // ── MOVE_DIRECTORY ──

  it('MOVE_DIRECTORY revert to pre: directory moved back', async () => {
    reset();
    const from = `${WORKSPACE}/oldDir`;
    const to = `${WORKSPACE}/newDir`;
    const op = makeOp({ kind: 'move_directory', from, to, operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({}),
      makeSnapshot({}, 'post'),
    );
    await store.saveSession(entry);
    fs.dirs.add(to);
    fs.files.set(`${to}/file.txt`, 'content');

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, fs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, true);
    assert.strictEqual(fs.dirs.has(to), false);
    assert.strictEqual(fs.dirs.has(from), true);
    assert.strictEqual(fs.files.get(`${from}/file.txt`), 'content');
    assert.strictEqual(revertEntries.length, 1);
  });

  // ── EXTRACT_STRUCTURE (cannot revert) ──

  it('EXTRACT_STRUCTURE: cannot revert (error expected)', async () => {
    reset();
    const op = makeOp({ kind: 'extract_structure', directoryPath: '/workspace', operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({}),
      makeSnapshot({}, 'post'),
    );
    await store.saveSession(entry);

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, fs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, false);
    assert.ok(result.errors.some(e => e.includes('Cannot revert operation kind')));
    assert.strictEqual(revertEntries.length, 1);
    assert.strictEqual(revertEntries[0].status, 'failed');
  });

  // ── CODEBASE_METADATA (cannot revert) ──

  it('CODEBASE_METADATA: cannot revert (error expected)', async () => {
    reset();
    const op = makeOp({ kind: 'codebase_metadata', operationIndex: 0 });
    const entry = makeEntry(
      [op],
      makeSnapshot({}),
      makeSnapshot({}, 'post'),
    );
    await store.saveSession(entry);

    const result = await revertOperations('test-session', [op.operationId], 'pre', store, fs, workspaceFolders, onRevertComplete);

    assert.strictEqual(result.success, false);
    assert.ok(result.errors.some(e => e.includes('Cannot revert operation kind')));
    assert.strictEqual(revertEntries.length, 1);
    assert.strictEqual(revertEntries[0].status, 'failed');
  });
});