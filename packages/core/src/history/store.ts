import type { HistoryEntry, HistorySession } from './types.js';

export interface HistoryStore {
  saveSession(entry: HistoryEntry): Promise<void>;
  getSession(sessionId: string): Promise<HistoryEntry | undefined>;
  getAllSessions(): Promise<HistorySession[]>;
  deleteSession(sessionId: string): Promise<void>;
  getSessionsByDateRange(start: Date, end: Date): Promise<HistorySession[]>;
  getRecentSessions(limit: number): Promise<HistorySession[]>;
  cleanupOldSessions(retentionMonths: number): Promise<number>;
}