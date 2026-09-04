import type { HistoryEntry, HistorySession, RevertHistoryEntry, RevertHistory } from './types.js';

export interface HistoryStore {
  saveSession(entry: HistoryEntry): Promise<void>;
  getSession(sessionId: string): Promise<HistoryEntry | undefined>;
  getAllSessions(): Promise<HistorySession[]>;
  deleteSession(sessionId: string): Promise<void>;
  getSessionsByDateRange(start: Date, end: Date): Promise<HistorySession[]>;
  getRecentSessions(limit: number): Promise<HistorySession[]>;
  cleanupOldSessions(retentionMonths: number): Promise<number>;
  wipeAllHistory(): Promise<number>;
  saveRevertHistory(sessionId: string, entry: RevertHistoryEntry): Promise<void>;
  getRevertHistory(sessionId: string): Promise<RevertHistory>;
}