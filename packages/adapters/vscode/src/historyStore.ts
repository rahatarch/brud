import * as path from 'path';
import * as vscode from 'vscode';
import type { HistoryEntry, HistorySession, HistoryStore, SnapshotData, RevertResult, RevertHistoryEntry, RevertHistory, DeleteHistoryEntry, DeleteHistory } from '@brud/core';
import { revertSession } from '@brud/core';
import type { FileSystem } from '@brud/core';
import { getWorkspaceFolders } from './workspace';

export class WorkspaceHistoryStore implements HistoryStore {
  private brudDirEnsured = false;

  constructor(
    private workspaceRoot: string,
    private fileSystem: FileSystem,
  ) {
    this.ensureBrudDirectory().catch(() => {});
  }

  private get brudDir(): string {
    return path.join(this.workspaceRoot, '.brud');
  }

  private get historyDir(): string {
    return path.join(this.brudDir, 'history');
  }

  private get sessionsDir(): string {
    return path.join(this.historyDir, 'sessions');
  }

  private sessionDir(sessionId: string): string {
    return path.join(this.sessionsDir, sessionId);
  }

  private sessionFile(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), 'session.json');
  }

  private preFile(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), 'pre.json');
  }

  private postFile(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), 'post.json');
  }

  private revertsFile(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), 'reverts.json');
  }

  private getDeleteHistoryPath(): string {
    return path.join(this.historyDir, 'delete-history.json');
  }

  private generateDeleteId(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `DEL-${y}${m}${d}-${hh}${mm}${ss}`;
  }

  async getDeleteHistory(): Promise<DeleteHistory> {
    const filePath = this.getDeleteHistoryPath();
    const exists = await this.fileSystem.exists(filePath);
    if (!exists) {
      return { workspace: this.workspaceRoot, deletions: [] };
    }
    const raw = await this.fileSystem.readFile(filePath);
    return JSON.parse(raw);
  }

  async recordDeleteHistory(entry: Omit<DeleteHistoryEntry, 'deleteId' | 'timestamp'>): Promise<void> {
    const history = await this.getDeleteHistory();
    const deleteEntry: DeleteHistoryEntry = {
      deleteId: this.generateDeleteId(),
      timestamp: new Date().toISOString(),
      ...entry,
    };
    history.deletions.push(deleteEntry);
    await this.fileSystem.writeFile(this.getDeleteHistoryPath(), JSON.stringify(history, null, 2));
  }

  async recordFailedAttempt(attemptedPhrase: string, expectedPhrase: string): Promise<void> {
    const history = await this.getDeleteHistory();
    if (history.deletions.length === 0) {
      history.deletions.push({
        deleteId: this.generateDeleteId(),
        timestamp: new Date().toISOString(),
        deletedCount: 0,
        deletedSessions: [],
        reason: 'manual_wipe',
        triggeredBy: 'user',
        failedAttempts: [],
      });
    }
    const currentEntry = history.deletions[history.deletions.length - 1];
    if (!currentEntry.failedAttempts) {
      currentEntry.failedAttempts = [];
    }
    currentEntry.failedAttempts.push({
      timestamp: new Date().toISOString(),
      attemptedPhrase,
      expectedPhrase,
    });
    await this.fileSystem.writeFile(this.getDeleteHistoryPath(), JSON.stringify(history, null, 2));
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

  private async ensureBrudDirectory(): Promise<void> {
    const brudDirExists = await this.fileSystem.exists(this.brudDir);
    if (!brudDirExists) {
      await this.fileSystem.createDirectory(this.brudDir);
    }

    this.brudDirEnsured = true;
  }

  private async ensureWarningFile(): Promise<void> {
    const warningPath = path.join(this.brudDir, 'WARNING.txt');
    const warningExists = await this.fileSystem.exists(warningPath);
    if (!warningExists) {
      await this.fileSystem.writeFile(
        warningPath,
        'This directory is managed by Brud Code.\n' +
        'It contains workspace history, session snapshots, and revert data.\n' +
        'Do not modify or delete this directory manually.\n' +
        'Brud Code uses this data to provide revert functionality and session history.\n',
      );
    }
  }

  private async updateVscodeSettings(): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration('files', null);
      const currentExclude = config.get<Record<string, boolean>>('exclude', {});
      if (!currentExclude['.brud']) {
        await config.update('exclude', { ...currentExclude, '.brud': true }, vscode.ConfigurationTarget.Workspace);
      }

      const currentWatcherExclude = config.get<Record<string, boolean>>('watcherExclude', {});
      if (!currentWatcherExclude['.brud']) {
        await config.update('watcherExclude', { ...currentWatcherExclude, '.brud': true }, vscode.ConfigurationTarget.Workspace);
      }

      const searchConfig = vscode.workspace.getConfiguration('search', null);
      const currentSearchExclude = searchConfig.get<Record<string, boolean>>('exclude', {});
      if (!currentSearchExclude['.brud']) {
        await searchConfig.update('exclude', { ...currentSearchExclude, '.brud': true }, vscode.ConfigurationTarget.Workspace);
      }
    } catch {
      // VS Code settings update is best-effort
    }
  }

  private async updateGitignore(): Promise<void> {
    try {
      const gitignorePath = path.join(this.workspaceRoot, '.gitignore');
      const gitignoreExists = await this.fileSystem.exists(gitignorePath);

      let content = '';
      if (gitignoreExists) {
        content = await this.fileSystem.readFile(gitignorePath);
      }

      if (!content.includes('.brud/')) {
        content += '\n# Brud Code workspace history\n.brud/\n';
        await this.fileSystem.writeFile(gitignorePath, content);
      }
    } catch {
      // Gitignore update is best-effort
    }
  }

  private get cleanupStateFile(): string {
    return path.join(this.historyDir, 'cleanup.json');
  }

  private async getCleanupState(): Promise<{ lastCleanup: string | null }> {
    const exists = await this.fileSystem.exists(this.cleanupStateFile);
    if (!exists) {
      return { lastCleanup: null };
    }
    const raw = await this.fileSystem.readFile(this.cleanupStateFile);
    return JSON.parse(raw);
  }

  private async updateCleanupState(): Promise<void> {
    const state = { lastCleanup: new Date().toISOString() };
    await this.fileSystem.writeFile(this.cleanupStateFile, JSON.stringify(state, null, 2));
  }

  private async isCleanupDue(): Promise<boolean> {
    const state = await this.getCleanupState();
    if (state.lastCleanup === null) {
      return true;
    }
    const lastCleanup = new Date(state.lastCleanup);
    const today = new Date();
    return lastCleanup.getDate() !== today.getDate() ||
      lastCleanup.getMonth() !== today.getMonth() ||
      lastCleanup.getFullYear() !== today.getFullYear();
  }

  async runRetentionCleanup(): Promise<number> {
    if (!(await this.isCleanupDue())) {
      return 0;
    }
    const deleted = await this.cleanupOldSessions(3);
    await this.updateCleanupState();
    return deleted;
  }

  async saveSession(entry: HistoryEntry): Promise<void> {
    if (!this.brudDirEnsured) {
      await this.ensureBrudDirectory();
    }

    await this.runRetentionCleanup();

    await this.updateVscodeSettings();
    await this.updateGitignore();
    await this.ensureWarningFile();

    const { session, preSnapshot, postSnapshot } = entry;
    const dir = this.sessionDir(session.sessionId);

    await this.fileSystem.createDirectory(dir);

    await this.fileSystem.writeFile(
      this.sessionFile(session.sessionId),
      JSON.stringify(session, null, 2),
    );

    const preData = {
      ...preSnapshot,
      files: this.mapToObject(preSnapshot.files),
    };
    await this.fileSystem.writeFile(
      this.preFile(session.sessionId),
      JSON.stringify(preData, null, 2),
    );

    const postData = {
      ...postSnapshot,
      files: this.mapToObject(postSnapshot.files),
    };
    await this.fileSystem.writeFile(
      this.postFile(session.sessionId),
      JSON.stringify(postData, null, 2),
    );
  }

  async getSession(sessionId: string): Promise<HistoryEntry | undefined> {
    const sessionPath = this.sessionFile(sessionId);
    const prePath = this.preFile(sessionId);
    const postPath = this.postFile(sessionId);

    const sessionExists = await this.fileSystem.exists(sessionPath);
    if (!sessionExists) {
      return undefined;
    }

    const [sessionRaw, preRaw, postRaw] = await Promise.all([
      this.fileSystem.readFile(sessionPath),
      this.fileSystem.readFile(prePath),
      this.fileSystem.readFile(postPath),
    ]);

    const session: HistorySession = JSON.parse(sessionRaw);
    const preData = JSON.parse(preRaw);
    const postData = JSON.parse(postRaw);

    const preSnapshot: SnapshotData = {
      ...preData,
      files: this.objectToMap(preData.files),
    };

    const postSnapshot: SnapshotData = {
      ...postData,
      files: this.objectToMap(postData.files),
    };

    return { session, preSnapshot, postSnapshot };
  }

  async getAllSessions(): Promise<HistorySession[]> {
    const sessionsDirExists = await this.fileSystem.exists(this.sessionsDir);
    if (!sessionsDirExists) {
      return [];
    }

    const entries = await this.fileSystem.listDirectoryContents(this.sessionsDir);
    const sessionDirs = entries.filter(e => e.isDirectory).map(e => e.name);

    const sessions: HistorySession[] = [];

    for (const dir of sessionDirs) {
      try {
        const raw = await this.fileSystem.readFile(this.sessionFile(dir));
        const session: HistorySession = JSON.parse(raw);
        sessions.push(session);
      } catch {
        // Skip invalid/malformed session directories
      }
    }

    sessions.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    return sessions;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.fileSystem.deleteDirectoryRecursive(this.sessionDir(sessionId));
  }

  async getSessionsByDateRange(start: Date, end: Date): Promise<HistorySession[]> {
    const all = await this.getAllSessions();
    return all.filter(session => {
      const ts = new Date(session.timestamp).getTime();
      return ts >= start.getTime() && ts <= end.getTime();
    });
  }

  async getRecentSessions(limit: number): Promise<HistorySession[]> {
    const all = await this.getAllSessions();
    return all.slice(0, limit);
  }

  async cleanupOldSessions(retentionMonths: number): Promise<number> {
    const all = await this.getAllSessions();
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - retentionMonths);
    const cutoffTime = cutoff.getTime();

    const deletedSessions: Array<{ sessionId: string; createdAt: string }> = [];

    for (const session of all) {
      if (new Date(session.timestamp).getTime() < cutoffTime) {
        deletedSessions.push({ sessionId: session.sessionId, createdAt: session.timestamp });
        await this.deleteSession(session.sessionId);
      }
    }

    if (deletedSessions.length > 0) {
      await this.recordDeleteHistory({
        deletedCount: deletedSessions.length,
        deletedSessions,
        reason: 'retention_cleanup',
        triggeredBy: 'system',
      });
    }

    return deletedSessions.length;
  }

  async wipeAllHistory(): Promise<number> {
    const sessionsDirExists = await this.fileSystem.exists(this.sessionsDir);
    if (!sessionsDirExists) {
      return 0;
    }

    const entries = await this.fileSystem.listDirectoryContents(this.sessionsDir);
    const sessionDirs = entries.filter(e => e.isDirectory).map(e => e.name);

    const deletedSessions: Array<{ sessionId: string; createdAt: string }> = [];

    for (const dir of sessionDirs) {
      try {
        const sessionPath = this.sessionFile(dir);
        if (await this.fileSystem.exists(sessionPath)) {
          const raw = await this.fileSystem.readFile(sessionPath);
          const session: HistorySession = JSON.parse(raw);
          deletedSessions.push({ sessionId: session.sessionId, createdAt: session.timestamp });
        } else {
          deletedSessions.push({ sessionId: dir, createdAt: '' });
        }
      } catch {
        deletedSessions.push({ sessionId: dir, createdAt: '' });
      }
      await this.fileSystem.deleteDirectoryRecursive(this.sessionDir(dir));
    }

    await this.fileSystem.deleteDirectoryRecursive(this.sessionsDir);

    if (deletedSessions.length > 0) {
      await this.recordDeleteHistory({
        deletedCount: deletedSessions.length,
        deletedSessions,
        reason: 'manual_wipe',
        triggeredBy: 'user',
        confirmationPhrase: 'DELETE ALL HISTORY',
      });
    }

    return sessionDirs.length;
  }

  async revertSession(sessionId: string, targetState: 'pre' | 'post'): Promise<RevertResult> {
    const entry = await this.getSession(sessionId);
    if (!entry) {
      return {
        success: false,
        message: `Session ${sessionId} not found`,
        errors: [`Session ${sessionId} does not exist in history`],
        filesRestored: [],
      };
    }

    const result = await revertSession(
      entry,
      targetState,
      this.fileSystem,
      getWorkspaceFolders(),
      (revertEntry) => {
        this.saveRevertHistory(sessionId, revertEntry).catch(() => {});
      },
    );

    return result;
  }

  async saveRevertHistory(sessionId: string, entry: RevertHistoryEntry): Promise<void> {
    const revertsPath = this.revertsFile(sessionId);
    let reverts: RevertHistoryEntry[] = [];

    if (await this.fileSystem.exists(revertsPath)) {
      const raw = await this.fileSystem.readFile(revertsPath);
      try {
        const existing = JSON.parse(raw);
        if (Array.isArray(existing)) {
          reverts = existing;
        }
      } catch {
        // If file is corrupt, start fresh
      }
    }

    reverts.push(entry);
    await this.fileSystem.writeFile(revertsPath, JSON.stringify(reverts, null, 2));
  }

  async getRevertHistory(sessionId: string): Promise<RevertHistory> {
    const revertsPath = this.revertsFile(sessionId);
    let reverts: RevertHistoryEntry[] = [];

    if (await this.fileSystem.exists(revertsPath)) {
      const raw = await this.fileSystem.readFile(revertsPath);
      try {
        const existing = JSON.parse(raw);
        if (Array.isArray(existing)) {
          reverts = existing;
        }
      } catch {
        // If file is corrupt, return empty history
      }
    }

    return {
      sessionId,
      reverts,
    };
  }
}