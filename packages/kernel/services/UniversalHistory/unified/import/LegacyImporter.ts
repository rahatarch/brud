/**
 * One-way, idempotent import of the two legacy history engines into the
 * unified store (D-15, U-5; decisions D4, B-D4).
 *
 * Sources under `.brud/history/`: `history.db` (journal), `ledger.db`
 * (session ledger), `seq.json` (session id counter), and the legacy `blobs/`
 * tree. Sources are opened read-only and never modified. Every byte copied is
 * re-hashed. Each source is validated in full (dry run), then committed in
 * one transaction, and recorded in `imports` with its SHA-256 so a re-run is a
 * no-op and a later change to the source is reported instead of re-imported.
 */
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IStorageDriver } from '../../../../drivers/contracts/index.js';
import { compileJsonSchema } from '../../../ValidationService/engine/jsonSchema/index.js';
import type { CompiledJsonSchema } from '../../../ValidationService/engine/jsonSchema/index.js';
import { sha256Hex } from '../store/cas.js';
import type { UnifiedHistoryStore } from '../store/UnifiedHistoryStore.js';
import type { PersistedSessionStatus, PreparedEntry } from '../store/types.js';
import { CORE_NAMESPACE, FILE_ENTRY_TYPE, SESSION_TARGET_ENTRY_TYPE } from '../service/builtinTypes.js';
import type { FileEntryPayload, SessionTargetPayload } from '../service/builtinTypes.js';
import { isBinaryContent, normalizeTargetPath } from '../service/targets.js';
import type { SessionMetadata, TargetBaseline } from '../service/types.js';
import { reconstructText } from './diff.js';

export type LegacySource = 'history.db' | 'ledger.db' | 'seq.json';

export interface LegacyImportReport {
  readonly source: LegacySource;
  readonly status: 'imported' | 'already-imported' | 'source-changed' | 'absent' | 'failed';
  readonly rows: number;
  /** Content items that could not be recovered (lost pre-images, missing blobs). */
  readonly unrecovered: number;
  readonly message?: string;
}

export interface LegacyImporterOptions {
  readonly store: UnifiedHistoryStore;
  /** Absolute `.brud/history` path. */
  readonly historyRoot: string;
  readonly driver: IStorageDriver;
  readonly now?: () => number;
}

type Row = Record<string, unknown>;

const ZERO_SHA = '0'.repeat(64);
const SHA_PATTERN = /^[0-9a-f]{64}$/u;
const VALID_STATUSES: ReadonlySet<string> = new Set(['active', 'committed', 'aborted', 'reverted']);

function digest(value: unknown): string | null {
  return typeof value === 'string' && SHA_PATTERN.test(value) && value !== ZERO_SHA ? value : null;
}

function parseTime(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export class LegacyImporter {
  private readonly now: () => number;

  private readonly workspaceRoot: string;

  private readonly validators: { readonly file: CompiledJsonSchema; readonly target: CompiledJsonSchema };

  constructor(private readonly options: LegacyImporterOptions) {
    this.now = options.now ?? Date.now;
    this.workspaceRoot = resolve(options.historyRoot, '..', '..');
    const file = compileJsonSchema(FILE_ENTRY_TYPE.payloadSchema);
    const target = compileJsonSchema(SESSION_TARGET_ENTRY_TYPE.payloadSchema);
    if (!file.ok || !target.ok) {
      throw new Error('built-in entry schemas failed to compile');
    }
    this.validators = { file: file.schema, target: target.schema };
  }

  /** Imports every legacy source that has not been imported yet. Never throws for a source failure. */
  async run(): Promise<readonly LegacyImportReport[]> {
    const reports: LegacyImportReport[] = [];
    reports.push(await this.guard('history.db', () => this.importJournal()));
    reports.push(await this.guard('ledger.db', () => this.importLedger()));
    reports.push(await this.guard('seq.json', () => this.importSequence()));
    return reports;
  }

  // ── orchestration ───────────────────────────────────────────────────

  private async guard(source: LegacySource, work: () => Promise<LegacyImportReport>): Promise<LegacyImportReport> {
    try {
      const path = join(this.options.historyRoot, source);
      if (!(await this.options.driver.exists(path))) {
        return { source, status: 'absent', rows: 0, unrecovered: 0 };
      }
      const sourceSha = sha256Hex(await this.options.driver.readFile(path));
      const previous = this.options.store.getImport(source);
      if (previous !== undefined) {
        return previous.sourceSha256 === sourceSha
          ? { source, status: 'already-imported', rows: previous.rows, unrecovered: 0 }
          : { source, status: 'source-changed', rows: previous.rows, unrecovered: 0, message: `${source} changed after it was imported; it is not imported again` };
      }
      const report = await work();
      return report.status === 'imported' ? { ...report, message: `sha256 ${sourceSha}` } : report;
    } catch (error) {
      return { source, status: 'failed', rows: 0, unrecovered: 0, message: error instanceof Error ? error.message : String(error) };
    }
  }

  private openReadOnly(source: LegacySource): DatabaseSync {
    const path = join(this.options.historyRoot, source);
    try {
      return new DatabaseSync(path, { readOnly: true });
    } catch {
      return new DatabaseSync(`${pathToFileURL(path).href}?immutable=1`, { readOnly: true });
    }
  }

  private async sourceSha(source: LegacySource): Promise<string> {
    return sha256Hex(await this.options.driver.readFile(join(this.options.historyRoot, source)));
  }

  private async readLegacyBlob(sha: string, layout: 'flat' | 'sharded'): Promise<Uint8Array | null> {
    const path = layout === 'flat'
      ? join(this.options.historyRoot, 'blobs', sha)
      : join(this.options.historyRoot, 'blobs', sha.slice(0, 2), sha);
    try {
      if (!(await this.options.driver.exists(path))) {
        return null;
      }
      const bytes = await this.options.driver.readFile(path);
      return sha256Hex(bytes) === sha ? bytes : null;
    } catch {
      return null;
    }
  }

  private async readWorkspaceFile(relative: string): Promise<Uint8Array | null> {
    try {
      const path = join(this.workspaceRoot, normalizeTargetPath(relative));
      if (!(await this.options.driver.exists(path))) {
        return null;
      }
      const stats = await this.options.driver.stat(path);
      return stats === null || stats.isDirectory ? null : await this.options.driver.readFile(path);
    } catch {
      return null;
    }
  }

  private validate(validator: CompiledJsonSchema, payload: unknown, what: string): void {
    const result = validator.validate(payload);
    if (!result.valid) {
      throw new Error(`${what} does not match its schema: ${result.violations.map((v) => `${v.instancePath} ${v.message}`).join('; ')}`);
    }
  }

  // ── history.db (journal) ────────────────────────────────────────────

  private async importJournal(): Promise<LegacyImportReport> {
    const source: LegacySource = 'history.db';
    const sourceSha = await this.sourceSha(source);
    const db = this.openReadOnly(source);
    let sessions: Row[];
    let mutations: Row[];
    let contents: Row[];
    let checkpoints: Row[];
    let cursorRow: Row | undefined;
    try {
      sessions = db.prepare('SELECT * FROM sessions').all() as Row[];
      mutations = db.prepare('SELECT * FROM mutations ORDER BY seq ASC').all() as Row[];
      contents = db.prepare('SELECT sha256, inline_data, blob_ref FROM contents').all() as Row[];
      checkpoints = db.prepare('SELECT * FROM checkpoints ORDER BY created_at ASC').all() as Row[];
      cursorRow = db.prepare("SELECT value FROM history_state WHERE state_key = 'undo_cursor'").get() as Row | undefined;
    } finally {
      db.close();
    }

    // Dry run: build and validate every entry before writing anything.
    const recovered = new Map<string, Uint8Array>();
    let unrecovered = 0;
    for (const row of contents) {
      const sha = digest(row.sha256);
      if (sha === null) {
        continue;
      }
      const inline = row.inline_data;
      const bytes = inline !== null && inline !== undefined ? Uint8Array.from(inline as Uint8Array) : await this.readLegacyBlob(sha, 'flat');
      if (bytes !== null && sha256Hex(bytes) === sha) {
        recovered.set(sha, bytes);
      } else {
        unrecovered += 1;
      }
    }

    const planned: { oldSeq: number; sessionId: string; payload: FileEntryPayload; createdAt: number }[] = [];
    for (const row of mutations) {
      const operation = row.operation_kind === 'unlink' ? 'unlink' : row.operation_kind === 'mkdir' ? 'mkdir' : 'write';
      const metadata = (parseJson(row.metadata) ?? {}) as { nodeKind?: unknown; size?: unknown };
      const preSha256 = operation === 'mkdir' ? null : digest(row.previous_hash);
      const postSha256 = operation === 'mkdir' || operation === 'unlink' ? null : digest(row.updated_hash);
      const payload: FileEntryPayload = {
        path: normalizeTargetPath(String(row.path)),
        operation,
        preSha256,
        postSha256,
        preCaptured: preSha256 === null || recovered.has(preSha256),
        nodeKind: metadata.nodeKind === 'missing' || metadata.nodeKind === 'directory' || metadata.nodeKind === 'file'
          ? metadata.nodeKind
          : operation === 'mkdir' ? 'directory' : operation === 'unlink' ? 'missing' : 'file',
        size: typeof metadata.size === 'number' && Number.isSafeInteger(metadata.size) && metadata.size >= 0 ? metadata.size : 0,
      };
      this.validate(this.validators.file, payload, `history.db mutation ${String(row.mutation_id)}`);
      planned.push({ oldSeq: Number(row.seq), sessionId: String(row.session_id), payload, createdAt: parseTime(row.timestamp, this.now()) });
    }

    // Content first (idempotent, outside the transaction).
    for (const bytes of recovered.values()) {
      await this.options.store.putContent(bytes);
    }
    const prepared: PreparedEntry[] = [];
    for (const item of planned) {
      prepared.push(await this.options.store.prepareEntry({
        namespace: CORE_NAMESPACE,
        type: FILE_ENTRY_TYPE.type,
        schemaVersion: 1,
        payload: item.payload,
        createdAt: item.createdAt,
      }));
    }

    const sessionTimes = new Map<string, number>();
    for (const row of sessions) {
      sessionTimes.set(String(row.session_id), parseTime(row.created_at, this.now()));
    }

    const store = this.options.store;
    store.transaction(() => {
      const ensureSession = (id: string): void => {
        if (store.getSession(id) !== undefined) {
          return;
        }
        const createdAt = sessionTimes.get(id) ?? this.now();
        store.insertSessionWithId({
          sessionId: id,
          createdAt,
          prompt: id,
          status: 'committed',
          origin: 'human',
          implicit: true,
          closedAt: createdAt,
          metadata: { importedFrom: source },
        });
      };
      for (const id of sessionTimes.keys()) {
        ensureSession(id);
      }
      const seqMap = new Map<number, number>();
      const base = store.maxSeq();
      planned.forEach((item, index) => {
        ensureSession(item.sessionId);
        const [row] = store.appendEntries(item.sessionId, [prepared[index] as PreparedEntry]);
        seqMap.set(item.oldSeq, (row as { seq: number }).seq);
      });
      const remap = (oldOffset: number): number => {
        let best = base;
        for (const [oldSeq, newSeq] of seqMap) {
          if (oldSeq <= oldOffset && newSeq > best) {
            best = newSeq;
          }
        }
        return best;
      };
      for (const row of checkpoints) {
        const sessionId = String(row.session_id);
        ensureSession(sessionId);
        store.insertCheckpoint({
          checkpointId: String(row.checkpoint_id),
          sessionId,
          label: String(row.label),
          seqOffset: remap(Number(row.ledger_offset)),
          createdAt: parseTime(row.created_at, this.now()),
          metadata: { importedFrom: source, legacy: parseJson(row.metadata) },
        });
      }
      const legacyCursor = cursorRow === undefined ? Number.POSITIVE_INFINITY : Number(cursorRow.value);
      store.setCursor(remap(legacyCursor));
      store.recordImport({ source, sourceSha256: sourceSha, importedAt: this.now(), rows: planned.length });
    });

    return { source, status: 'imported', rows: planned.length, unrecovered };
  }

  // ── ledger.db (session ledger) ──────────────────────────────────────

  private async importLedger(): Promise<LegacyImportReport> {
    const source: LegacySource = 'ledger.db';
    const sourceSha = await this.sourceSha(source);
    const db = this.openReadOnly(source);
    let sessions: Row[];
    let files: Row[];
    let reversals: Row[];
    try {
      sessions = db.prepare('SELECT * FROM sessions ORDER BY created_at ASC, session_id ASC').all() as Row[];
      files = db.prepare('SELECT * FROM session_files ORDER BY id ASC').all() as Row[];
      reversals = db.prepare('SELECT * FROM reversals').all() as Row[];
    } finally {
      db.close();
    }

    let unrecovered = 0;
    const byContent = new Map<string, Uint8Array>();
    const targetsBySession = new Map<string, SessionTargetPayload[]>();
    const baselineBySession = new Map<string, Record<string, TargetBaseline>>();

    for (const row of files) {
      const sessionId = String(row.session_id);
      const path = normalizeTargetPath(String(row.relative_path));
      const pre = digest(row.pre_sha256);
      const post = digest(row.post_sha256);
      if (pre === post) {
        continue;
      }
      const diff = typeof row.diff_content === 'string' ? row.diff_content : null;
      const isBinary = row.is_binary === 1;

      // Recover full bytes the way the legacy planner did: blobs first, then the
      // current file for the post side, then the stored diff for the other side.
      let postBytes = post === null ? null : await this.readLegacyBlob(post, 'sharded');
      if (post !== null && postBytes === null) {
        const current = await this.readWorkspaceFile(path);
        postBytes = current !== null && sha256Hex(current) === post ? current : null;
      }
      let preBytes = pre === null ? null : await this.readLegacyBlob(pre, 'sharded');
      if (pre !== null && preBytes === null && diff !== null && !isBinary) {
        const rebuilt = reconstructText(diff, postBytes, 'reverse');
        preBytes = sha256Hex(rebuilt) === pre ? rebuilt : null;
      }
      if (post !== null && postBytes === null && diff !== null && !isBinary && (pre === null || preBytes !== null)) {
        const rebuilt = reconstructText(diff, preBytes, 'forward');
        postBytes = sha256Hex(rebuilt) === post ? rebuilt : null;
      }
      for (const [sha, bytes] of [[pre, preBytes], [post, postBytes]] as const) {
        if (sha === null) {
          continue;
        }
        if (bytes === null) {
          unrecovered += 1;
        } else {
          byContent.set(sha, bytes);
        }
      }

      const payload: SessionTargetPayload = {
        path,
        preSha256: pre,
        postSha256: post,
        preSize: preBytes?.byteLength ?? 0,
        postSize: postBytes?.byteLength ?? 0,
        isBinary: isBinary || (preBytes !== null && isBinaryContent(preBytes)) || (postBytes !== null && isBinaryContent(postBytes)),
      };
      this.validate(this.validators.target, payload, `ledger.db row ${String(row.id)}`);
      const list = targetsBySession.get(sessionId) ?? [];
      list.push(payload);
      targetsBySession.set(sessionId, list);
      const baseline = baselineBySession.get(sessionId) ?? {};
      baseline[path] = { exists: pre !== null, sha256: pre, size: payload.preSize, isBinary: payload.isBinary };
      baselineBySession.set(sessionId, baseline);
    }

    for (const bytes of byContent.values()) {
      await this.options.store.putContent(bytes);
    }
    const preparedBySession = new Map<string, PreparedEntry[]>();
    for (const [sessionId, payloads] of targetsBySession) {
      const prepared: PreparedEntry[] = [];
      for (const payload of payloads) {
        prepared.push(await this.options.store.prepareEntry({
          namespace: CORE_NAMESPACE,
          type: SESSION_TARGET_ENTRY_TYPE.type,
          schemaVersion: 1,
          payload,
          createdAt: this.now(),
        }));
      }
      preparedBySession.set(sessionId, prepared);
    }

    const store = this.options.store;
    store.transaction(() => {
      for (const row of sessions) {
        const sessionId = String(row.session_id);
        const legacyStatus = String(row.status);
        // Legacy active sessions kept their baseline in process memory only; they cannot be committed.
        const status: PersistedSessionStatus = legacyStatus === 'active' || !VALID_STATUSES.has(legacyStatus)
          ? 'aborted'
          : legacyStatus as PersistedSessionStatus;
        const declared = parseJson(row.files_affected);
        const metadata: SessionMetadata & Record<string, unknown> = {
          declaredTargets: Array.isArray(declared) ? declared.map((value) => normalizeTargetPath(String(value))) : [],
          baseline: baselineBySession.get(sessionId) ?? {},
          importedFrom: source,
          ...(status === legacyStatus ? {} : { importedStatus: legacyStatus }),
        };
        const createdAt = parseTime(row.created_at, this.now());
        store.insertSessionWithId({
          sessionId,
          createdAt,
          prompt: String(row.prompt),
          status,
          origin: 'human',
          implicit: false,
          closedAt: status === 'active' ? null : createdAt,
          metadata,
        });
        const prepared = preparedBySession.get(sessionId);
        if (prepared !== undefined && prepared.length > 0) {
          store.appendEntries(sessionId, prepared);
        }
      }
      for (const row of reversals) {
        store.insertReversal({
          reversalId: String(row.reversal_id),
          sessionId: String(row.session_id),
          kind: 'session',
          targetState: row.target_state === null || row.target_state === undefined ? null : String(row.target_state),
          executedAt: parseTime(row.executed_at, this.now()),
          status: String(row.status),
          revertedEntries: [],
          errorMessage: row.error_message === null || row.error_message === undefined ? null : String(row.error_message),
        });
      }
      store.recordImport({ source, sourceSha256: sourceSha, importedAt: this.now(), rows: sessions.length });
    });

    return { source, status: 'imported', rows: sessions.length, unrecovered };
  }

  // ── seq.json (session id counter) ───────────────────────────────────

  private async importSequence(): Promise<LegacyImportReport> {
    const source: LegacySource = 'seq.json';
    const text = await this.options.driver.readText(join(this.options.historyRoot, source));
    const sourceSha = sha256Hex(new TextEncoder().encode(text));
    const parsed = JSON.parse(text) as { date?: unknown; sequence?: unknown };
    if (typeof parsed.date !== 'string' || !/^\d{8}$/u.test(parsed.date) || typeof parsed.sequence !== 'number' || !Number.isSafeInteger(parsed.sequence)) {
      throw new Error('seq.json is not a {date, sequence} document');
    }
    const day = parsed.date;
    const next = parsed.sequence + 1;
    this.options.store.transaction(() => {
      this.options.store.seedSessionSequence(day, next);
      this.options.store.recordImport({ source, sourceSha256: sourceSha, importedAt: this.now(), rows: 1 });
    });
    return { source, status: 'imported', rows: 1, unrecovered: 0 };
  }
}
