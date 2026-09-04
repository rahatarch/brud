export type { HistorySession, SnapshotType, SnapshotData, HistoryEntry, RevertHistoryEntry, RevertHistory, DeleteHistoryEntry, DeleteHistory } from './types.js';
export type { HistoryStore } from './store.js';
export { generateSessionId, parseSessionId, getNextSequenceNumber } from './sessionId.js';
export { recordSession, createSnapshot, recordAndSaveSession } from './recorder.js';
export { revertSession, revertOperations } from './revert.js';
export type { RevertResult } from './revert.js';