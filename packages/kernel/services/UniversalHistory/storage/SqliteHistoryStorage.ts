import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, win32 } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue, SQLOutputValue, StatementSync } from 'node:sqlite';
import type {
  Checkpoint,
  DetectedDrift,
  HistoryEntry,
  HistoryOperationKind,
  HistoryQueryFilter,
} from '../contracts/models.js';
import { UNDO_CURSOR_KEY, HISTORY_SCHEMA_SQL } from './historySchema.js';
import { isSha256Hex } from './hash.js';

/** Path segment that opens an anonymous in-memory database. */
export const IN_MEMORY_HISTORY_DB_PATH = ':memory:';

/** Payloads larger than this are offloaded to `.brud/history/blobs/`. */
export const INLINE_SNAPSHOT_LIMIT_BYTES = 64 * 1024;

/** Default workspace-relative prefix used for blob references. */
export const DEFAULT_BLOB_REF_PREFIX = '.brud/history/blobs';

const OPERATION_KINDS: readonly HistoryOperationKind[] = ['write', 'unlink', 'mkdir'];

const NULL_BYTE_PATTERN = /\0/u;
const BACKSLASH_PATTERN = /\\/gu;
const TRAILING_SEPARATOR_PATTERN = /\/+$/u;
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:/u;

/** Thrown when a path is not a canonical workspace-relative path. */
export class InvalidHistoryPathError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`Invalid history path "${path}"`);
    this.name = 'InvalidHistoryPathError';
    this.path = path;
  }
}

/** Thrown when the storage connection is used after {@link close}. */
export class HistoryStorageClosedError extends Error {
  constructor() {
    super('The universal history storage connection is closed');
    this.name = 'HistoryStorageClosedError';
  }
}

/** Normalizes and validates a workspace-relative path. */
export function toHistoryRelativePath(candidate: string): string {
  if (candidate.length === 0 || NULL_BYTE_PATTERN.test(candidate)) {
    throw new InvalidHistoryPathError(candidate);
  }

  const unified = candidate
    .replace(BACKSLASH_PATTERN, '/')
    .replace(TRAILING_SEPARATOR_PATTERN, '');

  if (unified.length === 0) {
    throw new InvalidHistoryPathError(candidate);
  }

  if (posix.isAbsolute(unified) || win32.isAbsolute(unified) || WINDOWS_DRIVE_PATTERN.test(unified)) {
    throw new InvalidHistoryPathError(candidate);
  }

  const normalized = posix.normalize(unified);

  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new InvalidHistoryPathError(candidate);
  }

  return normalized;
}

function isOperationKind(value: string): value is HistoryOperationKind {
  return OPERATION_KINDS.some((candidate) => candidate === value);
}

function parseMetadata(raw: SQLOutputValue): Record<string, unknown> {
  if (typeof raw !== 'string') {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    return typeof parsed === 'object' && parsed !== null
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function serializeMetadata(metadata: Record<string, unknown> | undefined): string | null {
  return metadata === undefined ? null : JSON.stringify(metadata);
}

function readString(row: Record<string, SQLOutputValue>, column: string): string {
  const value = row[column];

  if (typeof value !== 'string') {
    throw new TypeError(`Column "${column}" must be a string`);
  }

  return value;
}

function readNullableString(
  row: Record<string, SQLOutputValue>,
  column: string,
): string | null {
  const value = row[column];

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new TypeError(`Column "${column}" must be a string or null`);
  }

  return value;
}

function readNumber(row: Record<string, SQLOutputValue>, column: string): number {
  const value = row[column];

  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (typeof value !== 'number') {
    throw new TypeError(`Column "${column}" must be a number`);
  }

  return value;
}

function readBuffer(row: Record<string, SQLOutputValue>, column: string): Buffer | null {
  const value = row[column];

  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(Uint8Array.from(value));
  }

  throw new TypeError(`Column "${column}" must be a blob or null`);
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || limit === Number.POSITIVE_INFINITY) {
    return -1;
  }

  if (!Number.isFinite(limit) || limit <= 0) {
    return 0;
  }

  return Math.floor(limit);
}

function normalizeOffset(offset: number | undefined): number {
  return offset === undefined || !Number.isFinite(offset) || offset <= 0
    ? 0
    : Math.floor(offset);
}

/** Durable content snapshot reference. */
export interface StoredContent {
  readonly sha256: string;
  readonly size: number;
  readonly inlineData: Buffer | null;
  readonly blobRef: string | null;
}

/** Payload accepted by {@link SqliteHistoryStorage.recordMutation}. */
export interface RecordMutationInput {
  readonly mutationId: string;
  readonly sessionId: string;
  readonly timestamp: number;
  readonly targetPath: string;
  readonly operationKind: HistoryOperationKind;
  readonly previousHash: string;
  readonly updatedHash: string;
  readonly metadata?: Record<string, unknown>;
  /** Post-mutation payload used for forward and reverse reconstruction. */
  readonly content?: Uint8Array;
}

/** Durable mutation row returned by the storage engine. */
export interface MutationRecord extends HistoryEntry {
  /** Monotonic ledger sequence. */
  readonly seq: number;

  /** Inline snapshot bytes for the updated payload, when small enough. */
  readonly inlineData: Buffer | null;
}

/** Construction options for {@link SqliteHistoryStorage}. */
export interface SqliteHistoryStorageOptions {
  /** `:memory:` or an absolute path to `history.db`. */
  readonly dbPath: string;

  /** Absolute directory receiving content-addressed blobs. */
  readonly blobDir?: string;

  /** Workspace-relative prefix recorded in `mutations.blob_ref`. */
  readonly blobRefPrefix?: string;

  /** Offload threshold in bytes. Defaults to 64 KiB. */
  readonly inlineThresholdBytes?: number;
}

/**
 * SQLite-backed storage for journal-driven history.
 *
 * The connection runs in WAL mode with `synchronous = NORMAL`, which keeps
 * journal ingestion cheap while preserving crash consistency. Every write is
 * synchronous at the SQLite layer and serialized by the subscriber queue, so
 * concurrent mutations cannot interleave statements on one connection.
 */
export class SqliteHistoryStorage {
  private readonly db: DatabaseSync;

  private readonly statements = new Map<string, StatementSync>();

  private readonly blobDir: string | undefined;

  private readonly blobRefPrefix: string;

  private readonly inlineThresholdBytes: number;

  private readonly journalMode: string;

  private closed = false;

  constructor(options: SqliteHistoryStorageOptions) {
    const { dbPath } = options;

    if (dbPath !== IN_MEMORY_HISTORY_DB_PATH) {
      if (!isAbsolute(dbPath)) {
        throw new RangeError(
          `History database path must be ":memory:" or an absolute path: "${dbPath}"`,
        );
      }

      mkdirSync(dirname(dbPath), { recursive: true });
    }

    this.blobDir = options.blobDir;
    this.blobRefPrefix = (options.blobRefPrefix ?? DEFAULT_BLOB_REF_PREFIX)
      .replace(TRAILING_SEPARATOR_PATTERN, '');
    this.inlineThresholdBytes = options.inlineThresholdBytes ?? INLINE_SNAPSHOT_LIMIT_BYTES;
    this.db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });

    try {
      this.db.exec(HISTORY_SCHEMA_SQL);
      this.journalMode = this.readJournalMode();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  /** Journal mode reported by SQLite (`wal` for file-backed databases). */
  get journalModeValue(): string {
    return this.journalMode;
  }

  /** Absolute blob directory, when blobs are enabled. */
  get blobDirectory(): string | undefined {
    return this.blobDir;
  }

  /** Inserts a session row when it does not exist yet. */
  ensureSession(
    sessionId: string,
    createdAt: number,
    metadata?: Record<string, unknown>,
  ): void {
    this.assertOpen();
    this.prepare(
      'INSERT OR IGNORE INTO sessions (session_id, created_at, metadata) VALUES (?, ?, ?)',
    ).run(sessionId, createdAt, serializeMetadata(metadata));
  }

  /** Creates or updates a session row. */
  beginSession(
    sessionId: string,
    createdAt: number,
    metadata?: Record<string, unknown>,
  ): void {
    this.assertOpen();
    this.prepare(
      `INSERT INTO sessions (session_id, created_at, metadata) VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET metadata = excluded.metadata`,
    ).run(sessionId, createdAt, serializeMetadata(metadata));
  }

  /**
   * Persists one mutation plus its post-mutation snapshot.
   *
   * Recording a mutation after {@link undo} or {@link rollbackToCheckpoint}
   * discards redoable entries newer than the current cursor, matching the
   * standard linear undo model.
   */
  async recordMutation(input: RecordMutationInput): Promise<MutationRecord> {
    this.assertOpen();

    const targetPath = toHistoryRelativePath(input.targetPath);

    if (!isOperationKind(input.operationKind)) {
      throw new TypeError(`Unsupported history operation kind: "${input.operationKind}"`);
    }

    const existing = this.getMutation(input.mutationId);

    if (existing !== undefined) {
      return existing;
    }

    this.ensureSession(input.sessionId, input.timestamp);

    let inlineData: Buffer | null = null;
    let blobRef: string | null = null;

    if (input.content !== undefined && input.updatedHash.length > 0) {
      const stored = await this.storeContent(input.updatedHash, input.content);

      inlineData = stored.inlineData;
      blobRef = stored.blobRef;
    }

    const cursor = this.getCursor();
    const maxSeq = this.maxSequence();

    if (cursor < maxSeq) {
      this.prepare('DELETE FROM mutations WHERE seq > ?').run(cursor);
    }

    const seq = this.maxSequence() + 1;

    this.prepare(
      `INSERT INTO mutations (
         mutation_id, session_id, timestamp, path, operation_kind,
         previous_hash, updated_hash, inline_data, blob_ref, metadata, seq
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.mutationId,
      input.sessionId,
      input.timestamp,
      targetPath,
      input.operationKind,
      input.previousHash,
      input.updatedHash,
      inlineData,
      blobRef,
      serializeMetadata(input.metadata),
      seq,
    );

    this.setCursor(seq);

    return {
      mutationId: input.mutationId,
      sessionId: input.sessionId,
      timestamp: input.timestamp,
      targetPath,
      operationKind: input.operationKind,
      previousHash: input.previousHash,
      updatedHash: input.updatedHash,
      blobRef,
      metadata: input.metadata ?? {},
      seq,
      inlineData,
    };
  }

  /** Returns the snapshot for a digest, or `null` when it is unknown. */
  async getContent(sha256: string): Promise<Uint8Array | null> {
    this.assertOpen();

    if (!isSha256Hex(sha256)) {
      return null;
    }

    const content = this.getContentRecord(sha256);

    if (content !== null && content.inlineData !== null) {
      return Uint8Array.from(content.inlineData);
    }

    if (content !== null && content.blobRef !== null) {
      return this.readBlob(sha256);
    }

    const row = this.prepare(
      `SELECT inline_data, blob_ref FROM mutations
       WHERE updated_hash = ? AND (inline_data IS NOT NULL OR blob_ref IS NOT NULL)
       LIMIT 1`,
    ).get(sha256) as Record<string, SQLOutputValue> | undefined;

    if (row === undefined) {
      return null;
    }

    const inline = readBuffer(row, 'inline_data');

    if (inline !== null) {
      return Uint8Array.from(inline);
    }

    return readNullableString(row, 'blob_ref') === null ? null : this.readBlob(sha256);
  }

  /** Reports whether a snapshot for this digest is already stored. */
  hasContent(sha256: string): boolean {
    this.assertOpen();

    if (!isSha256Hex(sha256)) {
      return false;
    }

    if (this.getContentRecord(sha256) !== null) {
      return true;
    }

    return this.prepare(
      `SELECT 1 AS present FROM mutations
       WHERE updated_hash = ? AND (inline_data IS NOT NULL OR blob_ref IS NOT NULL)
       LIMIT 1`,
    ).get(sha256) !== undefined;
  }

  /** Returns the durable content record for a digest, or `null`. */
  getContentRecord(sha256: string): StoredContent | null {
    this.assertOpen();

    const row = this.prepare(
      'SELECT sha256, size, inline_data, blob_ref FROM contents WHERE sha256 = ?',
    ).get(sha256) as Record<string, SQLOutputValue> | undefined;

    if (row === undefined) {
      return null;
    }

    return {
      sha256: readString(row, 'sha256'),
      size: readNumber(row, 'size'),
      inlineData: readBuffer(row, 'inline_data'),
      blobRef: readNullableString(row, 'blob_ref'),
    };
  }

  /** Stores a snapshot without creating a mutation entry. */
  async putContent(sha256: string, content: Uint8Array): Promise<StoredContent> {
    this.assertOpen();

    if (!isSha256Hex(sha256)) {
      throw new TypeError(`Invalid SHA-256 digest: "${sha256}"`);
    }

    return this.storeContent(sha256, content);
  }

  /** Current global undo cursor. */
  getCursor(): number {
    this.assertOpen();

    const row = this.prepare(
      'SELECT value FROM history_state WHERE state_key = ?',
    ).get(UNDO_CURSOR_KEY) as Record<string, SQLOutputValue> | undefined;

    if (row === undefined) {
      const cursor = this.maxSequence();

      this.setCursor(cursor);

      return cursor;
    }

    return readNumber(row, 'value');
  }

  /** Moves the global undo cursor. */
  setCursor(value: number): void {
    this.assertOpen();

    const normalized = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

    this.prepare(
      `INSERT INTO history_state (state_key, value) VALUES (?, ?)
       ON CONFLICT(state_key) DO UPDATE SET value = excluded.value`,
    ).run(UNDO_CURSOR_KEY, normalized);
  }

  /** Highest mutation sequence recorded, or `0` when empty. */
  maxSequence(): number {
    this.assertOpen();

    const row = this.prepare(
      'SELECT COALESCE(MAX(seq), 0) AS max_seq FROM mutations',
    ).get() as Record<string, SQLOutputValue>;

    return readNumber(row, 'max_seq');
  }

  /** Newest reversible mutations at or below the cursor. */
  getMutationsDescending(cursor: number, limit: number): readonly MutationRecord[] {
    return this.selectMutationRange(
      'SELECT * FROM mutations WHERE seq <= ? AND operation_kind <> \'mkdir\' ORDER BY seq DESC',
      cursor,
      limit,
    );
  }

  /** Oldest redoable mutations above the cursor. */
  getMutationsAscending(cursor: number, limit: number): readonly MutationRecord[] {
    return this.selectMutationRange(
      'SELECT * FROM mutations WHERE seq > ? AND operation_kind <> \'mkdir\' ORDER BY seq ASC',
      cursor,
      limit,
    );
  }

  /** Lists mutations newest-first using the public filter shape. */
  listMutations(filter: HistoryQueryFilter = {}): readonly MutationRecord[] {
    this.assertOpen();

    const limit = normalizeLimit(filter.limit);

    if (limit === 0) {
      return [];
    }

    const conditions: string[] = [];
    const params: SQLInputValue[] = [];

    if (filter.sessionId !== undefined) {
      conditions.push('session_id = ?');
      params.push(filter.sessionId);
    }

    if (filter.targetPath !== undefined) {
      conditions.push('path = ?');
      params.push(toHistoryRelativePath(filter.targetPath));
    }

    if (filter.operationKind !== undefined) {
      if (!isOperationKind(filter.operationKind)) {
        throw new TypeError(`Unsupported history operation kind: "${filter.operationKind}"`);
      }

      conditions.push('operation_kind = ?');
      params.push(filter.operationKind);
    }

    if (filter.since !== undefined) {
      conditions.push('timestamp >= ?');
      params.push(filter.since);
    }

    if (filter.until !== undefined) {
      conditions.push('timestamp <= ?');
      params.push(filter.until);
    }

    const where = conditions.length === 0 ? '' : ` WHERE ${conditions.join(' AND ')}`;

    params.push(limit, normalizeOffset(filter.offset));

    const rows = this.prepare(
      `SELECT * FROM mutations${where} ORDER BY seq DESC LIMIT ? OFFSET ?`,
    ).all(...params);

    return rows.map((row) => this.toMutationRecord(row));
  }

  /** Resolves one mutation by identifier. */
  getMutation(mutationId: string): MutationRecord | undefined {
    this.assertOpen();

    const row = this.prepare(
      'SELECT * FROM mutations WHERE mutation_id = ?',
    ).get(mutationId) as Record<string, SQLOutputValue> | undefined;

    return row === undefined ? undefined : this.toMutationRecord(row);
  }

  /** Persists a checkpoint. */
  insertCheckpoint(checkpoint: Checkpoint): void {
    this.assertOpen();
    this.ensureSession(checkpoint.sessionId, checkpoint.timestamp);

    this.prepare(
      `INSERT INTO checkpoints (
         checkpoint_id, session_id, label, ledger_offset, created_at, metadata
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      checkpoint.checkpointId,
      checkpoint.sessionId,
      checkpoint.label,
      checkpoint.ledgerOffset,
      checkpoint.timestamp,
      serializeMetadata(checkpoint.metadata),
    );
  }

  /** Resolves one checkpoint. */
  getCheckpoint(checkpointId: string): Checkpoint | undefined {
    this.assertOpen();

    const row = this.prepare(
      'SELECT * FROM checkpoints WHERE checkpoint_id = ?',
    ).get(checkpointId) as Record<string, SQLOutputValue> | undefined;

    return row === undefined ? undefined : this.toCheckpoint(row);
  }

  /** Lists checkpoints newest-first. */
  listCheckpoints(sessionId?: string): readonly Checkpoint[] {
    this.assertOpen();

    const rows = sessionId === undefined
      ? this.prepare(
        'SELECT * FROM checkpoints ORDER BY created_at DESC, ledger_offset DESC',
      ).all()
      : this.prepare(
        `SELECT * FROM checkpoints WHERE session_id = ?
         ORDER BY created_at DESC, ledger_offset DESC`,
      ).all(sessionId);

    return rows.map((row) => this.toCheckpoint(row));
  }

  /** Closes the connection. Repeated calls are no-ops. */
  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.statements.clear();
    this.db.close();
  }

  private readJournalMode(): string {
    const row = this.db.prepare('PRAGMA journal_mode = WAL').get() as Record<
      string,
      SQLOutputValue
    >;
    const mode = row.journal_mode;

    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA foreign_keys = ON');

    return typeof mode === 'string' ? mode.toLowerCase() : 'unknown';
  }

  private selectMutationRange(
    sql: string,
    cursor: number,
    limit: number,
  ): readonly MutationRecord[] {
    this.assertOpen();

    const normalizedLimit = normalizeLimit(limit);

    if (normalizedLimit === 0) {
      return [];
    }

    const rows = this.prepare(`${sql} LIMIT ?`).all(cursor, normalizedLimit);

    return rows.map((row) => this.toMutationRecord(row));
  }

  private async storeContent(sha256: string, content: Uint8Array): Promise<StoredContent> {
    const existing = this.getContentRecord(sha256);

    if (existing !== null) {
      return existing;
    }

    const bytes = Buffer.from(Uint8Array.from(content));
    let inlineData: Buffer | null = null;
    let blobRef: string | null = null;

    if (bytes.byteLength > this.inlineThresholdBytes && this.blobDir !== undefined) {
      await this.writeBlobIfMissing(sha256, bytes);
      blobRef = `${this.blobRefPrefix}/${sha256}`;
    } else {
      inlineData = bytes;
    }

    this.prepare(
      `INSERT INTO contents (sha256, size, inline_data, blob_ref, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(sha256, bytes.byteLength, inlineData, blobRef, Date.now());

    return {
      sha256,
      size: bytes.byteLength,
      inlineData,
      blobRef,
    };
  }

  private async writeBlobIfMissing(sha256: string, bytes: Uint8Array): Promise<void> {
    const blobDir = this.blobDir;

    if (blobDir === undefined) {
      return;
    }

    const targetPath = join(blobDir, sha256);

    if (existsSync(targetPath)) {
      return;
    }

    await mkdir(blobDir, { recursive: true });

    const temporaryPath = join(blobDir, `.${sha256}.${process.pid}.${randomUUID()}.tmp`);

    try {
      await writeFile(temporaryPath, bytes);
      await rename(temporaryPath, targetPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async readBlob(sha256: string): Promise<Uint8Array | null> {
    if (this.blobDir === undefined) {
      return null;
    }

    try {
      return Uint8Array.from(await readFile(join(this.blobDir, sha256)));
    } catch {
      return null;
    }
  }

  private toMutationRecord(row: Record<string, SQLOutputValue>): MutationRecord {
    const operationKind = readString(row, 'operation_kind');

    if (!isOperationKind(operationKind)) {
      throw new TypeError(`Unsupported history operation kind: "${operationKind}"`);
    }

    return {
      mutationId: readString(row, 'mutation_id'),
      sessionId: readString(row, 'session_id'),
      timestamp: readNumber(row, 'timestamp'),
      targetPath: readString(row, 'path'),
      operationKind,
      previousHash: readString(row, 'previous_hash'),
      updatedHash: readString(row, 'updated_hash'),
      blobRef: readNullableString(row, 'blob_ref'),
      metadata: parseMetadata(row.metadata ?? null),
      seq: readNumber(row, 'seq'),
      inlineData: readBuffer(row, 'inline_data'),
    };
  }

  private toCheckpoint(row: Record<string, SQLOutputValue>): Checkpoint {
    return {
      checkpointId: readString(row, 'checkpoint_id'),
      sessionId: readString(row, 'session_id'),
      label: readString(row, 'label'),
      ledgerOffset: readNumber(row, 'ledger_offset'),
      timestamp: readNumber(row, 'created_at'),
      metadata: parseMetadata(row.metadata ?? null),
    };
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new HistoryStorageClosedError();
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
}

/** Detected drift entry helper used by the rollback engine. */
export function createDrift(
  path: string,
  expectedHash: string,
  actualHash: string,
): DetectedDrift {
  return { path, expectedHash, actualHash };
}
