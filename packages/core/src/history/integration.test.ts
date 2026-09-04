import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as pathModule from 'path';
import { createTwoFilesPatch } from 'diff';
import { NodeFileSystem } from '../testing/nodeFileSystem.js';
import { executeFileOperations } from '../file-operations/index.js';
import { revertOperations, revertSession } from './revert.js';
import type { HistoryStore } from './store.js';
import type { HistoryEntry, HistorySession, SnapshotData, OperationResult, RevertHistoryEntry } from './types.js';

class TestHistoryStore implements HistoryStore {
  private sessionsDir: string;
  private fs: NodeFileSystem;

  constructor(baseDir: string, fs: NodeFileSystem) {
    this.sessionsDir = pathModule.join(baseDir, '.brud', 'history', 'sessions');
    this.fs = fs;
  }

  private sessionDir(sessionId: string): string {
    return pathModule.join(this.sessionsDir, sessionId);
  }

  private sessionFile(sessionId: string): string {
    return pathModule.join(this.sessionDir(sessionId), 'session.json');
  }

  private preFile(sessionId: string): string {
    return pathModule.join(this.sessionDir(sessionId), 'pre.json');
  }

  private postFile(sessionId: string): string {
    return pathModule.join(this.sessionDir(sessionId), 'post.json');
  }

  private mapToObject(map: Map<string, string>): Record<string, string> {
    const obj: Record<string, string> = {};
    for (const [key, value] of map) {
      obj[key] = value;
    }
    return obj;
  }

  private objectToMap(obj: Record<string, string>): Map<string, string> {
    return new Map(Object.entries(obj));
  }

  async saveSession(entry: HistoryEntry): Promise<void> {
    const { session, preSnapshot, postSnapshot } = entry;
    const dir = this.sessionDir(session.sessionId);
    await this.fs.createDirectory(dir);
    await this.fs.writeFile(this.sessionFile(session.sessionId), JSON.stringify(session, null, 2));
    await this.fs.writeFile(this.preFile(session.sessionId), JSON.stringify({ ...preSnapshot, files: this.mapToObject(preSnapshot.files) }, null, 2));
    await this.fs.writeFile(this.postFile(session.sessionId), JSON.stringify({ ...postSnapshot, files: this.mapToObject(postSnapshot.files) }, null, 2));
  }

  async getSession(sessionId: string): Promise<HistoryEntry | undefined> {
    const sessionPath = this.sessionFile(sessionId);
    if (!(await this.fs.exists(sessionPath))) {
      return undefined;
    }
    const [sessionRaw, preRaw, postRaw] = await Promise.all([
      this.fs.readFile(sessionPath),
      this.fs.readFile(this.preFile(sessionId)),
      this.fs.readFile(this.postFile(sessionId)),
    ]);
    const session: HistorySession = JSON.parse(sessionRaw);
    const preData = JSON.parse(preRaw);
    const postData = JSON.parse(postRaw);
    return {
      session,
      preSnapshot: { ...preData, files: this.objectToMap(preData.files) },
      postSnapshot: { ...postData, files: this.objectToMap(postData.files) },
    };
  }

  async getAllSessions(): Promise<HistorySession[]> {
    const sessionsDirExists = await this.fs.exists(this.sessionsDir);
    if (!sessionsDirExists) return [];
    const entries = await this.fs.listDirectoryContents(this.sessionsDir);
    const sessionDirs = entries.filter(e => e.isDirectory).map(e => e.name);
    const sessions: HistorySession[] = [];
    for (const dir of sessionDirs) {
      try {
        const raw = await this.fs.readFile(this.sessionFile(dir));
        const session: HistorySession = JSON.parse(raw);
        if (!session.isDeleted) {
          sessions.push(session);
        }
      } catch {
        // skip invalid
      }
    }
    sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return sessions;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.fs.deleteDirectoryRecursive(this.sessionDir(sessionId));
  }

  async deleteSingleSession(sessionId: string, _triggeredBy: 'user' | 'system', _permanentDelete?: boolean): Promise<number> {
    await this.deleteSession(sessionId);
    return 1;
  }

  async getSessionsByDateRange(_start: Date, _end: Date): Promise<HistorySession[]> {
    return [];
  }

  async getRecentSessions(_limit: number): Promise<HistorySession[]> {
    return [];
  }

  async cleanupOldSessions(retentionMonths: number): Promise<number> {
    const all = await this.getAllSessionsIncludingTrashed();
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - retentionMonths);
    const cutoffTime = cutoff.getTime();
    let deletedCount = 0;

    const expired = await this.getExpiredSessions();
    for (const session of expired) {
      await this.deleteSession(session.sessionId);
      deletedCount++;
    }

    for (const session of all) {
      if (session.isDeleted) continue;
      const ageReference = session.renewedAt || session.timestamp;
      if (new Date(ageReference).getTime() < cutoffTime) {
        await this.softDeleteSession(session.sessionId, 'system', 'retention_cleanup');
        deletedCount++;
      }
    }
    return deletedCount;
  }

  async wipeAllHistory(_permanentDelete?: boolean): Promise<number> {
    return 0;
  }

  async saveRevertHistory(_sessionId: string, _entry: RevertHistoryEntry): Promise<void> {
    // no-op for tests
  }

  async getRevertHistory(_sessionId: string): Promise<{ sessionId: string; reverts: RevertHistoryEntry[] }> {
    return { sessionId: _sessionId, reverts: [] };
  }

  async softDeleteSession(sessionId: string, deletedBy: 'user' | 'system', reason: 'manual_delete' | 'manual_wipe' | 'retention_cleanup'): Promise<void> {
    const sessionPath = this.sessionFile(sessionId);
    if (!(await this.fs.exists(sessionPath))) return;
    const raw = await this.fs.readFile(sessionPath);
    const session: HistorySession = JSON.parse(raw);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    session.isDeleted = true;
    session.deletedAt = now;
    session.expiresAt = expiresAt;
    session.deletedBy = deletedBy;
    session.deleteReason = reason;
    if (!session.softDeleteHistory) session.softDeleteHistory = [];
    session.softDeleteHistory.push({ action: 'soft_delete', at: now, by: deletedBy, reason });
    await this.fs.writeFile(sessionPath, JSON.stringify(session, null, 2));
  }

  async restoreSession(sessionId: string): Promise<void> {
    const sessionPath = this.sessionFile(sessionId);
    if (!(await this.fs.exists(sessionPath))) return;
    const raw = await this.fs.readFile(sessionPath);
    const session: HistorySession = JSON.parse(raw);
    const now = new Date().toISOString();
    session.isDeleted = false;
    session.deletedAt = undefined;
    session.expiresAt = undefined;
    session.deletedBy = undefined;
    session.deleteReason = undefined;
    session.renewedAt = now;
    if (!session.softDeleteHistory) session.softDeleteHistory = [];
    session.softDeleteHistory.push({ action: 'restore', at: now, by: 'user' });
    await this.fs.writeFile(sessionPath, JSON.stringify(session, null, 2));
  }

  async getTrashedSessions(): Promise<HistorySession[]> {
    const all = await this.getAllSessionsIncludingTrashed();
    const now = new Date().getTime();
    return all.filter(s => s.isDeleted === true && s.expiresAt && new Date(s.expiresAt).getTime() > now);
  }

  async getExpiredSessions(): Promise<HistorySession[]> {
    const all = await this.getAllSessionsIncludingTrashed();
    const now = new Date().getTime();
    return all.filter(s => s.isDeleted === true && s.expiresAt && new Date(s.expiresAt).getTime() <= now);
  }

  private async getAllSessionsIncludingTrashed(): Promise<HistorySession[]> {
    const sessionsDirExists = await this.fs.exists(this.sessionsDir);
    if (!sessionsDirExists) return [];
    const entries = await this.fs.listDirectoryContents(this.sessionsDir);
    const sessionDirs = entries.filter(e => e.isDirectory).map(e => e.name);
    const sessions: HistorySession[] = [];
    for (const dir of sessionDirs) {
      try {
        const raw = await this.fs.readFile(this.sessionFile(dir));
        sessions.push(JSON.parse(raw));
      } catch {
        // skip
      }
    }
    return sessions;
  }
}

function makeDiff(oldStr: string, newStr: string): string {
  if (oldStr === newStr) return '';
  return createTwoFilesPatch('file', 'file', oldStr, newStr, 'pre', 'post');
}

describe('Integration Tests (Real File Operations)', () => {
  let tempDir: string;
  let nodeFs: NodeFileSystem;
  let store: TestHistoryStore;
  let workspaceFolders: string[];

  before(async () => {
    tempDir = await fs.mkdtemp('/tmp/brud-integration-');
    nodeFs = new NodeFileSystem();
    store = new TestHistoryStore(tempDir, nodeFs);
    workspaceFolders = [tempDir];
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function cleanTempDir() {
    const entries = await fs.readdir(tempDir);
    for (const entry of entries) {
      await fs.rm(pathModule.join(tempDir, entry), { recursive: true, force: true });
    }
  }

  describe('TEST 1: CREATE_FILE lifecycle', () => {
    it('creates file, verifies on disk, then reverts to pre', async () => {
      await cleanTempDir();
      const relPath = 'test-create.txt';
      const content = 'hello world from integration test';

      const result = await executeFileOperations(
        [{ kind: 'create_file', path: relPath, index: '0', content }],
        nodeFs,
        workspaceFolders,
        store,
        'test create file',
      );

      assert.strictEqual(result.success, true);

      const resolvedPath = pathModule.join(tempDir, relPath);
      const exists = await nodeFs.exists(resolvedPath);
      assert.strictEqual(exists, true, 'file should exist on disk after creation');
      const diskContent = await nodeFs.readFile(resolvedPath);
      assert.strictEqual(diskContent, content, 'file content should match');

      // Get the session ID from the store
      const sessions = await store.getAllSessions();
      assert.strictEqual(sessions.length, 1);
      const sessionId = sessions[0].sessionId;
      const opId = sessions[0].operations[0].operationId;

      // Revert to pre
      const revertResult = await revertOperations(sessionId, [opId], 'pre', store, nodeFs, workspaceFolders);
      assert.strictEqual(revertResult.success, true);

      const existsAfterRevert = await nodeFs.exists(resolvedPath);
      assert.strictEqual(existsAfterRevert, false, 'file should be deleted after revert to pre');
    });
  });

  describe('TEST 2: APPEND_FILE lifecycle', () => {
    it('appends to file, verifies on disk, then reverts to pre', async () => {
      await cleanTempDir();
      const relPath = 'test-append.txt';
      const initialContent = 'base line 1\nbase line 2';
      const resolvedPath = pathModule.join(tempDir, relPath);
      await nodeFs.writeFile(resolvedPath, initialContent);

      const content = 'appended line';

      const result = await executeFileOperations(
        [{ kind: 'append_file', path: relPath, index: '0', position: 'end', content }],
        nodeFs,
        workspaceFolders,
        store,
        'test append file',
      );

      assert.strictEqual(result.success, true);

      const diskContent = await nodeFs.readFile(resolvedPath);
      assert.strictEqual(diskContent, initialContent + '\n\n' + content, 'appended content should be on disk');

      const sessions = await store.getAllSessions();
      const sessionId = sessions[0].sessionId;
      const opId = sessions[0].operations[0].operationId;

      const revertResult = await revertOperations(sessionId, [opId], 'pre', store, nodeFs, workspaceFolders);
      assert.strictEqual(revertResult.success, true);

      const revertedContent = await nodeFs.readFile(resolvedPath);
      assert.strictEqual(revertedContent, initialContent, 'appended content should be removed after revert');
    });
  });

  describe('TEST 3: SEARCH_REPLACE lifecycle', () => {
    it('replaces text in file, verifies on disk, then reverts to pre', async () => {
      await cleanTempDir();
      const relPath = 'test-search-replace.txt';
      const initialContent = 'hello world';
      const resolvedPath = pathModule.join(tempDir, relPath);
      await nodeFs.writeFile(resolvedPath, initialContent);

      const result = await executeFileOperations(
        [{ kind: 'search_replace', path: relPath, index: '0', search: 'world', replace: 'there' }],
        nodeFs,
        workspaceFolders,
        store,
        'test search replace',
      );

      assert.strictEqual(result.success, true);

      const diskContent = await nodeFs.readFile(resolvedPath);
      assert.strictEqual(diskContent, 'hello there', 'replaced content should be on disk');

      const sessions = await store.getAllSessions();
      const sessionId = sessions[0].sessionId;
      const opId = sessions[0].operations[0].operationId;

      const revertResult = await revertOperations(sessionId, [opId], 'pre', store, nodeFs, workspaceFolders);
      assert.strictEqual(revertResult.success, true);

      const revertedContent = await nodeFs.readFile(resolvedPath);
      assert.strictEqual(revertedContent, 'hello world', 'original content should be restored after revert');
    });
  });

  describe('TEST 4: Soft delete and restore', () => {
    it('creates session, soft deletes, verifies in trash, then restores', async () => {
      await cleanTempDir();
      // Create a session via a real file operation
      const relPath = 'test-soft-delete.txt';
      const result = await executeFileOperations(
        [{ kind: 'create_file', path: relPath, index: '0', content: 'soft delete test' }],
        nodeFs,
        workspaceFolders,
        store,
        'test soft delete',
      );

      assert.strictEqual(result.success, true);

      let sessions = await store.getAllSessions();
      assert.strictEqual(sessions.length, 1);
      const sessionId = sessions[0].sessionId;

      // Soft delete
      await store.softDeleteSession(sessionId, 'user', 'manual_delete');

      // Verify session is no longer in active sessions
      sessions = await store.getAllSessions();
      assert.strictEqual(sessions.length, 0, 'session should not be in active sessions');

      // Verify it's in trash
      const trashed = await store.getTrashedSessions();
      assert.strictEqual(trashed.length, 1, 'session should be in trash');
      assert.strictEqual(trashed[0].isDeleted, true, 'trashed session should have isDeleted flag');
      assert.strictEqual(trashed[0].deleteReason, 'manual_delete');

      // Restore
      await store.restoreSession(sessionId);

      // Verify it's back in active sessions
      sessions = await store.getAllSessions();
      assert.strictEqual(sessions.length, 1, 'session should be active after restore');
      assert.strictEqual(sessions[0].isDeleted, false, 'isDeleted should be false');
      assert.ok(sessions[0].renewedAt, 'renewedAt should be set');
    });
  });

  describe('TEST 5: Retention with renewal', () => {
    it('restored session with old timestamp is not deleted by retention', async () => {
      await cleanTempDir();
      // Create a session  
      const relPath = 'test-retention.txt';
      const result = await executeFileOperations(
        [{ kind: 'create_file', path: relPath, index: '0', content: 'retention test' }],
        nodeFs,
        workspaceFolders,
        store,
        'test retention',
      );

      assert.strictEqual(result.success, true);

      let sessions = await store.getAllSessions();
      const sessionId = sessions[0].sessionId;

      // Manually set session timestamp to 6 months ago
      const sessionPath = pathModule.join(store['sessionsDir'], sessionId, 'session.json');
      const raw = await nodeFs.readFile(sessionPath);
      const sessionData = JSON.parse(raw);
      const oldDate = new Date();
      oldDate.setMonth(oldDate.getMonth() - 6);
      sessionData.timestamp = oldDate.toISOString();
      await nodeFs.writeFile(sessionPath, JSON.stringify(sessionData, null, 2));

      // Soft delete
      await store.softDeleteSession(sessionId, 'user', 'manual_delete');

      // Restore (sets renewedAt to now)
      await store.restoreSession(sessionId);

      // Run cleanup with 3 months retention
      const deletedCount = await store.cleanupOldSessions(3);

      // Session should NOT be deleted because renewedAt is recent
      assert.strictEqual(deletedCount, 0, 'restored session should not be deleted by retention');

      sessions = await store.getAllSessions();
      assert.strictEqual(sessions.length, 1, 'session should still be active');
    });
  });

  describe('TEST 6: Full session revert with multiple operations', () => {
    it('creates directory with files, then reverts entire session', async () => {
      await cleanTempDir();
      const dirRelPath = 'test-multi-session';
      const file1RelPath = pathModule.join('test-multi-session', 'file1.txt');
      const file2RelPath = pathModule.join('test-multi-session', 'file2.txt');

      const result = await executeFileOperations(
        [
          { kind: 'create_directory', directoryPath: dirRelPath, files: ['file1.txt', 'file2.txt'], index: '0' },
          { kind: 'append_file', path: file1RelPath, index: '1', position: 'end', content: 'content1' },
          { kind: 'append_file', path: file2RelPath, index: '2', position: 'end', content: 'content2' },
        ],
        nodeFs,
        workspaceFolders,
        store,
        'test multi-operation session',
      );

      assert.strictEqual(result.success, true);

      // Verify all files created with content
      const resolvedDir = pathModule.join(tempDir, dirRelPath);
      const resolvedFile1 = pathModule.join(tempDir, file1RelPath);
      const resolvedFile2 = pathModule.join(tempDir, file2RelPath);

      assert.strictEqual(await nodeFs.exists(resolvedDir), true, 'directory should exist');
      assert.strictEqual(await nodeFs.exists(resolvedFile1), true, 'file1 should exist');
      assert.strictEqual(await nodeFs.exists(resolvedFile2), true, 'file2 should exist');
      assert.strictEqual(await nodeFs.readFile(resolvedFile1), '\n\ncontent1');
      assert.strictEqual(await nodeFs.readFile(resolvedFile2), '\n\ncontent2');

      const sessions = await store.getAllSessions();
      const sessionId = sessions[0].sessionId;
      const opIds = sessions[0].operations.map(o => o.operationId);

      // Revert entire session to pre
      const revertResult = await revertOperations(sessionId, opIds, 'pre', store, nodeFs, workspaceFolders);
      assert.strictEqual(revertResult.success, true, 'full session revert should succeed');

      // Verify directory and files are gone
      assert.strictEqual(await nodeFs.exists(resolvedDir), false, 'directory should be deleted after revert');
      assert.strictEqual(await nodeFs.exists(resolvedFile1), false, 'file1 should be deleted after revert');
      assert.strictEqual(await nodeFs.exists(resolvedFile2), false, 'file2 should be deleted after revert');
    });
  });

  describe('TEST 7: Individual operation revert', () => {
    it('reverts only APPEND_FILE operations, keeps CREATE_DIRECTORY', async () => {
      await cleanTempDir();
      const dirRelPath = 'test-individual-revert';
      const file1RelPath = pathModule.join('test-individual-revert', 'a.txt');
      const file2RelPath = pathModule.join('test-individual-revert', 'b.txt');
      const file3RelPath = pathModule.join('test-individual-revert', 'c.txt');

      const result = await executeFileOperations(
        [
          { kind: 'create_directory', directoryPath: dirRelPath, files: ['a.txt', 'b.txt', 'c.txt'], index: '0' },
          { kind: 'append_file', path: file1RelPath, index: '1', position: 'end', content: 'AAA' },
          { kind: 'append_file', path: file2RelPath, index: '2', position: 'end', content: 'BBB' },
          { kind: 'append_file', path: file3RelPath, index: '3', position: 'end', content: 'CCC' },
        ],
        nodeFs,
        workspaceFolders,
        store,
        'test individual operation revert',
      );

      assert.strictEqual(result.success, true);

      const resolvedDir = pathModule.join(tempDir, dirRelPath);
      const resolvedFile1 = pathModule.join(tempDir, file1RelPath);
      const resolvedFile2 = pathModule.join(tempDir, file2RelPath);
      const resolvedFile3 = pathModule.join(tempDir, file3RelPath);

      assert.strictEqual(await nodeFs.exists(resolvedDir), true);
      assert.strictEqual(await nodeFs.readFile(resolvedFile1), '\n\nAAA');
      assert.strictEqual(await nodeFs.readFile(resolvedFile2), '\n\nBBB');
      assert.strictEqual(await nodeFs.readFile(resolvedFile3), '\n\nCCC');

      const sessions = await store.getAllSessions();
      const sessionId = sessions[0].sessionId;

      // Get only the APPEND_FILE operation IDs
      const appendOpIds = sessions[0].operations
        .filter(o => o.kind === 'append_file')
        .map(o => o.operationId);
      assert.strictEqual(appendOpIds.length, 3);

      // Revert ONLY the APPEND_FILE operations
      const revertResult = await revertOperations(sessionId, appendOpIds, 'pre', store, nodeFs, workspaceFolders);
      assert.strictEqual(revertResult.success, true, 'individual operation revert should succeed');

      // Files should be deleted (the append_file pre-snapshot is empty, so revert to pre deletes the file)
      assert.strictEqual(await nodeFs.exists(resolvedFile1), false, 'file1 should be deleted after individual revert');
      assert.strictEqual(await nodeFs.exists(resolvedFile2), false, 'file2 should be deleted after individual revert');
      assert.strictEqual(await nodeFs.exists(resolvedFile3), false, 'file3 should be deleted after individual revert');

      // Directory should still exist (CREATE_DIRECTORY was not reverted)
      assert.strictEqual(await nodeFs.exists(resolvedDir), true, 'directory should still exist');
    });
  });
});