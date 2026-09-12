import * as path from 'path';
import { NodeFileSystem } from './nodeFileSystem.js';
import type { HistoryStore } from '../history/store.js';
import type { HistoryEntry, HistorySession, RevertHistoryEntry } from '../history/types.js';

export class TestHistoryStore implements HistoryStore {
  private sessionsDir: string;
  private fs: NodeFileSystem;

  constructor(baseDir: string, fs: NodeFileSystem) {
    this.sessionsDir = path.join(baseDir, '.brud', 'history', 'sessions');
    this.fs = fs;
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

  async deleteSingleSession(_sessionId: string, _triggeredBy: 'user' | 'system', _permanentDelete?: boolean): Promise<number> {
    await this.deleteSession(_sessionId);
    return 1;
  }

  async getSessionsByDateRange(_start: Date, _end: Date): Promise<HistorySession[]> {
    return [];
  }

  async getRecentSessions(_limit: number): Promise<HistorySession[]> {
    return [];
  }

  async cleanupOldSessions(_retentionMonths: number): Promise<number> {
    return 0;
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
    session.isDeleted = true;
    session.deletedAt = new Date().toISOString();
    session.deletedBy = deletedBy;
    session.deleteReason = reason;
    session.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await this.fs.writeFile(sessionPath, JSON.stringify(session, null, 2));
  }

  async restoreSession(sessionId: string): Promise<void> {
    const sessionPath = this.sessionFile(sessionId);
    if (!(await this.fs.exists(sessionPath))) return;
    const raw = await this.fs.readFile(sessionPath);
    const session: HistorySession = JSON.parse(raw);
    session.isDeleted = false;
    session.deletedAt = undefined;
    session.expiresAt = undefined;
    session.deletedBy = undefined;
    session.deleteReason = undefined;
    await this.fs.writeFile(sessionPath, JSON.stringify(session, null, 2));
  }

  async getTrashedSessions(): Promise<HistorySession[]> {
    const sessionsDirExists = await this.fs.exists(this.sessionsDir);
    if (!sessionsDirExists) return [];
    const entries = await this.fs.listDirectoryContents(this.sessionsDir);
    const sessionDirs = entries.filter(e => e.isDirectory).map(e => e.name);
    const sessions: HistorySession[] = [];
    for (const dir of sessionDirs) {
      try {
        const raw = await this.fs.readFile(this.sessionFile(dir));
        const session: HistorySession = JSON.parse(raw);
        if (session.isDeleted) {
          sessions.push(session);
        }
      } catch {
        // skip invalid
      }
    }
    return sessions;
  }

  async getExpiredSessions(): Promise<HistorySession[]> {
    const sessionsDirExists = await this.fs.exists(this.sessionsDir);
    if (!sessionsDirExists) return [];
    const entries = await this.fs.listDirectoryContents(this.sessionsDir);
    const sessionDirs = entries.filter(e => e.isDirectory).map(e => e.name);
    const now = new Date();
    const sessions: HistorySession[] = [];
    for (const dir of sessionDirs) {
      try {
        const raw = await this.fs.readFile(this.sessionFile(dir));
        const session: HistorySession = JSON.parse(raw);
        if (session.isDeleted && session.expiresAt && new Date(session.expiresAt) <= now) {
          sessions.push(session);
        }
      } catch {
        // skip invalid
      }
    }
    return sessions;
  }
}