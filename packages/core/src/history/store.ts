import type { HistoryEntry, HistorySession, RevertHistoryEntry, RevertHistory } from './types.js';

export interface HistoryStore {
  saveSession(entry: HistoryEntry): Promise<void>;
  getSession(sessionId: string): Promise<HistoryEntry | undefined>;
  getAllSessions(): Promise<HistorySession[]>;
  deleteSession(sessionId: string): Promise<void>;
  deleteSingleSession(sessionId: string, triggeredBy: 'user' | 'system', permanentDelete?: boolean): Promise<number>;
  getSessionsByDateRange(start: Date, end: Date): Promise<HistorySession[]>;
  getRecentSessions(limit: number): Promise<HistorySession[]>;
  cleanupOldSessions(retentionMonths: number): Promise<number>;
  wipeAllHistory(permanentDelete?: boolean): Promise<number>;
  saveRevertHistory(sessionId: string, entry: RevertHistoryEntry): Promise<void>;
  getRevertHistory(sessionId: string): Promise<RevertHistory>;
  softDeleteSession(sessionId: string, deletedBy: 'user' | 'system', reason: 'manual_delete' | 'manual_wipe' | 'retention_cleanup'): Promise<void>;
  restoreSession(sessionId: string): Promise<void>;
  getTrashedSessions(): Promise<HistorySession[]>;
  getExpiredSessions(): Promise<HistorySession[]>;
}