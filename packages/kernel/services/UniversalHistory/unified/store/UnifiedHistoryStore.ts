/**
 * Unified history store over `universal.db` and the `cas/` blob tree
 * (D-15, U-2). Not wired into the kernel; consumed by the unified service.
 *
 * - Construction never touches disk. `open()` never fails for read-only
 *   storage: it degrades instead (closes F-UP-1 at the storage layer).
 * - Every multi-row write runs in one `BEGIN IMMEDIATE` transaction.
 * - Reads page by keyset, never by OFFSET.
 */
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IStorageDriver } from '../../../../drivers/contracts/index.js';
import { assertDigest, blobRef, readBlob, sha256Hex, writeBlob } from './cas.js';
import { isReadOnlyStorageError } from './classify.js';
import {
  UnifiedBlobIntegrityError,
  UnifiedBlobMissingError,
  UnifiedHistoryDegradedError,
  UnifiedSessionIdExhaustedError,
  UnifiedSessionNotFoundError,
  UnifiedStoreClosedError,
  UnifiedStoreConflictError,
} from './errors.js';
import { UNIFIED_SCHEMA_VERSION, applyMigrations, configureConnection, readSchemaVersion } from './schema.js';
import type {
  AppendOptions,
  CheckpointRow,
  ContentRef,
  CreateSessionInput,
  EntryInput,
  EntryPage,
  EntryQuery,
  EntryRow,
  EntryTypeRow,
  HistoryDegradedReason,
  HistoryStoreWarning,
  ImportRow,
  PersistedSessionStatus,
  PreparedEntry,
  ReversalRow,
  SessionPage,
  SessionQuery,
  SessionRow,
  StoreOpenResult,
} from './types.js';

export const UNIFIED_INLINE_LIMIT_BYTES = 64 * 1024;
export const MAX_SESSIONS_PER_DAY = 9_999;
const UNDO_CURSOR_KEY = 'undo_cursor';
const MAX_PAGE = 1_000;

export interface UnifiedHistoryStoreOptions {
  /** Absolute path of `universal.db`, or `':memory:'`. */
  readonly dbPath: string;
  /** Absolute path of `.brud/history` (parent of `cas/`). */
  readonly historyRoot: string;
  /** Storage driver used for every blob and directory operation. */
  readonly driver: IStorageDriver;
  readonly inlineThresholdBytes?: number;
  readonly onWarning?: (warning: HistoryStoreWarning) => void;
  readonly now?: () => number;
}

type Row = Record<string, unknown>;

/** JSON text with object keys sorted recursively, for stable comparison. */
export function canonicalJson(value: unknown): string {
  const normalize = (current: unknown): unknown => {
    if (Array.isArray(current)) {
      return current.map(normalize);
    }
    if (current !== null && typeof current === 'object') {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(current as Row).sort()) {
        sorted[key] = normalize((current as Row)[key]);
      }
      return sorted;
    }
    return current;
  };
  return JSON.stringify(normalize(value));
}

function utcDay(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (value: number, width: number): string => String(value).padStart(width, '0');
  return `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1, 2)}${pad(date.getUTCDate(), 2)}`;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return 100;
  }
  return Math.min(MAX_PAGE, Math.max(1, Math.trunc(limit)));
}

function parseJson(text: unknown): unknown {
  return typeof text === 'string' ? JSON.parse(text) : null;
}

function toEntryType(row: Row): EntryTypeRow {
  return {
    namespace: row.namespace as string,
    type: row.type as string,
    schemaVersion: row.schema_version as number,
    payloadSchema: row.payload_schema as string,
    reversalMode: row.reversal_mode as EntryTypeRow['reversalMode'],
    registeredBy: row.registered_by as string,
    registeredAt: row.registered_at as number,
  };
}

function toSession(row: Row): SessionRow {
  return {
    sessionId: row.session_id as string,
    createdAt: row.created_at as number,
    prompt: row.prompt as string,
    status: row.status as PersistedSessionStatus,
    origin: row.origin as string,
    implicit: row.implicit === 1,
    closedAt: (row.closed_at as number | null) ?? null,
    metadata: parseJson(row.metadata),
  };
}

function toEntry(row: Row): EntryRow {
  return {
    seq: row.seq as number,
    entryId: row.entry_id as string,
    sessionId: row.session_id as string,
    namespace: row.namespace as string,
    type: row.type as string,
    schemaVersion: row.schema_version as number,
    payloadJson: (row.payload as string | null) ?? null,
    payloadSha256: (row.payload_sha256 as string | null) ?? null,
    inversePayloadJson: (row.inverse_payload as string | null) ?? null,
    createdAt: row.created_at as number,
    filePath: (row.file_path as string | null) ?? null,
  };
}

function toCheckpoint(row: Row): CheckpointRow {
  return {
    checkpointId: row.checkpoint_id as string,
    sessionId: row.session_id as string,
    label: row.label as string,
    seqOffset: row.seq_offset as number,
    createdAt: row.created_at as number,
    metadata: parseJson(row.metadata),
  };
}

function toReversal(row: Row): ReversalRow {
  return {
    reversalId: row.reversal_id as string,
    sessionId: (row.session_id as string | null) ?? null,
    kind: row.kind as ReversalRow['kind'],
    targetState: (row.target_state as string | null) ?? null,
    executedAt: row.executed_at as number,
    status: row.status as string,
    revertedEntries: JSON.parse(row.reverted_entries as string) as number[],
    errorMessage: (row.error_message as string | null) ?? null,
  };
}

export class UnifiedHistoryStore {
  private db: DatabaseSync | undefined;

  private opened: StoreOpenResult | undefined;

  private closed = false;

  private degraded: HistoryDegradedReason | undefined;

  private readonly inlineThreshold: number;

  private readonly now: () => number;

  constructor(private readonly options: UnifiedHistoryStoreOptions) {
    this.inlineThreshold = options.inlineThresholdBytes ?? UNIFIED_INLINE_LIMIT_BYTES;
    this.now = options.now ?? Date.now;
  }

  get isDegraded(): boolean {
    return this.degraded !== undefined;
  }

  get degradedReason(): HistoryDegradedReason | undefined {
    return this.degraded;
  }

  get historyRoot(): string {
    return this.options.historyRoot;
  }

  /** Opens (and migrates) the database. Idempotent. Degrades instead of failing on read-only storage. */
  async open(): Promise<StoreOpenResult> {
    if (this.opened !== undefined) {
      return this.opened;
    }
    if (this.closed) {
      throw new UnifiedStoreClosedError();
    }

    const { dbPath } = this.options;

    if (dbPath === ':memory:') {
      const db = new DatabaseSync(':memory:');
      configureConnection(db, true);
      applyMigrations(db, this.now());
      this.db = db;
      this.opened = { mode: 'writable' };
      return this.opened;
    }

    let candidate: DatabaseSync | undefined;
    try {
      await this.options.driver.mkdir(dirname(dbPath), { recursive: true });
      candidate = new DatabaseSync(dbPath);
      configureConnection(candidate, true);
      if (readSchemaVersion(candidate) > UNIFIED_SCHEMA_VERSION) {
        this.db = candidate;
        return this.degrade('SCHEMA_TOO_NEW');
      }
      applyMigrations(candidate, this.now());
      this.db = candidate;
      this.opened = { mode: 'writable' };
      return this.opened;
    } catch (error) {
      try {
        candidate?.close();
      } catch {
        // Already closed or never opened.
      }
      if (!isReadOnlyStorageError(error)) {
        throw error;
      }
      this.db = await this.openReadOnlySnapshot(dbPath);
      return this.degrade('READ_ONLY_STORAGE');
    }
  }

  /** Closes the database. Idempotent. */
  close(): void {
    this.closed = true;
    try {
      this.db?.close();
    } catch {
      // Already closed.
    }
    this.db = undefined;
  }

  // ── entry types ─────────────────────────────────────────────────────

  /** Registers a type. Identical re-registration is a no-op; a conflicting one throws. */
  registerEntryType(row: Omit<EntryTypeRow, 'payloadSchema'> & { readonly payloadSchema: unknown }): void {
    this.mutate(() => {
      const schemaText = canonicalJson(row.payloadSchema);
      this.immediate(() => {
        const existing = this.writer()
          .prepare('SELECT * FROM entry_types WHERE namespace = ? AND type = ? AND schema_version = ?')
          .get(row.namespace, row.type, row.schemaVersion) as Row | undefined;
        if (existing !== undefined) {
          if (existing.payload_schema === schemaText && existing.reversal_mode === row.reversalMode) {
            return;
          }
          throw new UnifiedStoreConflictError(
            `Entry type ${row.namespace}.${row.type} v${row.schemaVersion} is already registered with a different schema or reversal mode`,
          );
        }
        this.writer()
          .prepare(`INSERT INTO entry_types (namespace, type, schema_version, payload_schema, reversal_mode, registered_by, registered_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(row.namespace, row.type, row.schemaVersion, schemaText, row.reversalMode, row.registeredBy, row.registeredAt);
      });
    });
  }

  getEntryType(namespace: string, type: string, schemaVersion: number): EntryTypeRow | undefined {
    const row = this.reader()
      ?.prepare('SELECT * FROM entry_types WHERE namespace = ? AND type = ? AND schema_version = ?')
      .get(namespace, type, schemaVersion) as Row | undefined;
    return row === undefined ? undefined : toEntryType(row);
  }

  listEntryTypes(): readonly EntryTypeRow[] {
    const rows = this.reader()?.prepare('SELECT * FROM entry_types ORDER BY namespace, type, schema_version').all() as Row[] | undefined;
    return (rows ?? []).map(toEntryType);
  }

  // ── sessions ────────────────────────────────────────────────────────

  /** Creates a session, allocating `BR-YYYYMMDD-NNN` inside the same transaction. */
  createSession(input: CreateSessionInput): SessionRow {
    return this.mutate(() => this.immediate(() => {
      const db = this.writer();
      const day = utcDay(input.now);
      const sequence = db.prepare('SELECT next FROM session_sequence WHERE day = ?').get(day) as { next: number } | undefined;
      const next = sequence?.next ?? 1;
      if (next > MAX_SESSIONS_PER_DAY) {
        throw new UnifiedSessionIdExhaustedError(day, MAX_SESSIONS_PER_DAY);
      }
      db.prepare('INSERT INTO session_sequence (day, next) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET next = excluded.next')
        .run(day, next + 1);
      const sessionId = `BR-${day}-${String(next).padStart(3, '0')}`;
      db.prepare(`INSERT INTO sessions (session_id, created_at, prompt, status, origin, implicit, metadata)
                  VALUES (?, ?, ?, 'active', ?, ?, ?)`)
        .run(
          sessionId,
          input.now,
          input.prompt,
          input.origin ?? 'human',
          input.implicit === true ? 1 : 0,
          input.metadata === undefined ? null : JSON.stringify(input.metadata),
        );
      return toSession(db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as Row);
    }));
  }

  /** Inserts a session with a known id (importer). Bumps the day sequence past it. */
  insertSessionWithId(row: SessionRow): void {
    this.mutate(() => this.immediate(() => {
      const db = this.writer();
      db.prepare(`INSERT INTO sessions (session_id, created_at, prompt, status, origin, implicit, closed_at, metadata)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          row.sessionId,
          row.createdAt,
          row.prompt,
          row.status,
          row.origin,
          row.implicit ? 1 : 0,
          row.closedAt,
          row.metadata === null || row.metadata === undefined ? null : JSON.stringify(row.metadata),
        );
      const match = /^BR-(\d{8})-(\d+)$/u.exec(row.sessionId);
      if (match !== null) {
        this.seedSessionSequenceInTx(match[1] as string, Number(match[2]) + 1);
      }
    }));
  }

  /** Raises a day's next sequence to at least `next` (never lowers it). */
  seedSessionSequence(day: string, next: number): void {
    this.mutate(() => this.immediate(() => {
      this.seedSessionSequenceInTx(day, next);
    }));
  }

  /** Compare-and-set status transition. */
  transitionSession(
    sessionId: string,
    from: readonly PersistedSessionStatus[],
    to: PersistedSessionStatus,
    closedAt: number | null,
  ): void {
    this.mutate(() => this.immediate(() => {
      const db = this.writer();
      const placeholders = from.map(() => '?').join(', ');
      const result = db
        .prepare(`UPDATE sessions SET status = ?, closed_at = COALESCE(?, closed_at)
                  WHERE session_id = ? AND status IN (${placeholders})`)
        .run(to, closedAt, sessionId, ...from);
      if (Number(result.changes) === 1) {
        return;
      }
      const existing = db.prepare('SELECT status FROM sessions WHERE session_id = ?').get(sessionId) as { status: string } | undefined;
      if (existing === undefined) {
        throw new UnifiedSessionNotFoundError(sessionId);
      }
      throw new UnifiedStoreConflictError(`Session ${sessionId} is ${existing.status}, expected ${from.join(' or ')}`);
    }));
  }

  getSession(sessionId: string): SessionRow | undefined {
    const row = this.reader()?.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as Row | undefined;
    return row === undefined ? undefined : toSession(row);
  }

  /** Newest first, keyset paged by `(created_at, session_id)`. Implicit sessions excluded unless asked. */
  listSessions(query: SessionQuery = {}): SessionPage {
    const db = this.reader();
    if (db === undefined) {
      return { rows: [] };
    }
    const where: string[] = query.includeDeleted === true ? ['1 = 1'] : ['is_deleted = 0'];
    const params: SQLInputValue[] = [];
    if (query.since !== undefined) {
      where.push('created_at >= ?');
      params.push(query.since);
    }
    if (query.includeImplicit !== true) {
      where.push('implicit = 0');
    }
    if (query.status !== undefined) {
      where.push('status = ?');
      params.push(query.status);
    }
    if (query.before !== undefined) {
      where.push('(created_at < ? OR (created_at = ? AND session_id < ?))');
      params.push(query.before.createdAt, query.before.createdAt, query.before.sessionId);
    }
    const limit = clampLimit(query.limit);
    const rows = db
      .prepare(`SELECT * FROM sessions WHERE ${where.join(' AND ')}
                ORDER BY created_at DESC, session_id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit + 1, Math.max(0, Math.trunc(query.offset ?? 0))) as Row[];
    const page = rows.slice(0, limit).map(toSession);
    const last = page[page.length - 1];
    return rows.length > limit && last !== undefined
      ? { rows: page, next: { createdAt: last.createdAt, sessionId: last.sessionId } }
      : { rows: page };
  }

  // ── contents ────────────────────────────────────────────────────────

  /** Stores bytes by digest: inline up to the threshold, otherwise in `cas/`. Deduplicates. */
  async putContent(bytes: Uint8Array): Promise<ContentRef> {
    return this.mutateAsync(async () => {
      const sha256 = sha256Hex(bytes);
      const existing = this.writer()
        .prepare('SELECT size, inline_data FROM contents WHERE sha256 = ?')
        .get(sha256) as Row | undefined;
      if (existing !== undefined) {
        return { sha256, size: existing.size as number, stored: existing.inline_data === null ? 'blob' : 'inline' };
      }
      if (bytes.byteLength > this.inlineThreshold) {
        await writeBlob(this.options.driver, this.options.historyRoot, sha256, bytes);
        this.writer()
          .prepare('INSERT OR IGNORE INTO contents (sha256, size, inline_data, blob_ref, created_at) VALUES (?, ?, NULL, ?, ?)')
          .run(sha256, bytes.byteLength, blobRef(sha256), this.now());
        return { sha256, size: bytes.byteLength, stored: 'blob' };
      }
      this.writer()
        .prepare('INSERT OR IGNORE INTO contents (sha256, size, inline_data, blob_ref, created_at) VALUES (?, ?, ?, NULL, ?)')
        .run(sha256, bytes.byteLength, bytes, this.now());
      return { sha256, size: bytes.byteLength, stored: 'inline' };
    });
  }

  /**
   * Returns verified bytes for a digest.
   *
   * @throws UnifiedBlobMissingError when unknown or the blob file is gone.
   * @throws UnifiedBlobIntegrityError when the bytes do not match the digest.
   */
  async getContent(sha256: string): Promise<Uint8Array> {
    assertDigest(sha256);
    const row = this.reader()
      ?.prepare('SELECT inline_data, blob_ref FROM contents WHERE sha256 = ?')
      .get(sha256) as Row | undefined;
    if (row === undefined) {
      throw new UnifiedBlobMissingError(sha256);
    }
    if (row.inline_data !== null && row.inline_data !== undefined) {
      const bytes = Uint8Array.from(row.inline_data as Uint8Array);
      const actual = sha256Hex(bytes);
      if (actual !== sha256) {
        throw new UnifiedBlobIntegrityError(sha256, actual);
      }
      return bytes;
    }
    return readBlob(this.options.driver, this.options.historyRoot, sha256);
  }

  hasContent(sha256: string): boolean {
    return this.reader()?.prepare('SELECT 1 AS present FROM contents WHERE sha256 = ?').get(sha256) !== undefined;
  }

  // ── entries ─────────────────────────────────────────────────────────

  /** Serializes an entry and offloads a payload over the inline threshold to CAS. */
  async prepareEntry(input: EntryInput): Promise<PreparedEntry> {
    const payloadJson = JSON.stringify(input.payload);
    const inversePayloadJson = input.inversePayload === undefined ? null : JSON.stringify(input.inversePayload);
    const bytes = new TextEncoder().encode(payloadJson);
    if (bytes.byteLength > this.inlineThreshold) {
      const ref = await this.putContent(bytes);
      return { ...this.entryHeader(input), payloadJson: null, payloadSha256: ref.sha256, inversePayloadJson };
    }
    return { ...this.entryHeader(input), payloadJson, payloadSha256: null, inversePayloadJson };
  }

  /**
   * Appends entries in one transaction. Optionally truncates the redo tail
   * first and moves the undo cursor to the last appended entry.
   */
  appendEntries(sessionId: string, entries: readonly PreparedEntry[], options: AppendOptions = {}): readonly EntryRow[] {
    return this.mutate(() => this.immediate(() => {
      const db = this.writer();
      if (db.prepare('SELECT 1 AS present FROM sessions WHERE session_id = ?').get(sessionId) === undefined) {
        throw new UnifiedSessionNotFoundError(sessionId);
      }
      if (options.truncateRedoTail === true) {
        // The redo tail is defined over recorded file mutations only. Session
        // targets and producer entries above the cursor are history of other
        // operations and must never be discarded by a new edit.
        db.prepare("DELETE FROM entries WHERE seq > ? AND namespace = 'brud.core' AND type = 'file'").run(this.cursorIn(db));
      }
      let seq = this.maxSeqIn(db);
      const insert = db.prepare(`INSERT INTO entries
        (seq, entry_id, session_id, namespace, type, schema_version, payload, payload_sha256, inverse_payload, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const appended: number[] = [];
      for (const entry of entries) {
        seq += 1;
        insert.run(
          seq,
          randomUUID(),
          sessionId,
          entry.namespace,
          entry.type,
          entry.schemaVersion,
          entry.payloadJson,
          entry.payloadSha256,
          entry.inversePayloadJson,
          entry.createdAt,
        );
        appended.push(seq);
      }
      if (options.advanceCursor === true && appended.length > 0) {
        this.setCursorIn(db, seq);
      }
      const first = appended[0];
      return first === undefined
        ? []
        : (db.prepare('SELECT * FROM entries WHERE seq >= ? AND seq <= ? ORDER BY seq').all(first, seq) as Row[]).map(toEntry);
    }));
  }

  getEntry(seq: number): EntryRow | undefined {
    const row = this.reader()?.prepare('SELECT * FROM entries WHERE seq = ?').get(seq) as Row | undefined;
    return row === undefined ? undefined : toEntry(row);
  }

  /** Keyset-paged entry query. */
  listEntries(query: EntryQuery = {}): EntryPage {
    const db = this.reader();
    if (db === undefined) {
      return { rows: [] };
    }
    const { sql, params, limit } = this.entryQuerySql(query);
    const rows = db.prepare(sql).all(...params) as Row[];
    const page = rows.slice(0, limit).map(toEntry);
    const last = page[page.length - 1];
    return rows.length > limit && last !== undefined ? { rows: page, nextSeq: last.seq } : { rows: page };
  }

  /** `EXPLAIN QUERY PLAN` details for an entry query (diagnostics and tests). */
  explainListEntries(query: EntryQuery = {}): readonly string[] {
    const db = this.reader();
    if (db === undefined) {
      return [];
    }
    const { sql, params } = this.entryQuerySql(query);
    return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Row[]).map((row) => String(row.detail));
  }

  /** Inline JSON payload, or the verified CAS payload. */
  async resolvePayload(row: EntryRow): Promise<unknown> {
    if (row.payloadJson !== null) {
      return JSON.parse(row.payloadJson);
    }
    const bytes = await this.getContent(row.payloadSha256 as string);
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  // ── undo cursor ─────────────────────────────────────────────────────

  maxSeq(): number {
    const db = this.reader();
    return db === undefined ? 0 : this.maxSeqIn(db);
  }

  /** Undo cursor; defaults to the newest entry when never set. */
  getCursor(): number {
    const db = this.reader();
    return db === undefined ? 0 : this.cursorIn(db);
  }

  setCursor(seq: number): void {
    this.mutate(() => {
      this.setCursorIn(this.writer(), seq);
    });
  }

  // ── checkpoints, reversals, imports ─────────────────────────────────

  insertCheckpoint(row: CheckpointRow): void {
    this.mutate(() => {
      this.writer()
        .prepare('INSERT INTO checkpoints (checkpoint_id, session_id, label, seq_offset, created_at, metadata) VALUES (?, ?, ?, ?, ?, ?)')
        .run(row.checkpointId, row.sessionId, row.label, row.seqOffset, row.createdAt,
          row.metadata === null || row.metadata === undefined ? null : JSON.stringify(row.metadata));
    });
  }

  getCheckpoint(checkpointId: string): CheckpointRow | undefined {
    const row = this.reader()?.prepare('SELECT * FROM checkpoints WHERE checkpoint_id = ?').get(checkpointId) as Row | undefined;
    return row === undefined ? undefined : toCheckpoint(row);
  }

  listCheckpoints(sessionId?: string): readonly CheckpointRow[] {
    const db = this.reader();
    if (db === undefined) {
      return [];
    }
    const rows = (sessionId === undefined
      ? db.prepare('SELECT * FROM checkpoints ORDER BY created_at DESC, checkpoint_id DESC').all()
      : db.prepare('SELECT * FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC, checkpoint_id DESC').all(sessionId)) as Row[];
    return rows.map(toCheckpoint);
  }

  insertReversal(row: ReversalRow): void {
    this.mutate(() => {
      this.writer()
        .prepare(`INSERT INTO reversals (reversal_id, session_id, kind, target_state, executed_at, status, reverted_entries, error_message)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(row.reversalId, row.sessionId, row.kind, row.targetState, row.executedAt, row.status,
          JSON.stringify(row.revertedEntries), row.errorMessage);
    });
  }

  listReversals(sessionId: string): readonly ReversalRow[] {
    const rows = this.reader()
      ?.prepare('SELECT * FROM reversals WHERE session_id = ? ORDER BY executed_at, reversal_id')
      .all(sessionId) as Row[] | undefined;
    return (rows ?? []).map(toReversal);
  }

  recordImport(row: ImportRow): void {
    this.mutate(() => {
      this.writer()
        .prepare('INSERT INTO imports (source, source_sha256, imported_at, rows) VALUES (?, ?, ?, ?)')
        .run(row.source, row.sourceSha256, row.importedAt, row.rows);
    });
  }

  getImport(source: string): ImportRow | undefined {
    const row = this.reader()?.prepare('SELECT * FROM imports WHERE source = ?').get(source) as Row | undefined;
    return row === undefined
      ? undefined
      : { source: row.source as string, sourceSha256: row.source_sha256 as string, importedAt: row.imported_at as number, rows: row.rows as number };
  }

  /** Runs several store writes atomically (importer). Nested store writes join this transaction. */
  transaction<T>(work: () => T): T {
    return this.mutate(() => this.immediate(work));
  }

  // ── internals ───────────────────────────────────────────────────────

  private inTransaction = false;

  private entryHeader(input: EntryInput): Pick<PreparedEntry, 'namespace' | 'type' | 'schemaVersion' | 'createdAt'> {
    return { namespace: input.namespace, type: input.type, schemaVersion: input.schemaVersion, createdAt: input.createdAt };
  }

  private entryQuerySql(query: EntryQuery): { sql: string; params: SQLInputValue[]; limit: number } {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (query.sessionId !== undefined) {
      where.push('session_id = ?');
      params.push(query.sessionId);
    }
    if (query.namespace !== undefined) {
      where.push('namespace = ?');
      params.push(query.namespace);
    }
    if (query.type !== undefined) {
      where.push('type = ?');
      params.push(query.type);
    }
    if (query.path !== undefined) {
      where.push('file_path = ?');
      params.push(query.path);
    }
    if (query.afterSeq !== undefined) {
      where.push('seq > ?');
      params.push(query.afterSeq);
    }
    if (query.beforeSeq !== undefined) {
      where.push('seq < ?');
      params.push(query.beforeSeq);
    }
    const limit = clampLimit(query.limit);
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const sql = `SELECT * FROM entries${where.length === 0 ? '' : ` WHERE ${where.join(' AND ')}`} ORDER BY seq ${order} LIMIT ?`;
    params.push(limit + 1);
    return { sql, params, limit };
  }

  private maxSeqIn(db: DatabaseSync): number {
    const row = db.prepare('SELECT COALESCE(MAX(seq), 0) AS value FROM entries').get() as { value: number };
    return row.value;
  }

  private cursorIn(db: DatabaseSync): number {
    const row = db.prepare('SELECT value FROM history_state WHERE state_key = ?').get(UNDO_CURSOR_KEY) as { value: number } | undefined;
    return row?.value ?? this.maxSeqIn(db);
  }

  private setCursorIn(db: DatabaseSync, seq: number): void {
    db.prepare('INSERT INTO history_state (state_key, value) VALUES (?, ?) ON CONFLICT(state_key) DO UPDATE SET value = excluded.value')
      .run(UNDO_CURSOR_KEY, seq);
  }

  private seedSessionSequenceInTx(day: string, next: number): void {
    this.writer()
      .prepare(`INSERT INTO session_sequence (day, next) VALUES (?, ?)
                ON CONFLICT(day) DO UPDATE SET next = MAX(next, excluded.next)`)
      .run(day, next);
  }

  private async openReadOnlySnapshot(dbPath: string): Promise<DatabaseSync | undefined> {
    try {
      if (!(await this.options.driver.exists(dbPath))) {
        return undefined;
      }
      // `immutable=1` reads without -wal/-shm side files, which a read-only
      // directory cannot hold. Frames still in an unmerged WAL are not seen.
      const db = new DatabaseSync(`${pathToFileURL(dbPath).href}?immutable=1`, { readOnly: true });
      configureConnection(db, false);
      if (readSchemaVersion(db) === 0) {
        db.close();
        return undefined;
      }
      return db;
    } catch {
      return undefined;
    }
  }

  private degrade(reason: HistoryDegradedReason): StoreOpenResult {
    if (this.degraded === undefined) {
      this.degraded = reason;
      this.options.onWarning?.({
        code: 'HISTORY_DEGRADED',
        reason,
        message: `Universal history is degraded (${reason}); history is read-only and recording is disabled`,
      });
    }
    this.opened = { mode: 'degraded', reason };
    return this.opened;
  }

  private reader(): DatabaseSync | undefined {
    if (this.opened === undefined || this.closed) {
      throw new UnifiedStoreClosedError();
    }
    return this.db;
  }

  private writer(): DatabaseSync {
    const db = this.reader();
    if (this.degraded !== undefined || db === undefined) {
      throw new UnifiedHistoryDegradedError(this.degraded ?? 'READ_ONLY_STORAGE');
    }
    return db;
  }

  private mutate<T>(work: () => T): T {
    if (this.degraded !== undefined) {
      this.reader();
      throw new UnifiedHistoryDegradedError(this.degraded);
    }
    try {
      return work();
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  private async mutateAsync<T>(work: () => Promise<T>): Promise<T> {
    if (this.degraded !== undefined) {
      this.reader();
      throw new UnifiedHistoryDegradedError(this.degraded);
    }
    try {
      return await work();
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  private translateWriteError(error: unknown): unknown {
    if (isReadOnlyStorageError(error)) {
      this.degrade('READ_ONLY_STORAGE');
      return new UnifiedHistoryDegradedError('READ_ONLY_STORAGE');
    }
    return error;
  }

  private immediate<T>(work: () => T): T {
    if (this.inTransaction) {
      return work();
    }
    const db = this.writer();
    db.exec('BEGIN IMMEDIATE');
    this.inTransaction = true;
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // SQLite may already have rolled back.
      }
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }
}
