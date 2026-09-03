import type { HistoryEntry, HistorySession, HistoryStore, SnapshotData } from '@brud/core';
import type { FileSystem } from '@brud/core';

export class WorkspaceHistoryStore implements HistoryStore {
  constructor(
    private workspaceRoot: string,
    private fileSystem: FileSystem,
  ) {}

  private get historyDir(): string {
    return `${this.workspaceRoot}/.brud/history`;
  }

  private get sessionsDir(): string {
    return `${this.historyDir}/sessions`;
  }

  private sessionDir(sessionId: string): string {
    return `${this.sessionsDir}/${sessionId}`;
  }

  private sessionFile(sessionId: string): string {
    return `${this.sessionDir(sessionId)}/session.json`;
  }

  private preFile(sessionId: string): string {
    return `${this.sessionDir(sessionId)}/pre.json`;
  }

  private postFile(sessionId: string): string {
    return `${this.sessionDir(sessionId)}/post.json`;
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
}