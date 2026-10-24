import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, posix, win32 } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  SQLInputValue,
  SQLOutputValue,
  StatementResultingChanges,
  StatementSync,
} from 'node:sqlite';
import { applySchema } from './schema.js';
import {
  isReversalStatus,
  isReversalTargetState,
  isSessionStatus,
} from './types.js';
import type {
  LedgerQueryFilter,
  ReversalInsertRow,
  ReversalRow,
  SessionFileInsertParams,
  SessionFileInsertRow,
  SessionFileRow,
  SessionInsertRow,
  SessionRow,
  SessionWithFiles,
  SoftDeleteOptions,
  SqliteLedgerOptions,
} from './types.js';

/** Path segment that opens an anonymous in-memory database. */
export const IN_MEMORY_DB_PATH = ':memory:';

const SESSION_COLUMNS = [
  'session_id',
  'created_at',
  'prompt',
  'status',
  'files_affected',
  'is_deleted',
  'deleted_at',
  'expires_at',
].join(', ');

const SESSION_FILE_COLUMNS = [
  'id',
  'session_id',
  'relative_path',
  'pre_sha256',
  'post_sha256',
  'diff_content',
  'blob_sha256',
  'is_binary',
].join(', ');

const REVERSAL_COLUMNS = [
  'reversal_id',
  'session_id',
  'target_state',
  'executed_at',
  'status',
  'reverted_operations',
  'error_message',
].join(', ');

const SQL_INSERT_SESSION = `INSERT INTO sessions (${SESSION_COLUMNS})
  VALUES (?, ?, ?, ?, ?, 0, NULL, NULL)`;

const SQL_SELECT_SESSION = `SELECT ${SESSION_COLUMNS} FROM sessions WHERE session_id = ?`;

const SQL_INSERT_SESSION_FILE = `INSERT INTO session_files (${SESSION_FILE_COLUMNS})
  VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)`;

const SQL_SELECT_SESSION_FILES =
  `SELECT ${SESSION_FILE_COLUMNS} FROM session_files WHERE session_id = ? ORDER BY id ASC`;

const SQL_COMMIT_SESSION =
  "UPDATE sessions SET status = 'committed' WHERE session_id = ?";

const SQL_MARK_SESSION_REVERTED =
  "UPDATE sessions SET status = 'reverted' WHERE session_id = ?";

const SQL_MARK_SESSION_ABORTED =
  "UPDATE sessions SET status = 'aborted' WHERE session_id = ?";

const SQL_SOFT_DELETE_SESSION = `UPDATE sessions
  SET is_deleted = 1, deleted_at = ?, expires_at = ?
  WHERE session_id = ? AND is_deleted = 0`;

const SQL_RESTORE_SESSION = `UPDATE sessions
  SET is_deleted = 0, deleted_at = NULL, expires_at = NULL
  WHERE session_id = ? AND is_deleted = 1`;

const SQL_SELECT_EXPIRED_SESSIONS = `SELECT session_id FROM sessions
  WHERE is_deleted = 1 AND expires_at IS NOT NULL AND expires_at <= ?
  ORDER BY expires_at ASC, session_id ASC`;

const SQL_DELETE_SESSION = 'DELETE FROM sessions WHERE session_id = ?';

const SQL_REVERSAL_EXISTS = 'SELECT 1 AS present FROM sessions WHERE session_id = ?';

const SQL_INSERT_REVERSAL = `INSERT INTO reversals (${REVERSAL_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`;

const SQL_SELECT_REVERSALS = `SELECT ${REVERSAL_COLUMNS} FROM reversals
  WHERE session_id = ? ORDER BY executed_at ASC, reversal_id ASC`;

const NULL_BYTE_PATTERN = /\0/u;
const BACKSLASH_PATTERN = /\\/gu;
const TRAILING_SEPARATOR_PATTERN = /\/+$/u;
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:/u;

/** Reasons a stored path is rejected before it reaches the database. */
export type InvalidLedgerPathReason =
  | 'EMPTY_PATH'
  | 'NULL_BYTE'
  | 'ABSOLUTE_PATH'
  | 'PARENT_TRAVERSAL';

/** Thrown when a path is not a canonical workspace-relative path. */
export class InvalidLedgerPathError extends Error {
  readonly path: string;

  readonly reason: InvalidLedgerPathReason;

  constructor(path: string, reason: InvalidLedgerPathReason) {
    super(`Invalid ledger path "${path}" (${reason})`);
    this.name = 'InvalidLedgerPathError';
    this.path = path;
    this.reason = reason;
  }
}

/** Thrown when a persisted column value fails validation. */
export class InvalidLedgerValueError extends Error {
  readonly field: string;

  readonly reason: string;

  constructor(field: string, reason: string) {
    super(`Invalid ledger value for "${field}": ${reason}`);
    this.name = 'InvalidLedgerValueError';
    this.field = field;
    this.reason = reason;
  }
}

/** Thrown when an operation targets a session that does not exist. */
export class SessionNotFoundError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = 'SessionNotFoundError';
    this.sessionId = sessionId;
  }
}

/** Thrown when a closed ledger is used again. */
export class LedgerClosedError extends Error {
  constructor() {
    super('The SQLite ledger connection is closed');
    this.name = 'LedgerClosedError';
  }
}

/**
 * Normalizes a workspace-relative path, rejecting empty values, null bytes,
 * absolute paths, drive qualifiers, and parent traversal.
 *
 * @param candidate - Path supplied by a caller.
 * @returns Canonical POSIX-style relative path.
 */
export function toWorkspaceRelativePath(candidate: string): string {
  if (candidate.length === 0) {
    throw new InvalidLedgerPathError(candidate, 'EMPTY_PATH');
  }

  if (NULL_BYTE_PATTERN.test(candidate)) {
    throw new InvalidLedgerPathError(candidate, 'NULL_BYTE');
  }

  const unified = candidate
    .replace(BACKSLASH_PATTERN, '/')
    .replace(TRAILING_SEPARATOR_PATTERN, '');

  if (unified.length === 0) {
    throw new InvalidLedgerPathError(candidate, 'EMPTY_PATH');
  }

  if (posix.isAbsolute(unified) || win32.isAbsolute(unified) || WINDOWS_DRIVE_PATTERN.test(unified)) {
    throw new InvalidLedgerPathError(candidate, 'ABSOLUTE_PATH');
  }

  const normalized = posix.normalize(unified);

  if (normalized === '.') {
    throw new InvalidLedgerPathError(candidate, 'EMPTY_PATH');
  }

  if (normalized === '..' || normalized.startsWith('../')) {
    throw new InvalidLedgerPathError(candidate, 'PARENT_TRAVERSAL');
  }

  return normalized;
}

function assertTimestamp(value: string, field: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new InvalidLedgerValueError(field, `"${value}" is not an ISO 8601 timestamp`);
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (value.length === 0) {
    throw new InvalidLedgerValueError(field, 'must be a non-empty string');
  }
}

function normalizeFlag(value: number, field: string): number {
  if (value !== 0 && value !== 1) {
    throw new InvalidLedgerValueError(field, `must be 0 or 1, received ${value}`);
  }

  return value;
}

function parseStringArray(raw: string, field: string): readonly string[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InvalidLedgerValueError(field, 'must be a JSON array of strings');
  }

  if (!Array.isArray(parsed)) {
    throw new InvalidLedgerValueError(field, 'must be a JSON array of strings');
  }

  const items: readonly unknown[] = parsed;
  const values: string[] = [];

  for (const item of items) {
    if (typeof item !== 'string') {
      throw new InvalidLedgerValueError(field, 'must be a JSON array of strings');
    }

    values.push(item);
  }

  return values;
}

function serializeStringArray(raw: string, field: string): string {
  return JSON.stringify(parseStringArray(raw, field));
}

function serializePathArray(raw: string, field: string): string {
  return JSON.stringify(
    parseStringArray(raw, field).map((path) => toWorkspaceRelativePath(path)),
  );
}

function outputValue(row: Record<string, SQLOutputValue>, column: string): SQLOutputValue {
  if (!Object.hasOwn(row, column)) {
    throw new TypeError(`Result row is missing the "${column}" column`);
  }

  return row[column];
}

function readString(row: Record<string, SQLOutputValue>, column: string): string {
  const value = outputValue(row, column);

  if (typeof value !== 'string') {
    throw new TypeError(`Column "${column}" must be a string`);
  }

  return value;
}

function readNullableString(
  row: Record<string, SQLOutputValue>,
  column: string,
): string | null {
  const value = outputValue(row, column);

  if (value === null || typeof value === 'string') {
    return value;
  }

  throw new TypeError(`Column "${column}" must be a string or null`);
}

function readNumber(row: Record<string, SQLOutputValue>, column: string): number {
  const value = outputValue(row, column);

  if (typeof value !== 'number') {
    throw new TypeError(`Column "${column}" must be a number`);
  }

  return value;
}

function readSessionStatus(row: Record<string, SQLOutputValue>): SessionRow['status'] {
  const value = readString(row, 'status');

  if (!isSessionStatus(value)) {
    throw new TypeError(`Column "status" contains an unsupported value: "${value}"`);
  }

  return value;
}

function readReversalTargetState(row: Record<string, SQLOutputValue>): ReversalRow['target_state'] {
  const value = readString(row, 'target_state');

  if (!isReversalTargetState(value)) {
    throw new TypeError(`Column "target_state" contains an unsupported value: "${value}"`);
  }

  return value;
}

function readReversalStatus(row: Record<string, SQLOutputValue>): ReversalRow['status'] {
  const value = readString(row, 'status');

  if (!isReversalStatus(value)) {
    throw new TypeError(`Column "status" contains an unsupported value: "${value}"`);
  }

  return value;
}

function toSessionRow(row: Record<string, SQLOutputValue>): SessionRow {
  return {
    session_id: readString(row, 'session_id'),
    created_at: readString(row, 'created_at'),
    prompt: readString(row, 'prompt'),
    status: readSessionStatus(row),
    files_affected: readString(row, 'files_affected'),
    is_deleted: readNumber(row, 'is_deleted'),
    deleted_at: readNullableString(row, 'deleted_at'),
    expires_at: readNullableString(row, 'expires_at'),
  };
}

function toSessionFileRow(row: Record<string, SQLOutputValue>): SessionFileRow {
  return {
    id: readNumber(row, 'id'),
    session_id: readString(row, 'session_id'),
    relative_path: readString(row, 'relative_path'),
    pre_sha256: readString(row, 'pre_sha256'),
    post_sha256: readString(row, 'post_sha256'),
    diff_content: readNullableString(row, 'diff_content'),
    blob_sha256: readNullableString(row, 'blob_sha256'),
    is_binary: readNumber(row, 'is_binary'),
  };
}

function toReversalRow(row: Record<string, SQLOutputValue>): ReversalRow {
  return {
    reversal_id: readString(row, 'reversal_id'),
    session_id: readString(row, 'session_id'),
    target_state: readReversalTargetState(row),
    executed_at: readString(row, 'executed_at'),
    status: readReversalStatus(row),
    reverted_operations: readString(row, 'reverted_operations'),
    error_message: readNullableString(row, 'error_message'),
  };
}

function toSessionFileParams(
  sessionId: string,
  file: SessionFileInsertRow,
): SessionFileInsertParams {
  return {
    sessionId,
    relativePath: toWorkspaceRelativePath(file.relative_path),
    preSha256: file.pre_sha256,
    postSha256: file.post_sha256,
    diffContent: file.diff_content ?? null,
    blobSha256: file.blob_sha256 ?? null,
    isBinary: normalizeFlag(file.is_binary, 'is_binary'),
  };
}

function changedRows(result: StatementResultingChanges): number {
  return typeof result.changes === 'bigint' ? Number(result.changes) : result.changes;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return -1;
  }

  if (limit === Number.POSITIVE_INFINITY) {
    return -1;
  }

  if (!Number.isFinite(limit) || limit <= 0) {
    return 0;
  }

  return Math.floor(limit);
}

function normalizeOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset) || offset <= 0) {
    return 0;
  }

  return Math.floor(offset);
}

/**
 * Synchronous SQLite-backed history ledger.
 *
 * The engine owns a single `node:sqlite` connection, applies the versioned
 * schema on construction, compiles each statement once, and runs multi-row
 * mutations inside ACID transactions. Paths persisted by this driver are
 * canonical workspace-relative paths.
 */
export class SqliteLedger {
  private readonly db: DatabaseSync;

  private readonly statements = new Map<string, StatementSync>();

  private closed = false;

  constructor(options: SqliteLedgerOptions) {
    const { dbPath } = options;

    if (dbPath !== IN_MEMORY_DB_PATH) {
      if (!isAbsolute(dbPath)) {
        throw new RangeError(
          `SQLite ledger path must be ":memory:" or an absolute path: "${dbPath}"`,
        );
      }

      mkdirSync(dirname(dbPath), { recursive: true });
    }

    this.db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });

    try {
      applySchema(this.db);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  /** Inserts a new session with soft-delete columns cleared. */
  createSession(session: SessionInsertRow): void {
    this.assertOpen();
    assertNonEmpty(session.session_id, 'session_id');
    assertTimestamp(session.created_at, 'created_at');

    if (!isSessionStatus(session.status)) {
      throw new InvalidLedgerValueError('status', `"${session.status}" is not a session status`);
    }

    this.prepare(SQL_INSERT_SESSION).run(
      session.session_id,
      session.created_at,
      session.prompt,
      session.status,
      serializePathArray(session.files_affected, 'files_affected'),
    );
  }

  /**
   * Marks a session as committed and inserts every file row in one atomic
   * transaction.
   *
   * Any failure, including an invalid path or digest row, rolls the status
   * update and every inserted file back, so a session is never left committed
   * without its files.
   */
  commitSession(
    sessionId: string,
    files: readonly SessionFileInsertRow[],
  ): void {
    this.assertOpen();

    this.transaction(() => {
      const update = this.prepare(SQL_COMMIT_SESSION).run(sessionId);

      if (changedRows(update) === 0) {
        throw new SessionNotFoundError(sessionId);
      }

      const insert = this.prepare(SQL_INSERT_SESSION_FILE);

      for (const file of files) {
        const params = toSessionFileParams(sessionId, file);

        insert.run(
          params.sessionId,
          params.relativePath,
          params.preSha256,
          params.postSha256,
          params.diffContent,
          params.blobSha256,
          params.isBinary,
        );
      }
    });
  }

  /** Returns a session with its committed file rows, or `null`. */
  getSession(sessionId: string): SessionWithFiles | null {
    this.assertOpen();

    const session = this.prepare(SQL_SELECT_SESSION).get(sessionId);

    if (session === undefined) {
      return null;
    }

    const files = this.prepare(SQL_SELECT_SESSION_FILES).all(sessionId);

    return {
      session: toSessionRow(session),
      files: files.map(toSessionFileRow),
    };
  }

  /**
   * Lists sessions newest-first.
   *
   * Soft-deleted sessions are hidden unless `includeDeleted` is set.
   */
  listSessions(filter: LedgerQueryFilter = {}): readonly SessionRow[] {
    this.assertOpen();

    const limit = normalizeLimit(filter.limit);

    if (limit === 0) {
      return [];
    }

    const conditions: string[] = [];
    const params: SQLInputValue[] = [];

    if (filter.includeDeleted !== true) {
      conditions.push('is_deleted = 0');
    }

    if (filter.status !== undefined) {
      if (!isSessionStatus(filter.status)) {
        throw new InvalidLedgerValueError('status', `"${filter.status}" is not a session status`);
      }

      conditions.push('status = ?');
      params.push(filter.status);
    }

    if (filter.since !== undefined) {
      assertTimestamp(filter.since, 'since');
      conditions.push('created_at >= ?');
      params.push(filter.since);
    }

    const where = conditions.length === 0 ? '' : ` WHERE ${conditions.join(' AND ')}`;
    const sql = `SELECT ${SESSION_COLUMNS} FROM sessions${where}`
      + ' ORDER BY created_at DESC, session_id DESC LIMIT ? OFFSET ?';

    params.push(limit, normalizeOffset(filter.offset));

    return this.prepare(sql).all(...params).map(toSessionRow);
  }

  /**
   * Soft-deletes an active session and schedules its expiration.
   *
   * @returns `true` when an active session was soft-deleted.
   */
  softDeleteSession(sessionId: string, options: SoftDeleteOptions): boolean {
    this.assertOpen();
    assertTimestamp(options.deletedAt, 'deletedAt');
    assertTimestamp(options.expiresAt, 'expiresAt');

    const result = this.prepare(SQL_SOFT_DELETE_SESSION).run(
      options.deletedAt,
      options.expiresAt,
      sessionId,
    );

    return changedRows(result) > 0;
  }

  /**
   * Restores a soft-deleted session and clears its expiration.
   *
   * @returns `true` when a soft-deleted session was restored.
   */
  restoreSession(sessionId: string): boolean {
    this.assertOpen();

    return changedRows(this.prepare(SQL_RESTORE_SESSION).run(sessionId)) > 0;
  }

  /**
   * Hard-deletes soft-deleted sessions whose `expires_at` has passed.
   *
   * Dependent `session_files` and `reversals` rows are removed by the
   * cascading foreign keys.
   *
   * @param nowIso - Timestamp compared against `expires_at`.
   * @returns Identifiers of the purged sessions.
   */
  purgeExpiredSessions(nowIso: string): readonly string[] {
    this.assertOpen();
    assertTimestamp(nowIso, 'nowIso');

    const candidates = this.prepare(SQL_SELECT_EXPIRED_SESSIONS).all(nowIso);
    const sessionIds = candidates.map((row) => readString(row, 'session_id'));

    if (sessionIds.length === 0) {
      return [];
    }

    this.transaction(() => {
      const remove = this.prepare(SQL_DELETE_SESSION);

      for (const sessionId of sessionIds) {
        remove.run(sessionId);
      }
    });

    return sessionIds;
  }

  /**
   * Marks a session as reverted.
   *
   * @returns `true` when a session row was updated.
   */
  markSessionReverted(sessionId: string): boolean {
    this.assertOpen();
    assertNonEmpty(sessionId, 'session_id');

    return changedRows(this.prepare(SQL_MARK_SESSION_REVERTED).run(sessionId)) > 0;
  }

  /**
   * Marks a session as aborted.
   *
   * @returns `true` when a session row was updated.
   */
  markSessionAborted(sessionId: string): boolean {
    this.assertOpen();
    assertNonEmpty(sessionId, 'session_id');

    return changedRows(this.prepare(SQL_MARK_SESSION_ABORTED).run(sessionId)) > 0;
  }

  /** Persists a reversal audit record. */
  recordReversal(reversal: ReversalInsertRow): void {
    this.assertOpen();
    assertNonEmpty(reversal.reversal_id, 'reversal_id');
    assertTimestamp(reversal.executed_at, 'executed_at');

    if (!isReversalTargetState(reversal.target_state)) {
      throw new InvalidLedgerValueError(
        'target_state',
        `"${reversal.target_state}" is not a reversal target state`,
      );
    }

    if (!isReversalStatus(reversal.status)) {
      throw new InvalidLedgerValueError('status', `"${reversal.status}" is not a reversal status`);
    }

    const revertedOperations = serializeStringArray(
      reversal.reverted_operations,
      'reverted_operations',
    );

    this.transaction(() => {
      const existing = this.prepare(SQL_REVERSAL_EXISTS).get(reversal.session_id);

      if (existing === undefined) {
        throw new SessionNotFoundError(reversal.session_id);
      }

      this.prepare(SQL_INSERT_REVERSAL).run(
        reversal.reversal_id,
        reversal.session_id,
        reversal.target_state,
        reversal.executed_at,
        reversal.status,
        revertedOperations,
        reversal.error_message,
      );
    });
  }

  /** Returns reversal records for a session in execution order. */
  getReversalsForSession(sessionId: string): readonly ReversalRow[] {
    this.assertOpen();

    return this.prepare(SQL_SELECT_REVERSALS).all(sessionId).map(toReversalRow);
  }

  /** Closes the database connection. Repeated calls are no-ops. */
  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.statements.clear();
    this.db.close();
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new LedgerClosedError();
    }
  }

  private prepare(sql: string): StatementSync {
    const cached = this.statements.get(sql);

    if (cached !== undefined) {
      return cached;
    }

    const statement = this.db.prepare(sql);
    this.statements.set(sql, statement);
    return statement;
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');

    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // SQLite may have already rolled the transaction back before throwing.
      }

      throw error;
    }
  }
}
