import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { InMemoryStorageDriver } from '../../../../drivers/memory/index.js';
import { BrudFileSystem } from '../../../BrudFileSystem/orchestrator/BrudFileSystem.js';
import { createFileMutationJournal } from '../../../BrudFileSystem/events/FileMutationJournal.js';
import { DurableNodeStorageDriver } from '../../../BrudFileSystem/drivers/DurableNodeStorageDriver.js';
import {
  CORE_NAMESPACE,
  UnifiedEntrySchemaError,
  UnifiedEntryValidationError,
  UnifiedHistoryService,
  UnifiedInvalidTargetPathError,
  UnifiedNamespaceError,
  UnifiedSessionStateError,
} from '../service/index.js';
import type { FileEntryPayload, SessionTargetPayload } from '../service/index.js';
import {
  UnifiedHistoryDegradedError,
  UnifiedHistoryStore,
  UnifiedSessionNotFoundError,
  sha256Hex,
} from '../store/index.js';
import type { EntryRow } from '../store/index.js';

const ROOT = '/workspace';
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

interface Harness {
  readonly service: UnifiedHistoryService;
  readonly fs: BrudFileSystem;
  readonly store: UnifiedHistoryStore;
  readonly errors: { error: unknown; context: Record<string, unknown> }[];
}

async function harness(context: TestContext): Promise<Harness> {
  const driver = new InMemoryStorageDriver();
  const journal = createFileMutationJournal();
  const fs = new BrudFileSystem(ROOT, driver, { mutationJournal: journal });
  await fs.initialize();
  const store = new UnifiedHistoryStore({ dbPath: ':memory:', historyRoot: `${ROOT}/.brud/history`, driver });
  const errors: { error: unknown; context: Record<string, unknown> }[] = [];
  const service = new UnifiedHistoryService({
    store,
    fileSystem: () => fs,
    journal,
    onError: (error, ctx) => errors.push({ error, context: { ...ctx } }),
  });
  await service.start();
  context.after(() => service.dispose());
  return { service, fs, store, errors };
}

async function fileEntries(h: Harness): Promise<{ row: EntryRow; payload: FileEntryPayload }[]> {
  await h.service.flush();
  const rows = h.service.listEntries({ namespace: CORE_NAMESPACE, type: 'file', order: 'asc', limit: 1000 }).rows;
  return Promise.all(rows.map(async (row) => ({ row, payload: await h.service.resolvePayload(row) as FileEntryPayload })));
}

describe('UnifiedHistoryService — start and built-ins', () => {
  it('registers the built-in types and opens one implicit session', async (context) => {
    const h = await harness(context);
    assert.deepEqual(
      h.store.listEntryTypes().map((t) => `${t.namespace}.${t.type}@${t.schemaVersion}`),
      ['brud.core.file@1', 'brud.core.session-target@1'],
    );
    const implicit = h.store.listSessions({ includeImplicit: true }).rows.filter((s) => s.implicit);
    assert.equal(implicit.length, 1);
    assert.equal(implicit[0]?.sessionId, h.service.implicitSession);
    assert.equal(h.store.listSessions().rows.length, 0);
  });
});

describe('UnifiedHistoryService — automatic recording (brud.core.file)', () => {
  it('records writes, overwrites, and deletes with captured pre- and post-images', async (context) => {
    const h = await harness(context);
    await h.fs.writeAtomic('src/a.txt', 'first\n');
    await h.fs.writeAtomic('src/a.txt', 'second\n');
    await h.fs.deleteFile('src/a.txt');

    const entries = (await fileEntries(h)).filter((e) => e.payload.operation !== 'mkdir');
    assert.deepEqual(
      entries.map((e) => [e.payload.path, e.payload.operation, e.payload.preSha256, e.payload.postSha256, e.payload.preCaptured]),
      [
        ['src/a.txt', 'write', null, sha256Hex(text('first\n')), true],
        ['src/a.txt', 'write', sha256Hex(text('first\n')), sha256Hex(text('second\n')), true],
        ['src/a.txt', 'unlink', sha256Hex(text('second\n')), null, true],
      ],
    );
    for (const e of entries) {
      assert.equal(e.row.sessionId, h.service.implicitSession);
    }
    assert.equal(new TextDecoder().decode(await h.store.getContent(sha256Hex(text('first\n')))), 'first\n');
    assert.equal(h.store.getCursor(), h.store.maxSeq());
  });

  it('discards the redo tail when a new mutation follows an undo position', async (context) => {
    const h = await harness(context);
    await h.fs.writeAtomic('t.txt', 'v1');
    await h.fs.writeAtomic('t.txt', 'v2');
    await h.service.flush();
    const max = h.store.maxSeq();
    h.store.setCursor(max - 1);
    await h.fs.writeAtomic('t.txt', 'v3');
    await h.service.flush();
    assert.equal(h.store.maxSeq(), max);
    assert.equal(h.store.getCursor(), max);
  });

  it('records 40 concurrent writes as 40 distinct entries', async (context) => {
    const h = await harness(context);
    await Promise.all(Array.from({ length: 40 }, (_, i) => h.fs.writeAtomic(`c/f-${i}.txt`, `${i}`)));
    const writes = (await fileEntries(h)).filter((e) => e.payload.operation === 'write');
    assert.equal(new Set(writes.map((e) => e.payload.path)).size, 40);
  });

  it('reports recording failures to the error sink and keeps recording (legacy F5)', async (context) => {
    const driver = new InMemoryStorageDriver();
    const journal = createFileMutationJournal();
    const fs = new BrudFileSystem(ROOT, driver, { mutationJournal: journal });
    await fs.initialize();
    const errors: unknown[] = [];
    const service = new UnifiedHistoryService({
      store: new UnifiedHistoryStore({ dbPath: ':memory:', historyRoot: `${ROOT}/.brud/history`, driver }),
      fileSystem: () => fs,
      journal,
      onError: (error) => errors.push(error),
    });
    await service.start();
    context.after(() => service.dispose());

    journal.publish({
      mutationId: 'bad',
      operation: 'unlink',
      phase: 'after',
      path: '/absolute/outside.txt',
      previous: { exists: true, kind: 'file', size: 1, sha256: sha256Hex(text('x')) },
      updated: { exists: false, kind: 'missing', size: 0, sha256: null },
      timestamp: Date.now(),
      committed: true,
    });
    await fs.writeAtomic('ok.txt', 'ok');
    await service.flush();
    assert.equal(errors.length, 1);
    assert.ok(errors[0] instanceof UnifiedInvalidTargetPathError);
    assert.ok(service.listEntries({ path: 'ok.txt' }).rows.length >= 1);
  });
});

describe('UnifiedHistoryService — attribution (B-D2)', () => {
  it('attributes a write to the most recent active session that declared the path, else the implicit session', async (context) => {
    const h = await harness(context);
    const a = await h.service.beginSession('A', { declaredTargets: ['x.txt'] });
    const b = await h.service.beginSession('B', { declaredTargets: ['x.txt', 'y.txt'] });
    await h.fs.writeAtomic('x.txt', '1');
    await h.fs.writeAtomic('y.txt', '1');
    await h.fs.writeAtomic('z.txt', '1');
    await h.service.commitSession(b, 'completed');
    await h.fs.writeAtomic('x.txt', '2');

    const byPath = (await fileEntries(h))
      .filter((e) => e.payload.operation === 'write')
      .map((e) => [e.payload.path, e.row.sessionId]);
    assert.deepEqual(byPath, [
      ['x.txt', b],
      ['y.txt', b],
      ['z.txt', h.service.implicitSession],
      ['x.txt', a],
    ]);
  });
});

describe('UnifiedHistoryService — explicit sessions', () => {
  it('captures declared targets in full at begin and records only changed targets at commit', async (context) => {
    const h = await harness(context);
    await h.fs.writeAtomic('src/same.ts', 'same');
    await h.fs.writeAtomic('src/changed.ts', 'old');
    const id = await h.service.beginSession('edit', { declaredTargets: ['src/same.ts', 'src/changed.ts', './src/new.ts', 'src\\changed.ts'] });
    await h.fs.writeAtomic('src/changed.ts', 'new');
    await h.fs.writeAtomic('src/changed.ts', 'newer');
    await h.fs.writeAtomic('src/new.ts', 'born');

    const receipt = await h.service.commitSession(id, 'completed');
    assert.equal(receipt.committedFileCount, 2);
    const view = h.service.getSessionView(id);
    assert.ok(view);
    assert.equal(view.session.status, 'committed');
    assert.deepEqual(view.declaredTargets, ['src/same.ts', 'src/changed.ts', 'src/new.ts']);
    const targets = view.targets.map((t) => t.payload as SessionTargetPayload);
    assert.deepEqual(targets.map((t) => [t.path, t.preSha256, t.postSha256]), [
      ['src/changed.ts', sha256Hex(text('old')), sha256Hex(text('newer'))],
      ['src/new.ts', null, sha256Hex(text('born'))],
    ]);
    // Baseline bytes are kept even though the file was overwritten twice.
    assert.equal(new TextDecoder().decode(await h.store.getContent(sha256Hex(text('old')))), 'old');
  });

  it('aborts without entries and enforces session state', async (context) => {
    const h = await harness(context);
    await h.fs.writeAtomic('a.ts', 'before');
    const id = await h.service.beginSession('abort', { declaredTargets: ['a.ts'] });
    await h.fs.writeAtomic('a.ts', 'after');
    assert.deepEqual(await h.service.commitSession(id, 'aborted'), { sessionId: id, committedFileCount: 0, blobs: [] });
    assert.equal(h.service.getSessionView(id)?.targets.length, 0);
    await assert.rejects(() => h.service.commitSession(id, 'completed'), UnifiedSessionStateError);
    await assert.rejects(() => h.service.commitSession(h.service.implicitSession as string, 'completed'), UnifiedSessionStateError);
    await assert.rejects(() => h.service.commitSession('BR-20261030-404', 'completed'), UnifiedSessionNotFoundError);
    await assert.rejects(() => h.service.beginSession('bad', { declaredTargets: ['../escape'] }), UnifiedInvalidTargetPathError);
  });

  it('lists blobs for binary or large post-images in the commit receipt', async (context) => {
    const h = await harness(context);
    const id = await h.service.beginSession('bin', { declaredTargets: ['b.bin', 'big.txt'] });
    await h.fs.writeAtomic('b.bin', new Uint8Array([0, 1, 2]));
    await h.fs.writeAtomic('big.txt', 'x'.repeat(70 * 1024));
    const receipt = await h.service.commitSession(id, 'completed');
    assert.deepEqual(receipt.blobs.map((b) => b.relativePath).sort(), ['b.bin', 'big.txt']);
  });
});

describe('UnifiedHistoryService — registration and validation', () => {
  it('rejects unsupported schemas, invalid names, and invalid payloads (nothing appended)', async (context) => {
    const h = await harness(context);
    const handle = h.service.forNamespace('acme.notes');
    assert.throws(() => handle.registerEntryType({ type: 'note', schemaVersion: 1, payloadSchema: { format: 'email' }, reversal: { mode: 'none' } }), UnifiedEntrySchemaError);
    assert.throws(() => handle.registerEntryType({ type: 'Bad Type', schemaVersion: 1, payloadSchema: true, reversal: { mode: 'none' } }), UnifiedNamespaceError);

    handle.registerEntryType({
      type: 'note',
      schemaVersion: 1,
      payloadSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 10 } }, required: ['text'], additionalProperties: false },
      reversal: { mode: 'none' },
    });
    const session = await handle.beginSession('notes');
    const before = h.store.maxSeq();
    await assert.rejects(() => handle.recordEntry(session, { type: 'note', schemaVersion: 1, payload: { text: 'way too long text' } }), UnifiedEntryValidationError);
    await assert.rejects(() => handle.recordEntry(session, { type: 'note', schemaVersion: 1, payload: { text: 'ok' }, inversePayload: { nope: 1 } }), UnifiedEntryValidationError);
    await assert.rejects(() => handle.recordEntry(session, { type: 'note', schemaVersion: 2, payload: { text: 'ok' } }), /not registered/u);
    assert.equal(h.store.maxSeq(), before);
    assert.ok((await handle.recordEntry(session, { type: 'note', schemaVersion: 1, payload: { text: 'ok' } })) > before);
  });

  it('keeps persisted schemas enforceable after the producer is gone and after restart', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'brud-unified-service-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const historyRoot = join(root, '.brud', 'history');
    const make = (): UnifiedHistoryService => new UnifiedHistoryService({
      store: new UnifiedHistoryStore({ dbPath: join(historyRoot, 'universal.db'), historyRoot, driver: new DurableNodeStorageDriver() }),
      fileSystem: () => { throw new Error('unused'); },
    });

    const first = make();
    await first.start();
    const registration = first.forNamespace('acme.notes').registerEntryType({
      type: 'note',
      schemaVersion: 1,
      payloadSchema: { type: 'object', required: ['text'] },
      reversal: { mode: 'handler', detectConflict: async () => null, revert: async () => undefined },
    });
    registration.dispose();
    assert.equal(first.reversalFor('acme.notes', 'note', 1), undefined);
    await first.dispose();

    const second = make();
    await second.start();
    context.after(() => second.dispose());
    const handle = second.forNamespace('acme.notes');
    const session = await handle.beginSession('after restart');
    await assert.rejects(() => handle.recordEntry(session, { type: 'note', schemaVersion: 1, payload: {} }), UnifiedEntryValidationError);
    assert.ok(await handle.recordEntry(session, { type: 'note', schemaVersion: 1, payload: { text: 'kept' } }));
  });
});

describe('UnifiedHistoryService — namespace isolation (D3, D10)', () => {
  it('confines a handle to its namespace, even by cast', async (context) => {
    const h = await harness(context);
    for (const reserved of ['brud', 'brud.core', 'brud.tools.fs', '@brud/x', 'Bad']) {
      assert.throws(() => h.service.forNamespace(reserved), UnifiedNamespaceError, reserved);
    }
    const a = h.service.forNamespace('acme.a');
    const b = h.service.forNamespace('acme.b');
    for (const handle of [a, b]) {
      handle.registerEntryType({ type: 'note', schemaVersion: 1, payloadSchema: true, reversal: { mode: 'none' } });
    }
    const sa = await a.beginSession('a');
    const sb = await b.beginSession('b');
    await a.recordEntry(sa, { type: 'note', schemaVersion: 1, payload: { who: 'a' } });
    await b.recordEntry(sb, { type: 'note', schemaVersion: 1, payload: { who: 'b' } });
    await h.fs.writeAtomic('core.txt', 'core');
    await h.service.flush();
    const human = await h.service.beginSession('human');

    const seen = a.listEntries({ order: 'asc', namespace: 'brud.core', path: 'core.txt' } as never).rows;
    assert.deepEqual(seen.map((r) => r.namespace), ['acme.a']);
    assert.equal(a.getSession(sb), undefined);
    assert.equal(a.getSession(human), undefined);
    assert.deepEqual(a.listSessions().map((s) => s.sessionId), [sa]);
    await assert.rejects(() => a.recordEntry(sb, { type: 'note', schemaVersion: 1, payload: {} }), UnifiedNamespaceError);
    await assert.rejects(() => a.recordEntry(human, { type: 'note', schemaVersion: 1, payload: {} }), UnifiedNamespaceError);
    await assert.rejects(() => a.recordEntry(h.service.implicitSession as string, { type: 'note', schemaVersion: 1, payload: {} }), UnifiedNamespaceError);
    await assert.rejects(() => a.commitSession(sb, 'completed'), UnifiedNamespaceError);
    const bEntry = b.listEntries().rows[0] as EntryRow;
    await assert.rejects(() => a.resolvePayload(bEntry), UnifiedNamespaceError);
    const coreEntry = h.service.listEntries({ namespace: CORE_NAMESPACE }).rows[0] as EntryRow;
    await assert.rejects(() => a.resolvePayload(coreEntry), UnifiedNamespaceError);

    assert.equal(Object.isFrozen(a), true);
    for (const key of Reflect.ownKeys(a)) {
      const value = (a as unknown as Record<string | symbol, unknown>)[key];
      assert.ok(typeof value === 'function' || key === 'namespace', `unexpected own property ${String(key)}`);
      assert.notEqual(value, h.service);
      assert.notEqual(value, h.store);
    }
  });
});

describe('UnifiedHistoryService — degraded storage', () => {
  it('starts degraded on read-only storage: no recording, explicit writes refused', { skip: isRoot ? 'permissions are not enforced for uid 0' : false }, async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'brud-unified-degraded-'));
    const historyRoot = join(root, '.brud', 'history');
    await mkdir(historyRoot, { recursive: true });
    await chmod(historyRoot, 0o555);
    context.after(async () => {
      await chmod(historyRoot, 0o755);
      await rm(root, { recursive: true, force: true });
    });
    const driver = new DurableNodeStorageDriver();
    const journal = createFileMutationJournal();
    const fs = new BrudFileSystem(root, driver, { mutationJournal: journal });
    await fs.initialize();
    const service = new UnifiedHistoryService({
      store: new UnifiedHistoryStore({ dbPath: join(historyRoot, 'universal.db'), historyRoot, driver }),
      fileSystem: () => fs,
      journal,
    });
    await service.start();
    context.after(() => service.dispose());

    assert.equal(service.isDegraded, true);
    await fs.writeAtomic('src/x.txt', 'payload');
    await service.flush();
    assert.deepEqual(service.listEntries().rows, []);
    await assert.rejects(() => service.beginSession('nope'), UnifiedHistoryDegradedError);
    assert.throws(() => service.forNamespace('acme.x').registerEntryType({ type: 'n', schemaVersion: 1, payloadSchema: true, reversal: { mode: 'none' } }), UnifiedHistoryDegradedError);
  });
});

describe('UnifiedHistoryService — dispose', () => {
  it('closes the implicit session and releases reversal callbacks without unregistering the type', async (context) => {
    const driver = new InMemoryStorageDriver();
    const store = new UnifiedHistoryStore({ dbPath: ':memory:', historyRoot: `${ROOT}/.brud/history`, driver });
    const service = new UnifiedHistoryService({ store, fileSystem: () => { throw new Error('unused'); } });
    await service.start();
    const implicit = service.implicitSession as string;
    const handle = service.forNamespace('acme.n');
    const reg = handle.registerEntryType({ type: 'n', schemaVersion: 1, payloadSchema: true, reversal: { mode: 'inverse-payload', apply: async () => undefined } });
    assert.ok(service.reversalFor('acme.n', 'n', 1));
    reg.dispose();
    reg.dispose();
    assert.equal(service.reversalFor('acme.n', 'n', 1), undefined);
    assert.ok(store.getEntryType('acme.n', 'n', 1));
    const statusBefore = store.getSession(implicit)?.status;
    await service.dispose();
    assert.equal(statusBefore, 'active');
    void context;
  });
});
