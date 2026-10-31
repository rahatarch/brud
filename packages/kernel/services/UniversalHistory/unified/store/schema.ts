/**
 * `universal.db` schema, migrations, and connection settings (D-15, U-2).
 *
 * Every table is STRICT. JSON columns are TEXT guarded by `json_valid`.
 * Migrations are forward-only and transactional.
 */
import type { DatabaseSync } from 'node:sqlite';

export const UNIFIED_SCHEMA_VERSION = 2;

export const UNIFIED_BUSY_TIMEOUT_MS = 5_000;

interface Migration {
  readonly version: number;
  readonly statements: readonly string[];
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE entry_types (
        namespace      TEXT    NOT NULL,
        type           TEXT    NOT NULL,
        schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
        payload_schema TEXT    NOT NULL CHECK (json_valid(payload_schema)),
        reversal_mode  TEXT    NOT NULL CHECK (reversal_mode IN ('none','inverse-payload','handler')),
        registered_by  TEXT    NOT NULL,
        registered_at  INTEGER NOT NULL,
        PRIMARY KEY (namespace, type, schema_version)
      ) STRICT`,
      `CREATE TABLE sessions (
        session_id  TEXT    PRIMARY KEY,
        created_at  INTEGER NOT NULL,
        prompt      TEXT    NOT NULL,
        status      TEXT    NOT NULL CHECK (status IN ('active','committed','aborted','reverted')),
        origin      TEXT    NOT NULL DEFAULT 'human',
        implicit    INTEGER NOT NULL DEFAULT 0 CHECK (implicit IN (0,1)),
        closed_at   INTEGER,
        is_deleted  INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0,1)),
        deleted_at  INTEGER,
        expires_at  INTEGER,
        metadata    TEXT    CHECK (metadata IS NULL OR json_valid(metadata))
      ) STRICT`,
      'CREATE INDEX idx_sessions_created ON sessions(created_at DESC, session_id DESC)',
      'CREATE INDEX idx_sessions_status ON sessions(status, created_at DESC, session_id DESC)',
      'CREATE TABLE session_sequence (day TEXT PRIMARY KEY, next INTEGER NOT NULL) STRICT',
      `CREATE TABLE contents (
        sha256      TEXT    PRIMARY KEY CHECK (length(sha256) = 64),
        size        INTEGER NOT NULL CHECK (size >= 0),
        inline_data BLOB,
        blob_ref    TEXT,
        created_at  INTEGER NOT NULL,
        CHECK ((inline_data IS NULL) <> (blob_ref IS NULL))
      ) STRICT`,
      `CREATE TABLE entries (
        seq             INTEGER PRIMARY KEY,
        entry_id        TEXT    NOT NULL UNIQUE,
        session_id      TEXT    NOT NULL REFERENCES sessions(session_id),
        namespace       TEXT    NOT NULL,
        type            TEXT    NOT NULL,
        schema_version  INTEGER NOT NULL,
        payload         TEXT    CHECK (payload IS NULL OR json_valid(payload)),
        payload_sha256  TEXT    REFERENCES contents(sha256),
        inverse_payload TEXT    CHECK (inverse_payload IS NULL OR json_valid(inverse_payload)),
        created_at      INTEGER NOT NULL,
        file_path       TEXT GENERATED ALWAYS AS (
                          CASE WHEN namespace = 'brud.core' AND type = 'file'
                               THEN json_extract(payload, '$.path') END) VIRTUAL,
        CHECK ((payload IS NULL) <> (payload_sha256 IS NULL)),
        FOREIGN KEY (namespace, type, schema_version)
          REFERENCES entry_types(namespace, type, schema_version)
      ) STRICT`,
      'CREATE INDEX idx_entries_session ON entries(session_id, seq)',
      'CREATE INDEX idx_entries_type ON entries(namespace, type, seq)',
      'CREATE INDEX idx_entries_path ON entries(file_path, seq) WHERE file_path IS NOT NULL',
      `CREATE TABLE checkpoints (
        checkpoint_id TEXT    PRIMARY KEY,
        session_id    TEXT    NOT NULL REFERENCES sessions(session_id),
        label         TEXT    NOT NULL,
        seq_offset    INTEGER NOT NULL,
        created_at    INTEGER NOT NULL,
        metadata      TEXT    CHECK (metadata IS NULL OR json_valid(metadata))
      ) STRICT`,
      'CREATE INDEX idx_checkpoints_session ON checkpoints(session_id, created_at DESC)',
      `CREATE TABLE reversals (
        reversal_id      TEXT    PRIMARY KEY,
        session_id       TEXT    REFERENCES sessions(session_id),
        kind             TEXT    NOT NULL CHECK (kind IN ('session','undo','redo','checkpoint')),
        target_state     TEXT,
        executed_at      INTEGER NOT NULL,
        status           TEXT    NOT NULL,
        reverted_entries TEXT    NOT NULL CHECK (json_valid(reverted_entries)),
        error_message    TEXT
      ) STRICT`,
      'CREATE INDEX idx_reversals_session ON reversals(session_id)',
      'CREATE TABLE history_state (state_key TEXT PRIMARY KEY, value INTEGER NOT NULL) STRICT',
      `CREATE TABLE imports (
        source        TEXT    PRIMARY KEY,
        source_sha256 TEXT    NOT NULL,
        imported_at   INTEGER NOT NULL,
        rows          INTEGER NOT NULL
      ) STRICT`,
    ],
  },
  {
    // D-15 U-8: deleting a `contents` row checks the `entries.payload_sha256`
    // foreign key; without this index every delete scans all entries.
    version: 2,
    statements: [
      'CREATE INDEX idx_entries_payload_sha256 ON entries(payload_sha256)',
    ],
  },
];

/** Applies connection pragmas. WAL is only requested on writable connections. */
export function configureConnection(db: DatabaseSync, writable: boolean): void {
  db.exec(`PRAGMA busy_timeout = ${UNIFIED_BUSY_TIMEOUT_MS}`);
  db.exec('PRAGMA foreign_keys = ON');
  if (writable) {
    try {
      db.exec('PRAGMA journal_mode = WAL');
    } catch {
      // In-memory databases keep their journal mode.
    }
    db.exec('PRAGMA synchronous = NORMAL');
  }
}

function ensureMigrationTable(db: DatabaseSync): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT');
}

/** Highest applied migration, or 0 for a fresh or non-unified database. */
export function readSchemaVersion(db: DatabaseSync): number {
  const exists = db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  if (exists === undefined) {
    return 0;
  }
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null } | undefined;
  return typeof row?.version === 'number' ? row.version : 0;
}

/**
 * Applies every pending migration, each inside its own `BEGIN IMMEDIATE`.
 *
 * The applied version is re-read after the write lock is taken: two processes
 * opening a fresh database at the same time both see version 0 before
 * locking, and only the first may run the migration.
 */
export function applyMigrations(db: DatabaseSync, now: number): void {
  ensureMigrationTable(db);

  for (const migration of MIGRATIONS) {
    if (migration.version <= readSchemaVersion(db)) {
      continue;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      if (migration.version <= readSchemaVersion(db)) {
        db.exec('COMMIT');
        continue;
      }
      for (const statement of migration.statements) {
        db.exec(statement);
      }
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(migration.version, now);
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // SQLite may already have rolled back.
      }
      throw error;
    }
  }
}
