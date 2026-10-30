import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { InMemoryStorageDriver } from '../../../../drivers/memory/index.js';
import { DurableNodeStorageDriver } from '../../../BrudFileSystem/drivers/DurableNodeStorageDriver.js';
import {
  CAS_DIRECTORY,
  MAX_SESSIONS_PER_DAY,
  UnifiedBlobIntegrityError,
  UnifiedBlobMissingError,
  UnifiedHistoryDegradedError,
  UnifiedHistoryStore,
  UnifiedInvalidDigestError,
  UnifiedSessionIdExhaustedError,
  UnifiedSessionNotFoundError,
  UnifiedStoreConflictError,
  blobPath,
  sha256Hex,
} from '../store/index.js';
import type { HistoryStoreWarning, PreparedEntry } from '../store/index.js';

const MEMORY_ROOT = '/ws/.brud/history';
const DAY_MS = Date.UTC(2026, 9, 30, 12, 0, 0);
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

const FILE_TYPE = {
  namespace: 'brud.core',
  type: 'file',
  schemaVersion: 1,
  payloadSchema: { type: 'object' },
  reversalMode: 'none' as const,
  registeredBy: 'kernel',
  registeredAt: DAY_MS,
};

async function memoryStore(context: TestContext, warnings: HistoryStoreWarning[] = []): Promise<UnifiedHistoryStore> {
  const driver = new InMemoryStorageDriver();
  await driver.mkdir(MEMORY_ROOT, { recursive: true });
  const store = new UnifiedHistoryStore({
    dbPath: ':memory:',
    historyRoot: MEMORY_ROOT,
    driver,
    now: () => DAY_MS,
    onWarning: (warning) => warnings.push(warning),
  });
  assert.deepEqual(await store.open(), { mode: 'writable' });
  context.after(() => store.close());
  return store;
}

async function tempRoot(context: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'brud-unified-store-'));
  context.after(async () => {
    await chmod(join(root, '.brud', 'history'), 0o755).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

function fileStore(root: string, warnings: HistoryStoreWarning[] = []): UnifiedHistoryStore {
  const historyRoot = join(root, '.brud', 'history');
  return new UnifiedHistoryStore({
    dbPath: join(historyRoot, 'universal.db'),
    historyRoot,
    driver: new DurableNodeStorageDriver(),
    onWarning: (warning) => warnings.push(warning),
  });
}

function entry(payload: unknown, overrides: Partial<PreparedEntry> = {}): PreparedEntry {
  return {
    namespace: 'brud.core',
    type: 'file',
    schemaVersion: 1,
    payloadJson: JSON.stringify(payload),
    payloadSha256: null,
    inversePayloadJson: null,
    createdAt: DAY_MS,
    ...overrides,
  };
}

async function listFiles(directory: string): Promise<string[]> {
  if (!existsSync(directory)) {
    return [];
  }
  const out: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, item.name);
    if (item.isDirectory()) {
      out.push(...await listFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

describe('UnifiedHistoryStore — migrations and constraints', () => {
  it('creates every table and index, reopens idempotently, and uses STRICT tables', async (context) => {
    const root = await tempRoot(context);
    const store = fileStore(root);
    assert.deepEqual(await store.open(), { mode: 'writable' });
    assert.deepEqual(await store.open(), { mode: 'writable' });
    store.close();

    const db = new DatabaseSync(join(root, '.brud', 'history', 'universal.db'));
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    for (const expected of ['entry_types', 'sessions', 'session_sequence', 'contents', 'entries', 'checkpoints', 'reversals', 'history_state', 'imports', 'schema_migrations', 'idx_entries_path', 'idx_entries_session', 'idx_entries_type', 'idx_sessions_created']) {
      assert.ok(names.includes(expected), `missing ${expected}`);
    }
    assert.throws(() => db.exec("INSERT INTO history_state (state_key, value) VALUES ('x', 'not-an-integer')"), /cannot store TEXT value in INTEGER column/u);
    db.close();

    const again = fileStore(root);
    assert.deepEqual(await again.open(), { mode: 'writable' });
    again.close();
  });

  it('opens a database from a newer schema degraded (SCHEMA_TOO_NEW) and refuses writes', async (context) => {
    const root = await tempRoot(context);
    const first = fileStore(root);
    await first.open();
    first.close();
    const db = new DatabaseSync(join(root, '.brud', 'history', 'universal.db'));
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (99, 0)').run();
    db.close();

    const warnings: HistoryStoreWarning[] = [];
    const store = fileStore(root, warnings);
    assert.deepEqual(await store.open(), { mode: 'degraded', reason: 'SCHEMA_TOO_NEW' });
    context.after(() => store.close());
    assert.throws(() => store.createSession({ prompt: 'x', now: DAY_MS }), UnifiedHistoryDegradedError);
    assert.deepEqual(warnings.map((w) => [w.code, w.reason]), [['HISTORY_DEGRADED', 'SCHEMA_TOO_NEW']]);
  });

  it('rejects unregistered entry types, invalid JSON, and malformed content rows', async (context) => {
    const store = await memoryStore(context);
    const session = store.createSession({ prompt: 'p', now: DAY_MS });
    assert.throws(() => store.appendEntries(session.sessionId, [entry({ a: 1 })]), /FOREIGN KEY constraint failed/u);

    store.registerEntryType(FILE_TYPE);
    store.registerEntryType({ ...FILE_TYPE, namespace: 'acme', type: 'note' });
    // brud.core.file rows evaluate the generated file_path column (json_extract) first.
    assert.throws(() => store.appendEntries(session.sessionId, [entry(null, { payloadJson: '{not json' })]), /malformed JSON|CHECK constraint failed/u);
    assert.throws(() => store.appendEntries(session.sessionId, [entry(null, { namespace: 'acme', type: 'note', payloadJson: '{not json' })]), /CHECK constraint failed/u);
    assert.throws(() => store.appendEntries(session.sessionId, [entry(null, { payloadJson: null, payloadSha256: null })]), /CHECK constraint failed/u);
    assert.equal(store.maxSeq(), 0);
  });
});

describe('UnifiedHistoryStore — entry types', () => {
  it('treats identical re-registration as a no-op (key order ignored) and rejects conflicts', async (context) => {
    const store = await memoryStore(context);
    store.registerEntryType({ ...FILE_TYPE, payloadSchema: { type: 'object', required: ['a'] } });
    store.registerEntryType({ ...FILE_TYPE, payloadSchema: { required: ['a'], type: 'object' } });
    assert.equal(store.listEntryTypes().length, 1);
    assert.throws(() => store.registerEntryType({ ...FILE_TYPE, payloadSchema: { type: 'string' } }), UnifiedStoreConflictError);
    assert.throws(() => store.registerEntryType({ ...FILE_TYPE, reversalMode: 'handler', payloadSchema: { type: 'object', required: ['a'] } }), UnifiedStoreConflictError);
    store.registerEntryType({ ...FILE_TYPE, schemaVersion: 2 });
    assert.equal(store.listEntryTypes().length, 2);
  });
});

describe('UnifiedHistoryStore — sessions', () => {
  it('allocates BR-YYYYMMDD-NNN per UTC day inside the transaction', async (context) => {
    const store = await memoryStore(context);
    const a = store.createSession({ prompt: 'a', now: DAY_MS });
    const b = store.createSession({ prompt: 'b', now: DAY_MS + 1 });
    const nextDay = store.createSession({ prompt: 'c', now: DAY_MS + 24 * 3600 * 1000 });
    assert.equal(a.sessionId, 'BR-20261030-001');
    assert.equal(b.sessionId, 'BR-20261030-002');
    assert.equal(nextDay.sessionId, 'BR-20261031-001');
    assert.equal(a.status, 'active');
  });

  it('refuses the 10,000th session of a day', async (context) => {
    const store = await memoryStore(context);
    store.seedSessionSequence('20261030', MAX_SESSIONS_PER_DAY);
    assert.equal(store.createSession({ prompt: 'last', now: DAY_MS }).sessionId, 'BR-20261030-9999');
    assert.throws(() => store.createSession({ prompt: 'over', now: DAY_MS }), UnifiedSessionIdExhaustedError);
  });

  it('seeding never lowers the sequence; importing a known id bumps it', async (context) => {
    const store = await memoryStore(context);
    store.seedSessionSequence('20261030', 50);
    store.seedSessionSequence('20261030', 10);
    assert.equal(store.createSession({ prompt: 'x', now: DAY_MS }).sessionId, 'BR-20261030-050');
    store.insertSessionWithId({ sessionId: 'BR-20261030-120', createdAt: DAY_MS, prompt: 'imported', status: 'committed', origin: 'human', implicit: false, closedAt: DAY_MS, metadata: null });
    assert.equal(store.createSession({ prompt: 'y', now: DAY_MS }).sessionId, 'BR-20261030-121');
  });

  it('transitions status by compare-and-set', async (context) => {
    const store = await memoryStore(context);
    const s = store.createSession({ prompt: 'p', now: DAY_MS });
    store.transitionSession(s.sessionId, ['active'], 'committed', DAY_MS + 5);
    assert.equal(store.getSession(s.sessionId)?.status, 'committed');
    assert.equal(store.getSession(s.sessionId)?.closedAt, DAY_MS + 5);
    assert.throws(() => store.transitionSession(s.sessionId, ['active'], 'aborted', null), UnifiedStoreConflictError);
    assert.throws(() => store.transitionSession('BR-20261030-404', ['active'], 'aborted', null), UnifiedSessionNotFoundError);
  });

  it('lists newest first with keyset paging, filters, and implicit sessions hidden by default', async (context) => {
    const store = await memoryStore(context);
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      ids.push(store.createSession({ prompt: `s${i}`, now: DAY_MS + i }).sessionId);
    }
    store.createSession({ prompt: 'implicit', implicit: true, now: DAY_MS + 10 });
    store.transitionSession(ids[1] as string, ['active'], 'aborted', null);

    const first = store.listSessions({ limit: 2 });
    assert.deepEqual(first.rows.map((r) => r.sessionId), [ids[4], ids[3]]);
    assert.ok(first.next);
    const second = store.listSessions({ limit: 2, before: first.next });
    assert.deepEqual(second.rows.map((r) => r.sessionId), [ids[2], ids[1]]);
    assert.deepEqual(store.listSessions({ status: 'aborted' }).rows.map((r) => r.sessionId), [ids[1]]);
    assert.equal(store.listSessions({ limit: 100 }).rows.length, 5);
    assert.equal(store.listSessions({ limit: 100, includeImplicit: true }).rows.length, 6);
  });
});

describe('UnifiedHistoryStore — contents (CAS)', () => {
  it('stores small content inline and large content under cas/<aa>/<sha>, deduplicated, with no temp files left', async (context) => {
    const root = await tempRoot(context);
    const store = fileStore(root);
    await store.open();
    context.after(() => store.close());

    const small = new TextEncoder().encode('small');
    const big = new Uint8Array(70 * 1024).fill(7);
    assert.deepEqual(await store.putContent(small), { sha256: sha256Hex(small), size: 5, stored: 'inline' });
    const ref = await store.putContent(big);
    assert.equal(ref.stored, 'blob');
    await store.putContent(big);

    const casFiles = await listFiles(join(root, '.brud', 'history', CAS_DIRECTORY));
    assert.deepEqual(casFiles, [join(root, '.brud', 'history', CAS_DIRECTORY, ref.sha256.slice(0, 2), ref.sha256)]);
    assert.deepEqual(Array.from(await store.getContent(ref.sha256)), Array.from(big));
    assert.deepEqual(Array.from(await store.getContent(sha256Hex(small))), Array.from(small));
    assert.equal(store.hasContent(ref.sha256), true);
  });

  it('never returns tampered bytes and reports missing blobs', async (context) => {
    const root = await tempRoot(context);
    const store = fileStore(root);
    await store.open();
    context.after(() => store.close());
    const big = new Uint8Array(70 * 1024).fill(1);
    const { sha256 } = await store.putContent(big);
    const path = blobPath(join(root, '.brud', 'history'), sha256);

    await writeFile(path, 'tampered');
    await assert.rejects(() => store.getContent(sha256), (error: unknown) => error instanceof UnifiedBlobIntegrityError && error.expectedSha256 === sha256);
    await rm(path);
    await assert.rejects(() => store.getContent(sha256), UnifiedBlobMissingError);
    await assert.rejects(() => store.getContent('0'.repeat(64)), UnifiedBlobMissingError);
  });

  it('offloads payloads over 64 KiB and resolves them byte-exact', async (context) => {
    const store = await memoryStore(context);
    store.registerEntryType(FILE_TYPE);
    const session = store.createSession({ prompt: 'p', now: DAY_MS });
    const payload = { path: 'big.json', blob: 'z'.repeat(80 * 1024) };
    const prepared = await store.prepareEntry({ namespace: 'brud.core', type: 'file', schemaVersion: 1, payload, createdAt: DAY_MS });
    assert.equal(prepared.payloadJson, null);
    assert.ok(prepared.payloadSha256);
    const [row] = store.appendEntries(session.sessionId, [prepared]);
    assert.ok(row);
    assert.equal(row.payloadJson, null);
    assert.deepEqual(await store.resolvePayload(row), payload);
  });
});

describe('UnifiedHistoryStore — CAS containment (amendment §2.1)', () => {
  it('derives every blob path from a validated digest inside cas/', () => {
    const historyRoot = resolve('/ws/.brud/history');
    const casRoot = resolve(historyRoot, CAS_DIRECTORY);
    const digest = 'a'.repeat(64);
    assert.ok(blobPath(historyRoot, digest).startsWith(casRoot + sep));
    for (const hostile of ['../'.repeat(30) + 'etc/passwd', 'A'.repeat(64), 'a'.repeat(63), `${'a'.repeat(62)}/b`, `/${'a'.repeat(63)}`, `${'a'.repeat(32)}..${'a'.repeat(30)}`, '', 'g'.repeat(64)]) {
      assert.throws(() => blobPath(historyRoot, hostile), UnifiedInvalidDigestError, hostile);
    }
  });

  it('refuses to write bytes that do not match their address, before touching the driver', async (context) => {
    const store = await memoryStore(context);
    const writes: string[] = [];
    const driver = new InMemoryStorageDriver();
    const original = driver.writeFileExclusive.bind(driver);
    driver.writeFileExclusive = async (path, data, options) => {
      writes.push(path);
      return original(path, data, options);
    };
    const { writeBlob } = await import('../store/cas.js');
    await assert.rejects(() => writeBlob(driver, MEMORY_ROOT, 'b'.repeat(64), new Uint8Array([1])), UnifiedBlobIntegrityError);
    assert.deepEqual(writes, []);
    void store;
  });
});

describe('UnifiedHistoryStore — entries and cursor', () => {
  it('assigns gap-free seq and filters by session, type, and path in both orders', async (context) => {
    const store = await memoryStore(context);
    store.registerEntryType(FILE_TYPE);
    store.registerEntryType({ ...FILE_TYPE, namespace: 'acme', type: 'note' });
    const a = store.createSession({ prompt: 'a', now: DAY_MS }).sessionId;
    const b = store.createSession({ prompt: 'b', now: DAY_MS }).sessionId;
    store.appendEntries(a, [entry({ path: 'x.txt' }), entry({ path: 'y.txt' })]);
    store.appendEntries(b, [entry({ path: 'x.txt' }), entry({ n: 1 }, { namespace: 'acme', type: 'note' })]);

    assert.deepEqual(store.listEntries({ order: 'asc' }).rows.map((r) => r.seq), [1, 2, 3, 4]);
    assert.deepEqual(store.listEntries({ sessionId: b, order: 'asc' }).rows.map((r) => r.seq), [3, 4]);
    assert.deepEqual(store.listEntries({ path: 'x.txt' }).rows.map((r) => r.seq), [3, 1]);
    assert.deepEqual(store.listEntries({ namespace: 'acme', type: 'note' }).rows.map((r) => r.seq), [4]);
    assert.equal(store.getEntry(4)?.filePath, null);
    assert.equal(store.getEntry(1)?.filePath, 'x.txt');

    const page = store.listEntries({ order: 'asc', limit: 3 });
    assert.equal(page.nextSeq, 3);
    assert.deepEqual(store.listEntries({ order: 'asc', limit: 3, afterSeq: page.nextSeq }).rows.map((r) => r.seq), [4]);
  });

  it('truncates the redo tail and moves the cursor in one transaction, and rolls both back on failure', async (context) => {
    const store = await memoryStore(context);
    store.registerEntryType(FILE_TYPE);
    const s = store.createSession({ prompt: 'p', now: DAY_MS }).sessionId;
    store.appendEntries(s, [entry({ v: 1 }), entry({ v: 2 }), entry({ v: 3 })], { advanceCursor: true });
    assert.equal(store.getCursor(), 3);
    store.setCursor(1);

    assert.throws(() => store.appendEntries(s, [entry({ v: 4 }), entry(null, { payloadJson: '{bad' })], { truncateRedoTail: true, advanceCursor: true }));
    assert.equal(store.maxSeq(), 3);
    assert.equal(store.getCursor(), 1);

    const [appended] = store.appendEntries(s, [entry({ v: 4 })], { truncateRedoTail: true, advanceCursor: true });
    assert.equal(appended?.seq, 2);
    assert.equal(store.maxSeq(), 2);
    assert.equal(store.getCursor(), 2);
    assert.throws(() => store.appendEntries('BR-20261030-404', [entry({})]), UnifiedSessionNotFoundError);
  });

  it('stores checkpoints, reversals, and import records', async (context) => {
    const store = await memoryStore(context);
    const s = store.createSession({ prompt: 'p', now: DAY_MS }).sessionId;
    store.insertCheckpoint({ checkpointId: 'CP-1', sessionId: s, label: 'v1', seqOffset: 0, createdAt: DAY_MS, metadata: { a: 1 } });
    assert.equal(store.getCheckpoint('CP-1')?.label, 'v1');
    assert.equal(store.listCheckpoints(s).length, 1);
    store.insertReversal({ reversalId: 'R-1', sessionId: s, kind: 'session', targetState: 'pre', executedAt: DAY_MS, status: 'success', revertedEntries: [1, 2], errorMessage: null });
    assert.deepEqual(store.listReversals(s)[0]?.revertedEntries, [1, 2]);
    store.recordImport({ source: 'ledger.db', sourceSha256: 'c'.repeat(64), importedAt: DAY_MS, rows: 3 });
    assert.equal(store.getImport('ledger.db')?.rows, 3);
  });
});

describe('UnifiedHistoryStore — multi-process', () => {
  it('serializes 4 processes × 25 appends with gap-free seq, unique session ids, and no lock errors', async (context) => {
    const root = await tempRoot(context);
    const historyRoot = join(root, '.brud', 'history');
    await mkdir(historyRoot, { recursive: true });
    const workerPath = join(root, 'store-worker.mts');
    const storeUrl = new URL('../store/index.ts', import.meta.url).href;
    const driverUrl = new URL('../../../BrudFileSystem/drivers/DurableNodeStorageDriver.ts', import.meta.url).href;
    await writeFile(workerPath, `
const { UnifiedHistoryStore } = await import(${JSON.stringify(storeUrl)});
const { DurableNodeStorageDriver } = await import(${JSON.stringify(driverUrl)});
const [historyRoot, id] = process.argv.slice(2);
const store = new UnifiedHistoryStore({ dbPath: historyRoot + '/universal.db', historyRoot, driver: new DurableNodeStorageDriver() });
await store.open();
store.registerEntryType({ namespace: 'brud.core', type: 'file', schemaVersion: 1, payloadSchema: { type: 'object' }, reversalMode: 'none', registeredBy: 'kernel', registeredAt: 0 });
const session = store.createSession({ prompt: id, now: Date.now() });
for (let i = 0; i < 25; i += 1) {
  store.appendEntries(session.sessionId, [{ namespace: 'brud.core', type: 'file', schemaVersion: 1, payloadJson: JSON.stringify({ path: id + '/' + i }), payloadSha256: null, inversePayloadJson: null, createdAt: Date.now() }], { truncateRedoTail: false, advanceCursor: true });
}
store.close();
`, 'utf8');

    const results = await Promise.all(['alpha', 'beta', 'gamma', 'delta'].map((id) => new Promise<{ code: number | null; stderr: string }>((done, fail) => {
      const child = spawn(process.execPath, ['--import', 'tsx', workerPath, historyRoot, id], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => { stderr += chunk; });
      child.on('error', fail);
      child.on('close', (code) => done({ code, stderr }));
    })));

    for (const result of results) {
      assert.equal(result.code, 0, result.stderr);
      assert.doesNotMatch(result.stderr, /database is locked|SQLITE_BUSY/u);
    }

    const store = fileStore(root);
    await store.open();
    context.after(() => store.close());
    const seqs = store.listEntries({ order: 'asc', limit: 1000 }).rows.map((r) => r.seq);
    assert.deepEqual(seqs, Array.from({ length: 100 }, (_, i) => i + 1));
    const sessions = store.listSessions({ limit: 100 }).rows.map((r) => r.sessionId);
    assert.equal(new Set(sessions).size, 4);
    assert.equal(store.getCursor(), 100);
  });
});

describe('UnifiedHistoryStore — degraded mode (F-UP-1, oracle R4 contract)', () => {
  it('never touches disk in the constructor', () => {
    const missing = join(tmpdir(), `brud-never-${process.pid}-${Date.now()}`);
    new UnifiedHistoryStore({ dbPath: join(missing, 'universal.db'), historyRoot: missing, driver: new DurableNodeStorageDriver() });
    assert.equal(existsSync(missing), false);
  });

  it('degrades on a read-only directory without a database: empty reads, refused writes, one warning', { skip: isRoot ? 'permissions are not enforced for uid 0' : false }, async (context) => {
    const root = await tempRoot(context);
    const historyRoot = join(root, '.brud', 'history');
    await mkdir(historyRoot, { recursive: true });
    await chmod(historyRoot, 0o555);
    const warnings: HistoryStoreWarning[] = [];
    const store = fileStore(root, warnings);

    assert.deepEqual(await store.open(), { mode: 'degraded', reason: 'READ_ONLY_STORAGE' });
    context.after(() => store.close());
    assert.equal(store.isDegraded, true);
    assert.deepEqual(store.listSessions().rows, []);
    assert.deepEqual(store.listEntries().rows, []);
    assert.equal(store.getCursor(), 0);
    assert.throws(() => store.createSession({ prompt: 'x', now: DAY_MS }), (error: unknown) => error instanceof UnifiedHistoryDegradedError && error.reason === 'READ_ONLY_STORAGE');
    assert.throws(() => store.registerEntryType(FILE_TYPE), UnifiedHistoryDegradedError);
    assert.throws(() => store.setCursor(1), UnifiedHistoryDegradedError);
    await assert.rejects(() => store.putContent(new Uint8Array([1])), UnifiedHistoryDegradedError);
    assert.deepEqual(warnings.map((w) => [w.code, w.reason]), [['HISTORY_DEGRADED', 'READ_ONLY_STORAGE']]);
    assert.equal(existsSync(join(historyRoot, 'universal.db')), false);
  });

  it('degrades on a read-only directory with an existing database and still serves reads', { skip: isRoot ? 'permissions are not enforced for uid 0' : false }, async (context) => {
    const root = await tempRoot(context);
    const writer = fileStore(root);
    await writer.open();
    writer.registerEntryType(FILE_TYPE);
    const sessionId = writer.createSession({ prompt: 'kept', now: DAY_MS }).sessionId;
    writer.appendEntries(sessionId, [entry({ path: 'a.txt' })], { advanceCursor: true });
    writer.close();
    await chmod(join(root, '.brud', 'history'), 0o555);

    const store = fileStore(root);
    assert.deepEqual(await store.open(), { mode: 'degraded', reason: 'READ_ONLY_STORAGE' });
    context.after(() => store.close());
    assert.deepEqual(store.listSessions().rows.map((r) => r.sessionId), [sessionId]);
    assert.equal(store.listEntries({ path: 'a.txt' }).rows.length, 1);
    assert.throws(() => store.appendEntries(sessionId, [entry({})]), UnifiedHistoryDegradedError);
  });
});

describe('UnifiedHistoryStore — module isolation', () => {
  it('imports no node:fs and nothing from the legacy history modules', () => {
    const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../store');
    const pattern = /(?:\bfrom\s+|\bimport\s*\(\s*)['"]([^'"]+)['"]/gu;
    for (const file of readdirSync(directory).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(join(directory, file), 'utf8');
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1] ?? '';
        assert.ok(!/^node:fs/u.test(specifier) && specifier !== 'fs', `${file} imports ${specifier}`);
        assert.ok(!/\.\.\/\.\.\/(storage|operations|engine|listener|orchestrator|descriptor|contracts)\//u.test(specifier), `${file} imports legacy ${specifier}`);
      }
    }
  });
});
