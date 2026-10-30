/**
 * Unified history service core (D-15, U-3).
 *
 * One service records every file mutation (built-in `brud.core.file`), runs
 * explicit sessions with guaranteed baselines (built-in `brud.core.session-target`),
 * and accepts schema-validated entries from namespace-bound producers.
 * Not the kernel default until Switch (U-6).
 */
import type { IBrudFileSystem } from '../../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
import type { FileMutationEvent, IFileMutationJournal } from '../../../BrudFileSystem/events/types.js';
import { compileJsonSchema } from '../../../ValidationService/engine/jsonSchema/index.js';
import type { CompiledJsonSchema } from '../../../ValidationService/engine/jsonSchema/index.js';
import { sha256Hex } from '../store/cas.js';
import { UnifiedSessionNotFoundError } from '../store/errors.js';
import type { UnifiedHistoryStore } from '../store/UnifiedHistoryStore.js';
import type { IStorageDriver } from '../../../../drivers/contracts/index.js';
import { LegacyImporter } from '../import/LegacyImporter.js';
import type { LegacyImportReport } from '../import/LegacyImporter.js';
import type { EntryPage, EntryQuery, EntryRow, PreparedEntry, SessionPage, SessionQuery, SessionRow } from '../store/types.js';
import {
  BUILTIN_ENTRY_TYPES,
  CORE_NAMESPACE,
  FILE_ENTRY_TYPE,
  SESSION_TARGET_ENTRY_TYPE,
} from './builtinTypes.js';
import type { FileEntryPayload, SessionTargetPayload } from './builtinTypes.js';
import {
  UnifiedEntrySchemaError,
  UnifiedEntryTypeNotRegisteredError,
  UnifiedEntryValidationError,
  UnifiedNamespaceError,
  UnifiedSessionStateError,
} from './errors.js';
import { createNamespaceHandle } from './NamespaceHandle.js';
import { isBinaryContent, isHistoryPath, normalizeTargetPath, normalizeTargets } from './targets.js';
import type {
  Disposable,
  EntryRecordInput,
  EntryReversal,
  EntryTypeRegistration,
  NamespaceHistoryHandle,
  SessionMetadata,
  TargetBaseline,
  UnifiedCommitReceipt,
  UnifiedSessionView,
} from './types.js';

const NAMESPACE_PATTERN = /^(?:@[a-z0-9][a-z0-9-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const TYPE_PATTERN = /^[a-z][a-z0-9-]*$/u;

export function isReservedNamespace(namespace: string): boolean {
  return namespace === 'brud' || namespace.startsWith('brud.') || namespace.startsWith('@brud/');
}

export interface UnifiedHistoryServiceOptions {
  readonly store: UnifiedHistoryStore;
  /** Lazily resolved kernel filesystem (reads only). */
  readonly fileSystem: () => IBrudFileSystem;
  /** Mutation feed recorded as `brud.core.file`. Optional for standalone use. */
  readonly journal?: IFileMutationJournal;
  readonly now?: () => number;
  /** Background recording failures (legacy F5). */
  readonly onError?: (error: unknown, context: Readonly<Record<string, unknown>>) => void;
  /** Import legacy `history.db` / `ledger.db` / `seq.json` at start (B-D4). */
  readonly importLegacy?: boolean;
  /** Storage driver for the importer (required when `importLegacy` is true). */
  readonly driver?: IStorageDriver;
}

interface ActiveSession {
  readonly declared: ReadonlySet<string>;
  readonly order: number;
}

function typeKey(namespace: string, type: string, schemaVersion: number): string {
  return `${namespace}\u0000${type}\u0000${schemaVersion}`;
}

export class UnifiedHistoryService {
  private readonly validators = new Map<string, CompiledJsonSchema>();

  private readonly reversals = new Map<string, EntryReversal>();

  private readonly activeExplicit = new Map<string, ActiveSession>();

  private readonly captures = new Map<string, Promise<void>>();

  private implicitSessionId: string | undefined;

  private sessionOrder = 0;

  private queue: Promise<void> = Promise.resolve();

  private pending = 0;

  private suspended = 0;

  private unsubscribe: (() => void) | undefined;

  private started = false;

  private readonly now: () => number;

  constructor(private readonly options: UnifiedHistoryServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  get store(): UnifiedHistoryStore {
    return this.options.store;
  }

  get isDegraded(): boolean {
    return this.options.store.isDegraded;
  }

  /** Current implicit (automatic recording) session, if writable. */
  get implicitSession(): string | undefined {
    return this.implicitSessionId;
  }

  /** Opens storage, registers built-in types, starts recording. Idempotent. */
  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    const opened = await this.options.store.open();

    if (opened.mode === 'writable') {
      if (this.options.importLegacy === true && this.options.driver !== undefined) {
        await this.runLegacyImport(this.options.driver);
      }
      for (const builtin of BUILTIN_ENTRY_TYPES) {
        this.registerEntryType(CORE_NAMESPACE, {
          type: builtin.type,
          schemaVersion: builtin.schemaVersion,
          payloadSchema: builtin.payloadSchema,
          reversal: { mode: 'none' },
        }, 'kernel');
      }
      this.implicitSessionId = this.options.store.createSession({ prompt: 'automatic recording', implicit: true, now: this.now() }).sessionId;
      let page = this.options.store.listSessions({ status: 'active', limit: 1000 });
      for (;;) {
        for (const row of page.rows) {
          this.trackActive(row);
        }
        if (page.next === undefined) {
          break;
        }
        page = this.options.store.listSessions({ status: 'active', limit: 1000, before: page.next });
      }
    }

    this.unsubscribe = this.options.journal?.subscribe((event) => {
      this.handleEvent(event);
    });
  }

  /** Stops recording, drains the queue, closes the implicit session and storage. */
  async dispose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    await this.flush();
    const implicit = this.implicitSessionId;
    if (implicit !== undefined && !this.isDegraded) {
      try {
        this.options.store.transitionSession(implicit, ['active'], 'committed', this.now());
      } catch (error) {
        this.report(error, { phase: 'dispose' });
      }
    }
    this.options.store.close();
  }

  /** Reports from the legacy import run at start, if any. */
  get importReports(): readonly LegacyImportReport[] {
    return this.lastImportReports;
  }

  private lastImportReports: readonly LegacyImportReport[] = [];

  private async runLegacyImport(driver: IStorageDriver): Promise<void> {
    // Built-in types must exist before imported entries reference them.
    for (const builtin of BUILTIN_ENTRY_TYPES) {
      this.registerEntryType(CORE_NAMESPACE, {
        type: builtin.type,
        schemaVersion: builtin.schemaVersion,
        payloadSchema: builtin.payloadSchema,
        reversal: { mode: 'none' },
      }, 'kernel');
    }
    try {
      this.lastImportReports = await new LegacyImporter({
        store: this.options.store,
        historyRoot: this.options.store.historyRoot,
        driver,
        now: this.now,
      }).run();
    } catch (error) {
      this.report(error, { phase: 'legacy-import' });
      return;
    }
    for (const report of this.lastImportReports) {
      if (report.status === 'failed' || report.status === 'source-changed') {
        this.report(new Error(report.message ?? report.status), { phase: 'legacy-import', source: report.source, status: report.status });
      }
    }
  }

  // ── registration ────────────────────────────────────────────────────

  /**
   * Registers an entry type for `namespace`. The schema is compiled by the
   * kernel validator (fail closed) and persisted, so entries outlive their
   * producer. The returned disposable only releases the in-memory reversal
   * callbacks.
   */
  registerEntryType(namespace: string, registration: EntryTypeRegistration, registeredBy: string): Disposable {
    if (!NAMESPACE_PATTERN.test(namespace)) {
      throw new UnifiedNamespaceError(`Invalid history namespace "${namespace}"`);
    }
    if (!TYPE_PATTERN.test(registration.type) || !Number.isSafeInteger(registration.schemaVersion) || registration.schemaVersion < 1) {
      throw new UnifiedNamespaceError(`Invalid entry type "${registration.type}" v${String(registration.schemaVersion)}`);
    }
    const id = `${namespace}.${registration.type}`;
    const compiled = compileJsonSchema(registration.payloadSchema);
    if (!compiled.ok) {
      throw new UnifiedEntrySchemaError(id, compiled.errors);
    }
    this.options.store.registerEntryType({
      namespace,
      type: registration.type,
      schemaVersion: registration.schemaVersion,
      payloadSchema: registration.payloadSchema,
      reversalMode: registration.reversal.mode,
      registeredBy,
      registeredAt: this.now(),
    });
    const key = typeKey(namespace, registration.type, registration.schemaVersion);
    this.validators.set(key, compiled.schema);
    this.reversals.set(key, registration.reversal);
    const reversal = registration.reversal;
    let disposed = false;
    return Object.freeze({
      dispose: (): void => {
        if (!disposed && this.reversals.get(key) === reversal) {
          this.reversals.delete(key);
        }
        disposed = true;
      },
    });
  }

  /** Reversal callbacks of an active registration, if its owner is live. */
  reversalFor(namespace: string, type: string, schemaVersion: number): EntryReversal | undefined {
    return this.reversals.get(typeKey(namespace, type, schemaVersion));
  }

  /** Validates a payload against its registered schema (persisted schemas included). */
  validatePayload(namespace: string, type: string, schemaVersion: number, payload: unknown): void {
    const result = this.validatorFor(namespace, type, schemaVersion).validate(payload);
    if (!result.valid) {
      throw new UnifiedEntryValidationError(`${namespace}.${type}`, result.violations);
    }
  }

  // ── sessions ────────────────────────────────────────────────────────

  /** Begins an explicit session and captures every declared target in full. */
  async beginSession(
    prompt: string,
    options: { readonly declaredTargets?: readonly string[]; readonly origin?: string } = {},
  ): Promise<string> {
    const targets = normalizeTargets(options.declaredTargets);
    const baseline: Record<string, TargetBaseline> = {};
    for (const target of targets) {
      baseline[target] = await this.captureCurrent(target, true);
    }
    const metadata: SessionMetadata = { declaredTargets: targets, baseline };
    const row = this.options.store.createSession({
      prompt,
      origin: options.origin ?? 'human',
      metadata,
      now: this.now(),
    });
    this.trackActive(row);
    return row.sessionId;
  }

  /** Commits or aborts an explicit session. Completed sessions record each changed target. */
  async commitSession(sessionId: string, outcome: 'completed' | 'aborted'): Promise<UnifiedCommitReceipt> {
    const row = this.requireSession(sessionId);
    if (row.implicit) {
      throw new UnifiedSessionStateError(sessionId, row.status, 'commit the implicit');
    }
    if (row.status !== 'active') {
      throw new UnifiedSessionStateError(sessionId, row.status, 'commit');
    }
    await this.flush();

    if (outcome === 'aborted') {
      this.options.store.transitionSession(sessionId, ['active'], 'aborted', this.now());
      this.activeExplicit.delete(sessionId);
      return { sessionId, committedFileCount: 0, blobs: [] };
    }

    const metadata = row.metadata as SessionMetadata;
    const prepared: PreparedEntry[] = [];
    const blobs: { sha256: string; relativePath: string }[] = [];

    for (const target of metadata.declaredTargets) {
      const before = metadata.baseline[target] as TargetBaseline;
      const after = await this.captureCurrent(target, true);
      if (before.exists === after.exists && before.sha256 === after.sha256) {
        continue;
      }
      const payload: SessionTargetPayload = {
        path: target,
        preSha256: before.sha256,
        postSha256: after.sha256,
        preSize: before.size,
        postSize: after.size,
        isBinary: before.isBinary || after.isBinary,
      };
      this.validatePayload(CORE_NAMESPACE, SESSION_TARGET_ENTRY_TYPE.type, 1, payload);
      prepared.push(await this.options.store.prepareEntry({
        namespace: CORE_NAMESPACE,
        type: SESSION_TARGET_ENTRY_TYPE.type,
        schemaVersion: 1,
        payload,
        createdAt: this.now(),
      }));
      if (after.sha256 !== null && (after.isBinary || after.size > 64 * 1024)) {
        blobs.push({ sha256: after.sha256, relativePath: target });
      }
    }

    this.options.store.transaction(() => {
      if (prepared.length > 0) {
        this.options.store.appendEntries(sessionId, prepared, { truncateRedoTail: true, advanceCursor: true });
      }
      this.options.store.transitionSession(sessionId, ['active'], 'committed', this.now());
    });
    this.activeExplicit.delete(sessionId);
    return { sessionId, committedFileCount: prepared.length, blobs };
  }

  getSessionView(sessionId: string): UnifiedSessionView | undefined {
    const session = this.options.store.getSession(sessionId);
    if (session === undefined) {
      return undefined;
    }
    const metadata = (session.metadata ?? { declaredTargets: [], baseline: {} }) as SessionMetadata;
    const rows = this.collectEntries({ sessionId, namespace: CORE_NAMESPACE, type: SESSION_TARGET_ENTRY_TYPE.type, order: 'asc' });
    return {
      session,
      declaredTargets: metadata.declaredTargets ?? [],
      baseline: metadata.baseline ?? {},
      targets: rows.map((entry) => ({ entry, payload: JSON.parse(entry.payloadJson ?? 'null') as unknown })),
    };
  }

  listSessions(query?: SessionQuery): SessionPage {
    return this.options.store.listSessions(query);
  }

  /**
   * Starts a new implicit recording session (legacy journal `beginSession`).
   * The previous implicit session is closed as committed.
   */
  openRecordingSession(label: string): string {
    const previous = this.implicitSessionId;
    const row = this.options.store.createSession({ prompt: label, implicit: true, now: this.now() });
    this.implicitSessionId = row.sessionId;
    if (previous !== undefined) {
      this.options.store.transitionSession(previous, ['active'], 'committed', this.now());
    }
    return row.sessionId;
  }

  // ── entries ─────────────────────────────────────────────────────────

  /** Validates and appends one entry for `namespace` into an active session. */
  async recordEntry(namespace: string, sessionId: string, input: EntryRecordInput): Promise<number> {
    const row = this.requireSession(sessionId);
    if (row.status !== 'active') {
      throw new UnifiedSessionStateError(sessionId, row.status, 'record into');
    }
    this.validatePayload(namespace, input.type, input.schemaVersion, input.payload);
    if (input.inversePayload !== undefined) {
      this.validatePayload(namespace, input.type, input.schemaVersion, input.inversePayload);
    }
    const prepared = await this.options.store.prepareEntry({
      namespace,
      type: input.type,
      schemaVersion: input.schemaVersion,
      payload: input.payload,
      inversePayload: input.inversePayload,
      createdAt: this.now(),
    });
    const [appended] = this.options.store.appendEntries(sessionId, [prepared], { truncateRedoTail: true, advanceCursor: true });
    return (appended as EntryRow).seq;
  }

  listEntries(query?: EntryQuery): EntryPage {
    return this.options.store.listEntries(query);
  }

  resolvePayload(entry: EntryRow): Promise<unknown> {
    return this.options.store.resolvePayload(entry);
  }

  /** A handle confined to one namespace (plugins). Reserved namespaces are refused. */
  forNamespace(namespace: string): NamespaceHistoryHandle {
    if (!NAMESPACE_PATTERN.test(namespace) || isReservedNamespace(namespace)) {
      throw new UnifiedNamespaceError(`Namespace "${namespace}" is reserved or invalid`);
    }
    return createNamespaceHandle(this, namespace);
  }

  // ── recording ───────────────────────────────────────────────────────

  /** Waits for every mutation published so far to be recorded. */
  async flush(): Promise<void> {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    do {
      await this.queue;
      await Promise.allSettled([...this.captures.values()]);
    } while (this.pending > 0);
  }

  /** Suspends automatic recording (used while the reversal engine writes). Nestable. */
  suspendRecording(): void {
    this.suspended += 1;
  }

  resumeRecording(): void {
    this.suspended = Math.max(0, this.suspended - 1);
  }

  private handleEvent(event: FileMutationEvent): void {
    if (this.suspended > 0 || this.isDegraded || isHistoryPath(event.path)) {
      return;
    }
    if (event.phase === 'before') {
      const previous = event.previous.sha256;
      if (previous !== null && previous.length > 0) {
        this.captures.set(event.mutationId, this.capturePreImage(event, previous));
      }
      return;
    }
    if (event.committed === false) {
      return;
    }
    let sessionId: string | undefined;
    try {
      sessionId = this.attribute(event.path);
    } catch (error) {
      this.report(error, { mutationId: event.mutationId, path: event.path });
      return;
    }
    if (sessionId === undefined) {
      return;
    }
    const target = sessionId;
    this.pending += 1;
    this.queue = this.queue
      .then(() => this.recordMutation(event, target))
      .catch((error: unknown) => {
        this.report(error, { mutationId: event.mutationId, path: event.path });
      })
      .finally(() => {
        this.pending -= 1;
        this.captures.delete(event.mutationId);
      });
  }

  /** Most recently begun active explicit session that declared the path; otherwise the implicit session. */
  private attribute(path: string): string | undefined {
    const normalized = normalizeTargetPath(path);
    let best: { id: string; order: number } | undefined;
    for (const [id, session] of this.activeExplicit) {
      if (session.declared.has(normalized) && (best === undefined || session.order > best.order)) {
        best = { id, order: session.order };
      }
    }
    return best?.id ?? this.implicitSessionId;
  }

  private async capturePreImage(event: FileMutationEvent, expected: string): Promise<void> {
    if (this.options.store.hasContent(expected)) {
      return;
    }
    try {
      const bytes = await this.options.fileSystem().readFile(event.path);
      if (sha256Hex(bytes) === expected) {
        await this.options.store.putContent(bytes);
      }
    } catch (error) {
      this.report(error, { mutationId: event.mutationId, path: event.path, phase: 'pre-image' });
    }
  }

  private async recordMutation(event: FileMutationEvent, sessionId: string): Promise<void> {
    const operation: FileEntryPayload['operation'] = event.operation === 'unlink'
      ? 'unlink'
      : event.operation === 'mkdir' ? 'mkdir' : 'write';
    const path = normalizeTargetPath(event.path);
    const preSha256 = operation === 'mkdir' ? null : event.previous.sha256 ?? null;
    const postSha256 = operation === 'mkdir' || operation === 'unlink' ? null : event.updated.sha256 ?? null;

    await this.captures.get(event.mutationId);

    if (postSha256 !== null && !this.options.store.hasContent(postSha256)) {
      try {
        const bytes = await this.options.fileSystem().readFile(event.path);
        if (sha256Hex(bytes) === postSha256) {
          await this.options.store.putContent(bytes);
        }
      } catch (error) {
        this.report(error, { mutationId: event.mutationId, path: event.path, phase: 'post-image' });
      }
    }

    const payload: FileEntryPayload = {
      path,
      operation,
      preSha256,
      postSha256,
      preCaptured: preSha256 === null || this.options.store.hasContent(preSha256),
      nodeKind: event.updated.kind,
      size: event.updated.size,
    };
    this.validatePayload(CORE_NAMESPACE, FILE_ENTRY_TYPE.type, 1, payload);
    const prepared = await this.options.store.prepareEntry({
      namespace: CORE_NAMESPACE,
      type: FILE_ENTRY_TYPE.type,
      schemaVersion: 1,
      payload,
      createdAt: event.timestamp,
    });
    if (this.options.store.getSession(sessionId)?.status !== 'active') {
      sessionId = this.implicitSessionId ?? sessionId;
    }
    this.options.store.appendEntries(sessionId, [prepared], { truncateRedoTail: true, advanceCursor: true });
  }

  // ── internals ───────────────────────────────────────────────────────

  private validatorFor(namespace: string, type: string, schemaVersion: number): CompiledJsonSchema {
    const key = typeKey(namespace, type, schemaVersion);
    const cached = this.validators.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const row = this.options.store.getEntryType(namespace, type, schemaVersion);
    if (row === undefined) {
      throw new UnifiedEntryTypeNotRegisteredError(`${namespace}.${type} v${schemaVersion}`);
    }
    const compiled = compileJsonSchema(JSON.parse(row.payloadSchema));
    if (!compiled.ok) {
      throw new UnifiedEntrySchemaError(`${namespace}.${type}`, compiled.errors);
    }
    this.validators.set(key, compiled.schema);
    return compiled.schema;
  }

  private requireSession(sessionId: string): SessionRow {
    const row = this.options.store.getSession(sessionId);
    if (row === undefined) {
      throw new UnifiedSessionNotFoundError(sessionId);
    }
    return row;
  }

  private trackActive(row: SessionRow): void {
    if (row.implicit || row.status !== 'active') {
      return;
    }
    const metadata = row.metadata as SessionMetadata | null;
    this.sessionOrder += 1;
    this.activeExplicit.set(row.sessionId, {
      declared: new Set(metadata?.declaredTargets ?? []),
      order: this.sessionOrder,
    });
  }

  /** Reads a target's current state; stores its bytes when `store` is true. */
  private async captureCurrent(target: string, store: boolean): Promise<TargetBaseline> {
    const fs = this.options.fileSystem();
    if (!(await fs.exists(target))) {
      return { exists: false, sha256: null, size: 0, isBinary: false };
    }
    const bytes = await fs.readFile(target);
    if (store) {
      await this.options.store.putContent(bytes);
    }
    return { exists: true, sha256: sha256Hex(bytes), size: bytes.byteLength, isBinary: isBinaryContent(bytes) };
  }

  private collectEntries(query: EntryQuery): EntryRow[] {
    const rows: EntryRow[] = [];
    let page = this.options.store.listEntries({ ...query, limit: 1000 });
    for (;;) {
      rows.push(...page.rows);
      if (page.nextSeq === undefined) {
        return rows;
      }
      page = this.options.store.listEntries({
        ...query,
        limit: 1000,
        ...(query.order === 'asc' ? { afterSeq: page.nextSeq } : { beforeSeq: page.nextSeq }),
      });
    }
  }

  private report(error: unknown, context: Readonly<Record<string, unknown>>): void {
    try {
      this.options.onError?.(error, context);
    } catch {
      // A failing sink must never break recording.
    }
  }
}
