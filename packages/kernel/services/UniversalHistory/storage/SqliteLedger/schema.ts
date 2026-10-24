import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';

/** Version of the ledger schema produced by {@link applySchema}. */
export const SCHEMA_VERSION = 1;

/** Bookkeeping table tracking which migrations have been applied. */
export const MIGRATION_TABLE = 'schema_migrations';

/** A single forward-only schema migration. */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

/** Ordered migrations applied by {@link applySchema}. */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial_ledger',
    statements: [
      `CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        files_affected TEXT NOT NULL,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        expires_at TEXT
      )`,
      'CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_sessions_is_deleted ON sessions(is_deleted)',
      `CREATE TABLE IF NOT EXISTS session_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        relative_path TEXT NOT NULL,
        pre_sha256 TEXT NOT NULL,
        post_sha256 TEXT NOT NULL,
        diff_content TEXT,
        blob_sha256 TEXT,
        is_binary INTEGER NOT NULL DEFAULT 0
      )`,
      'CREATE INDEX IF NOT EXISTS idx_session_files_session ON session_files(session_id)',
      'CREATE INDEX IF NOT EXISTS idx_session_files_path ON session_files(relative_path)',
      `CREATE TABLE IF NOT EXISTS reversals (
        reversal_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        target_state TEXT NOT NULL,
        executed_at TEXT NOT NULL,
        status TEXT NOT NULL,
        reverted_operations TEXT NOT NULL,
        error_message TEXT
      )`,
      'CREATE INDEX IF NOT EXISTS idx_reversals_session ON reversals(session_id)',
    ],
  },
];

/**
 * Applies connection-level PRAGMAs required by the ledger.
 *
 * Write-ahead logging is unavailable for in-memory databases, which keep the
 * `memory` journal mode; that case is accepted rather than treated as an
 * error.
 *
 * @param db - Open database connection.
 */
export function configureConnection(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA synchronous = NORMAL;');

  try {
    db.exec('PRAGMA journal_mode = WAL;');
  } catch {
    // In-memory and read-only databases cannot switch to WAL; keep their mode.
  }
}

function readVersion(row: Record<string, SQLOutputValue>): number {
  const value = row.version;

  if (typeof value !== 'number') {
    throw new TypeError('schema_migrations.version must be an integer');
  }

  return value;
}

/**
 * Lists the migration versions already recorded in the database.
 *
 * @param db - Open database connection.
 * @returns Ascending applied migration versions.
 */
export function getAppliedMigrations(db: DatabaseSync): readonly number[] {
  const rows = db
    .prepare(`SELECT version FROM ${MIGRATION_TABLE} ORDER BY version ASC`)
    .all();

  return rows.map(readVersion);
}

function ensureMigrationTable(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
}

function applyMigration(db: DatabaseSync, migration: Migration): void {
  db.exec('BEGIN IMMEDIATE');

  try {
    for (const statement of migration.statements) {
      db.exec(statement);
    }

    db.prepare(`INSERT INTO ${MIGRATION_TABLE} (version, applied_at) VALUES (?, ?)`).run(
      migration.version,
      new Date().toISOString(),
    );

    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // SQLite may have already rolled the transaction back before throwing.
    }

    throw error;
  }
}

/**
 * Creates the ledger schema, applies pending migrations, and records each
 * applied version in `schema_migrations`.
 *
 * The function is idempotent: reopening an existing database skips migrations
 * that already ran.
 *
 * @param db - Open database connection.
 */
export function applySchema(db: DatabaseSync): void {
  configureConnection(db);
  ensureMigrationTable(db);

  const applied = new Set(getAppliedMigrations(db));

  for (const migration of MIGRATIONS) {
    if (!applied.has(migration.version)) {
      applyMigration(db, migration);
    }
  }
}
