import * as path from 'path';
import * as vscode from 'vscode';
import type { HistoryEntry, HistorySession, HistoryStore, SnapshotData, RevertResult } from '@brud/core';
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

  async saveSession(entry: HistoryEntry): Promise<void> {
    if (!this.brudDirEnsured) {
      await this.ensureBrudDirectory();
    }

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

    let deletedCount = 0;
    for (const session of all) {
      if (new Date(session.timestamp).getTime() < cutoffTime) {
        await this.deleteSession(session.sessionId);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  async revertSession(sessionId: string, targetState: 'pre' | 'post'): Promise<RevertResult> {
    const entry = await this.getSession(sessionId);
    if (!entry) {
      return {
        success: false,
        message: `Session ${sessionId} not found`,
        errors: [`Session ${sessionId} does not exist in history`],
      };
    }

    return revertSession(entry, targetState, this.fileSystem, getWorkspaceFolders());
  }
}