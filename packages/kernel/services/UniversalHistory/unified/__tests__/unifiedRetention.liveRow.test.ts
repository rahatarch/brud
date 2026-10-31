/**
 * Retention must not delete a live process's implicit session row
 * (U-8 corrective, RL — plan §5.2).
 *
 * Real environment only: real `createStandardKernel()` in real child processes,
 * a real `DatabaseSync` over a real `universal.db` under `mkdtemp`. No mocks, no
 * stubs, no `:memory:`, no injected clocks.
 *
 * Every assertion is an outcome: a row that a live process created and has not
 * closed survives another process's retention, and that process's appends still
 * land in it. The child's stderr is read because losing the row is what
 * produces `HISTORY_RECORDING_FAILED` / `Session not found`.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { ServiceContext } from '../../../../src/contracts/lifecycle.js';
import { createStandardKernel } from '../../../../src/bootstrap/index.js';
import { HistoryToken, UniversalHistoryToken } from '../../descriptor/tokens.js';
import { FileSystemToken } from '../../../BrudFileSystem/descriptor/tokens.js';

const DAY = 86_400_000;
const LINE_TIMEOUT_MS = 120_000;

interface PersistedSession {
  readonly sessionId: string;
  readonly status: string;
  readonly implicit: number;
}

function dbPathOf(workspaceRoot: string): string {
  return join(workspaceRoot, '.brud', 'history', 'universal.db');
}

/** The live implicit row a rotation started, i.e. any active implicit row other than `previous`. */
function replacementRow(workspaceRoot: string, previous: string): string | undefined {
  return readSessions(workspaceRoot)
    .filter((row) => row.implicit === 1 && row.status === 'active' && row.sessionId !== previous)
    .map((row) => row.sessionId)
    .pop();
}

/** Session rows as persisted in the workspace's real `universal.db`, on a fresh connection. */
function readSessions(workspaceRoot: string): PersistedSession[] {
  const db = new DatabaseSync(dbPathOf(workspaceRoot));
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    return db.prepare('SELECT session_id AS sessionId, status, implicit FROM sessions ORDER BY session_id')
      .all() as unknown as PersistedSession[];
  } finally {
    db.close();
  }
}

function sqlRows(workspaceRoot: string, sql: string): unknown[] {
  const db = new DatabaseSync(dbPathOf(workspaceRoot));
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

function readCount(workspaceRoot: string, sql: string): number {
  const db = new DatabaseSync(dbPathOf(workspaceRoot));
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    return (db.prepare(sql).get() as { n: number }).n;
  } finally {
    db.close();
  }
}

async function makeWorkspace(context: TestContext, prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// ── worker process ────────────────────────────────────────────────────

const BOOTSTRAP_URL = new URL('../../../../src/bootstrap/index.ts', import.meta.url).href;
const HISTORY_TOKENS_URL = new URL('../../descriptor/tokens.js', import.meta.url).href;
const FILE_TOKENS_URL = new URL('../../../BrudFileSystem/descriptor/tokens.js', import.meta.url).href;

const WORKER_SOURCE = `
import { appendFileSync, readFileSync } from 'node:fs';
const { createStandardKernel } = await import(${JSON.stringify(BOOTSTRAP_URL)});
const { HistoryToken, UniversalHistoryToken } = await import(${JSON.stringify(HISTORY_TOKENS_URL)});
const { FileSystemToken } = await import(${JSON.stringify(FILE_TOKENS_URL)});

const [root, inbox, outbox] = process.argv.slice(2);
const emit = (payload) => appendFileSync(outbox, JSON.stringify(payload) + String.fromCharCode(10));

const kernel = createStandardKernel();
await kernel.boot({ workspaceRoot: root });
const caller = { callerId: 'retention.liveRow.worker', tier: 'core', workspaceRoot: root };
const journal = kernel.requestAccess(caller, HistoryToken);
const fileSystem = kernel.requestAccess(caller, FileSystemToken);
const history = kernel.requestAccess(caller, UniversalHistoryToken);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const commands = {
  write: async (path, text) => {
    await fileSystem.writeAtomic(path, text);
    await sleep(300);
  },
  checkpoint: async (label) => {
    await journal.recordCheckpoint(label);
  },
  undo: async () => {
    const report = await journal.undo();
    if (report.status !== 'success') throw new Error('undo status: ' + report.status + ' ' + JSON.stringify(report));
  },
  // Undo/redo/checkpoint reversals carry a null session, so the reversals
  // prune can only reach a row that names one. This one names the worker's
  // own live row.
  reversal: async () => {
    history.service.store.insertReversal({
      reversalId: 'RV-live',
      sessionId: history.service.implicitSession,
      kind: 'undo',
      targetState: null,
      executedAt: Date.now(),
      status: 'success',
      revertedEntries: [],
      errorMessage: null,
    });
  },
  hold: async (path, first, held) => {
    await fileSystem.writeAtomic(path, first);
    await fileSystem.writeAtomic(path, held);
    await sleep(300);
  },
  release: async (path) => {
    await fileSystem.writeAtomic(path, 'released');
    await sleep(300);
  },
  redo: async () => {
    const report = await journal.redo();
    if (report.status !== 'success') throw new Error('redo status: ' + report.status);
  },
  rotate: async (label) => {
    await journal.beginSession(label, {});
  },
  retain: async () => {
    history.service.store.applyRetention({ cutoffMs: Date.now(), minUndoEntries: 1 });
    await sleep(100);
  },
  exit: async () => {
    await kernel.shutdown();
  },
};

// The contract listSessions hides implicit rows; the service one does not.
const owned = () => history.service.listSessions({ includeImplicit: true })
  .rows.filter((row) => row.prompt === 'automatic recording' && row.status === 'active')
  .map((row) => row.sessionId);
emit({ event: 'booted', rows: owned() });

let seen = 0;
let stopping = false;
for (;;) {
  let text = '';
  try { text = readFileSync(inbox, 'utf8'); } catch { text = ''; }
  const lines = text.split(String.fromCharCode(10)).filter((line) => line.length > 0);
  if (seen < lines.length) {
    const line = lines[seen];
    seen += 1;
    const [kind, ...args] = line.split(' ');
    const run = commands[kind];
    if (run === undefined) { emit({ event: 'result:' + kind, outcome: 'error', message: 'unknown command' }); continue; }
    try {
      await run(...args);
      if (kind === 'exit') { stopping = true; }
      emit({ event: 'result:' + kind, outcome: 'ok' });
    } catch (error) {
      emit({ event: 'result:' + kind, outcome: 'error', message: String(error) });
    }
  }
  if (stopping) break;
  await sleep(10);
}
emit({ event: 'exited' });
`;

interface Worker {
  readonly name: string;
  readonly child: ChildProcess;
  /** Appends one command to the child's inbox file. */
  send(line: string): void;
  readonly stderr: () => string;
  /** Resolves with the next event named `event`, consuming it. */
  next(event: string): Promise<Record<string, unknown>>;
  wait(): Promise<number | null>;
}

async function bootWorker(context: TestContext, workspaceRoot: string, name: string): Promise<Worker> {
  const base = join(workspaceRoot, '..', `retention-live-row-${process.pid}-${Date.now()}-${name}`);
  const scriptPath = `${base}.mjs`;
  const inbox = `${base}.in`;
  const outbox = `${base}.out`;
  await writeFile(scriptPath, WORKER_SOURCE, 'utf8');
  await writeFile(inbox, '', 'utf8');
  await writeFile(outbox, '', 'utf8');
  context.after(() => Promise.all([scriptPath, inbox, outbox].map((path) => rm(path, { force: true }))));

  const child = spawn(process.execPath, ['--import', 'tsx', scriptPath, workspaceRoot, inbox, outbox], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  context.after(() => { child.kill('SIGKILL'); });

  const events: Record<string, unknown>[] = [];
  let stderr = '';
  let read = 0;
  let buffered = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
  child.stdout?.resume();

  const exited = new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code));
  });

  const drain = async (): Promise<void> => {
    let text = '';
    try {
      text = await readFile(outbox, 'utf8');
    } catch {
      return;
    }
    const fresh = text.slice(read);
    read = text.length;
    buffered += fresh;
    for (;;) {
      const newline = buffered.indexOf('\n');
      if (newline < 0) {
        break;
      }
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (line.length > 0) {
        events.push(JSON.parse(line) as Record<string, unknown>);
      }
    }
  };

  const worker: Worker = {
    name,
    child,
    send(line: string): void {
      appendFileSync(inbox, `${line.replace(/\n/gu, ' ')}\n`, 'utf8');
    },
    stderr: () => stderr,
    async next(event: string): Promise<Record<string, unknown>> {
      const deadline = Date.now() + LINE_TIMEOUT_MS;
      for (;;) {
        await drain();
        const index = events.findIndex((entry) => String(entry.event) === event);
        if (index >= 0) {
          return events.splice(index, 1)[0] as Record<string, unknown>;
        }
        if (Date.now() > deadline) {
          throw new Error(`${name} never reported "${event}"\nevents:\n${JSON.stringify(events)}\nstderr:\n${stderr}`);
        }
        await sleep(20);
      }
    },
    wait: () => exited,
  };
  return worker;
}

/** Boots a worker and returns the implicit rows it reported owning when its boot finished. */
async function bootOwned(context: TestContext, root: string, name: string): Promise<{ worker: Worker; rows: readonly string[] }> {
  const worker = await bootWorker(context, root, name);
  const booted = await worker.next('booted');
  return { worker, rows: [...(booted.rows as string[])] };
}


/** Sends one command and waits for its own result event. */
async function command(worker: Worker, line: string): Promise<Record<string, unknown>> {
  const kind = line.split(' ')[0] as string;
  worker.send(line);
  return worker.next(`result:${kind}`);
}

/** Ends the child's command loop and waits for a clean shutdown. */
async function stop(worker: Worker, options: { readonly expectCleanRecording?: boolean } = {}): Promise<void> {
  worker.send('exit');
  const code = await worker.wait();
  assert.equal(code, 0, `${worker.name} exited ${String(code)}:\n${worker.stderr()}`);
  assert.equal(worker.stderr().includes('TypeError'), false, `${worker.name} crashed:\n${worker.stderr()}`);
  if (options.expectCleanRecording === true) {
    assert.doesNotMatch(worker.stderr(), /HISTORY_RECORDING_FAILED|Session not found/u);
  }
}

// ── parent kernel (the process that runs retention) ───────────────────

interface Parent {
  readonly kernel: ReturnType<typeof createStandardKernel>;
  readonly caller: ServiceContext;
  /** Runs the store's retention exactly as a peer's boot hook does. */
  run(policy?: { readonly cutoffMs?: number; readonly minUndoEntries?: number; readonly keepSessionId?: string }): void;
  readonly liveSessions: () => readonly PersistedSession[];
}

async function bootParent(context: TestContext, workspaceRoot: string): Promise<Parent> {
  const kernel = createStandardKernel();
  await kernel.boot({ workspaceRoot });
  context.after(async () => { await kernel.shutdown(); });
  const caller: ServiceContext = { callerId: 'retention.liveRow.parent', tier: 'core', workspaceRoot };
  return {
    kernel,
    caller,
    run(policy = {}): void {
      const history = kernel.requestAccess(caller, UniversalHistoryToken) as unknown as {
        readonly service?: { readonly store: { applyRetention: (p: Record<string, unknown>) => unknown } };
        readonly store?: { applyRetention: (p: Record<string, unknown>) => unknown };
      };
      const store = history.service?.store ?? history.store;
      if (store === undefined || typeof store.applyRetention !== 'function') {
        throw new Error(`parent history surface exposes no store: ${Object.keys(history as object).join(',')}`);
      }
      store.applyRetention({
        cutoffMs: policy.cutoffMs ?? Date.now(),
        minUndoEntries: policy.minUndoEntries ?? 1,
        ...(policy.keepSessionId === undefined ? {} : { keepSessionId: policy.keepSessionId }),
      });
    },
    liveSessions: () => readSessions(workspaceRoot).filter((row) => row.implicit === 1 && row.status === 'active'),
  };
}

/** Boots workers one at a time so concurrent boots cannot overlap on a fresh database. */
async function sequential(context: TestContext, root: string, names: readonly string[]): Promise<Worker[]> {
  const booted: Worker[] = [];
  for (const name of names) {
    booted.push(await bootWorker(context, root, name));
  }
  return booted;
}

/**
 * Leaves the worker's first mutation queued before its append (the held step's
 * pre-image capture is a real `readFile` of a path that does not exist yet), so
 * a peer's retention runs inside the attribution→append stretch of the audit.
 */
async function held(context: TestContext, root: string, name: string): Promise<{ worker: Worker; rows: readonly string[] }> {
  const worker = await bootWorker(context, root, name);
  await worker.next('booted');
  worker.send('hold held/one.txt one two');
  await sleep(120);
  return { worker, rows: ownedRows(root, worker.name) };
}

/** The workspace's active implicit rows that are not the parent's own. */
function ownedRows(root: string, _name: string): string[] {
  return readSessions(root).filter((row) => row.implicit === 1 && row.status === 'active').map((row) => row.sessionId);
}

describe('history retention — a live peer\'s implicit row survives a peer\'s retention (RL)', () => {
  it("T-1.1: a peer's retention reclaims a closed boot row and keeps a live one", async (context) => {
    const root = await makeWorkspace(context, 'brud-rl-t11-');
    // The parent boots first, so its own boot-time retention sees no peer rows.
    const parent = await bootParent(context, root);
    const parentRow = readSessions(root).filter((row) => row.implicit === 1 && row.status === 'active').map((row) => row.sessionId)[0];

    const beta = await bootOwned(context, root, 'beta');
    const [dead] = beta.rows;
    assert.ok(dead !== undefined, 'beta reported no boot row');
    // beta closes its own row and its kernel goes away.
    await stop(beta.worker);

    // gamma boots and holds a mutation before its append.
    const gamma = await held(context, root, 'gamma');
    const live = gamma.rows.find((row) => row !== parentRow && row !== dead);
    assert.ok(live !== undefined, `gamma's boot row not found among ${JSON.stringify(gamma.rows)}`);

    // A peer's retention pass, keeping nothing of its own.
    parent.run({ keepSessionId: 'no-such-session' });

    const sessions = readSessions(root);
    assert.equal(sessions.some((row) => row.sessionId === dead), false,
      `the closed boot row ${dead} was not reclaimed: ${JSON.stringify(sessions)}`);
    assert.equal(sessions.some((row) => row.sessionId === live && row.status === 'active'), true,
      `the live boot row ${live} was deleted by a peer's retention: ${JSON.stringify(sessions)}`);

    // The held mutation lands in that row and nothing is recovered. Each path
    // is asserted individually: two quick writes to one path may or may not be
    // coalesced into a single entry, so a total row count would measure that
    // race rather than the property.
    const released = await command(gamma.worker, 'release probe.txt');
    assert.equal(released.outcome, 'ok', `the held mutation failed: ${JSON.stringify(released)}`);
    assert.ok(readCount(root, `SELECT COUNT(*) AS n FROM entries WHERE session_id = '${live}' AND file_path = 'held/one.txt'`) >= 1,
      `the held mutation did not land in the live row; rows: ${JSON.stringify(readSessions(root))}`);
    assert.equal(readCount(root, `SELECT COUNT(*) AS n FROM entries WHERE session_id = '${live}' AND file_path = 'probe.txt'`), 1,
      `the released write did not land in the live row; rows: ${JSON.stringify(readSessions(root))}`);
    await stop(gamma.worker, { expectCleanRecording: true });
  });

  it('T-1.2: a worker\'s first mutation still lands in its live row after a peer\'s retention', async (context) => {
    const root = await makeWorkspace(context, 'brud-rl-t12-');
    const { worker, rows } = await bootOwned(context, root, 'victim');
    const [live] = rows;
    assert.ok(live, 'the worker reported no boot row');
    const parent = await bootParent(context, root);

    parent.run({ keepSessionId: live });

    const first = await command(worker, 'write live/one.txt one');
    assert.equal(first.outcome, 'ok', `the first write failed: ${JSON.stringify(first)}`);
    const second = await command(worker, 'write live/two.txt two');
    assert.equal(second.outcome, 'ok', `the second write failed: ${JSON.stringify(second)}`);

    assert.equal(readCount(root, "SELECT COUNT(*) AS n FROM entries WHERE file_path LIKE 'live/%'"), 2,
      'the live worker\'s entries were not recorded');
    // Both writes (and the `mkdir` the first one implies) must be in the row
    // the worker booted with; a recovery row would mean its row was lost.
    assert.equal(readCount(root, `SELECT COUNT(*) AS n FROM entries WHERE session_id = '${live}' AND file_path IN ('live/one.txt', 'live/two.txt')`), 2,
      `the live worker's writes did not land in its own row; rows: ${JSON.stringify(readSessions(root))}, entries: ${JSON.stringify(sqlRows(root, 'SELECT seq, session_id, file_path FROM entries'))}`);
    await stop(worker, { expectCleanRecording: true });
  });

  it('T-1.3: a worker\'s replacement recording row survives a peer\'s retention before its first append', async (context) => {
    const root = await makeWorkspace(context, 'brud-rl-t13-');
    const { worker, rows } = await bootOwned(context, root, 'victim');
    const [boot] = rows;
    assert.ok(boot, 'the worker reported no boot row');
    const parent = await bootParent(context, root);

    const rotation = await command(worker, 'rotate rotation');
    assert.equal(rotation.outcome, 'ok', `rotation failed: ${JSON.stringify(rotation)}`);
    const replacement = replacementRow(root, boot);
    assert.ok(replacement, 'rotation left no live row');

    parent.run({ keepSessionId: replacement });

    const write = await command(worker, 'write after/one.txt one');
    assert.equal(write.outcome, 'ok', `the write after rotation failed: ${JSON.stringify(write)}`);
    assert.equal(readCount(root, "SELECT COUNT(*) AS n FROM entries WHERE file_path LIKE 'after/%'"), 1,
      'the replacement row lost its first entry');
    assert.equal(readCount(root, `SELECT COUNT(*) AS n FROM entries WHERE session_id = '${replacement}' AND file_path = 'after/one.txt'`), 1,
      'the replacement row lost its first entry');
    await stop(worker);
  });

  it('T-1.5: a live worker\'s checkpoint and reversal survive a peer\'s retention; a closed one\'s do not', async (context) => {
    const root = await makeWorkspace(context, 'brud-rl-t15-');
    const { worker, rows } = await bootOwned(context, root, 'victim');
    const [live] = rows;
    assert.ok(live, 'the worker reported no boot row');
    const parent = await bootParent(context, root);

    // The checkpoint is taken while `a.txt` is at v1, strictly above the floor
    // that a later pass will apply, so retention's checkpoint rule reaches it.
    for (const line of ['write held/a.txt one', 'checkpoint early', 'write held/a.txt two', 'undo', 'redo', 'write held/b.txt three']) {
      const outcome = await command(worker, line);
      assert.equal(outcome.outcome, 'ok', `"${line}" failed: ${JSON.stringify(outcome)}`);
    }
    const reversal = await command(worker, 'reversal');
    assert.equal(reversal.outcome, 'ok', `recording the reversal failed: ${JSON.stringify(reversal)}`);

    const cutoff = Date.now() + DAY;
    const checkpoints = readCount(root, 'SELECT COUNT(*) AS n FROM checkpoints');
    const reversals = readCount(root, 'SELECT COUNT(*) AS n FROM reversals');
  
    assert.ok(checkpoints >= 1, 'the worker recorded no checkpoint');
    assert.ok(reversals >= 1, `the worker recorded no reversal (rows: ${JSON.stringify(readSessions(root))})`);

    // A peer's pass where every row is older than the cutoff and nothing is kept.
    parent.run({ cutoffMs: cutoff, minUndoEntries: 0, keepSessionId: 'no-such-session' });

    assert.equal(readCount(root, `SELECT COUNT(*) AS n FROM sessions WHERE session_id = '${live}' AND status = 'active'`), 1,
      `the live worker's row ${live} was removed: ${JSON.stringify(readSessions(root))}`);
    assert.equal(readCount(root, 'SELECT COUNT(*) AS n FROM checkpoints'), checkpoints,
      'retention removed a live worker\'s checkpoint');
    assert.equal(readCount(root, 'SELECT COUNT(*) AS n FROM reversals'), reversals,
      'retention removed a live worker\'s reversal');

    // Once the worker has closed, the same pass reclaims its rows.
    await stop(worker);
    parent.run({ cutoffMs: cutoff, minUndoEntries: 0, keepSessionId: 'no-such-session' });
    // The row itself stays while the frozen undo floor protects its newest file
    // entry (D-15 §12); what must change is that its checkpoint and reversal are
    // no longer shielded, because nothing claims the session any more.
    assert.equal(readCount(root, 'SELECT COUNT(*) AS n FROM checkpoints'), 0,
      'a closed worker\'s checkpoint was not reclaimed');
    assert.equal(readCount(root, 'SELECT COUNT(*) AS n FROM reversals'), 0,
      'a closed worker\'s reversal was not reclaimed');
  });
});
