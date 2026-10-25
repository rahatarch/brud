/**
 * Schema for the journal-driven history ledger.
 *
 * The required tables (`sessions`, `checkpoints`, `mutations`) follow the
 * Phase 4 contract. Two support tables are added:
 *
 * - `contents` deduplicates payload snapshots by SHA-256 so a restored state
 *   can be resolved from either an inline blob or an offloaded file.
 * - `history_state` holds the global undo/redo cursor used to truncate redo
 *   history when a new mutation is recorded.
 */
export const HISTORY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  label TEXT NOT NULL,
  ledger_offset INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS mutations (
  mutation_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  path TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  updated_hash TEXT NOT NULL,
  inline_data BLOB,
  blob_ref TEXT,
  metadata TEXT,
  seq INTEGER NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_mutations_seq ON mutations(seq DESC);
CREATE INDEX IF NOT EXISTS idx_mutations_session_seq ON mutations(session_id, seq DESC);
CREATE INDEX IF NOT EXISTS idx_mutations_path ON mutations(path);
CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS contents (
  sha256 TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  inline_data BLOB,
  blob_ref TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS history_state (
  state_key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
`;

/** Key of the global undo/redo cursor inside `history_state`. */
export const UNDO_CURSOR_KEY = 'undo_cursor';
