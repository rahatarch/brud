import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQLOutputValue } from 'node:sqlite';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIGRATION_TABLE,
  SCHEMA_VERSION,
  applySchema,
  getAppliedMigrations,
} from './schema.js';
import {
  InvalidLedgerPathError,
  InvalidLedgerValueError,
  LedgerClosedError,
  SessionNotFoundError,
  SqliteLedger,
  toWorkspaceRelativePath,
} from './SqliteLedger.js';
import type {
  ReversalInsertRow,
  SessionFileInsertRow,
  SessionInsertRow,
} from './types.js';

const CREATED_AT = '2026-01-01T00:00:00.000Z';
const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'brud-sqlite-ledger-'));
  temporaryDirectories.push(directory);
  return directory;
}

after(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createLedger(): SqliteLedger {
  return new SqliteLedger({ dbPath: ':memory:' });
}

function session(
  sessionId: string,
  createdAt: string = CREATED_AT,
  overrides: Partial<SessionInsertRow> = {},
): SessionInsertRow {
  return {
    session_id: sessionId,
    created_at: createdAt,
    prompt: `prompt ${sessionId}`,
    status: 'active',
    files_affected: JSON.stringify(['src/index.ts']),
    ...overrides,
  };
}

function file(
  relativePath: string,
  overrides: Partial<SessionFileInsertRow> = {},
): SessionFileInsertRow {
  return {
    relative_path: relativePath,
    pre_sha256: DIGEST_A,
    post_sha256: DIGEST_B,
    diff_content: '@@ -1 +1 @@\n-old\n+new\n',
    blob_sha256: null,
    is_binary: 0,
    ...overrides,
  };
}

function reversal(
  reversalId: string,
  sessionId: string,
  overrides: Partial<ReversalInsertRow> = {},
): ReversalInsertRow {
  return {
    reversal_id: reversalId,
    session_id: sessionId,
    target_state: 'pre',
    executed_at: CREATED_AT,
    status: 'success',
    reverted_operations: JSON.stringify(['op-1', 'op-2']),
    error_message: null,
    ...overrides,
  };
}

function captureError(work: () => void): unknown {
  try {
    work();
  } catch (error) {
    return error;
  }

  assert.fail('Expected the operation to throw');
}

function stringsFrom(rows: readonly Record<string, SQLOutputValue>[], column: string): string[] {
  return rows.flatMap((row) => {
    const value = row[column];
    return typeof value === 'string' ? [value] : [];
  });
}

function schemaObjects(db: DatabaseSync, type: 'table' | 'index'): readonly string[] {
  const rows = db
    .prepare('SELECT name FROM sqlite_master WHERE type = ?')
    .all(type);

  return stringsFrom(rows, 'name').sort();
}

function readPragma(db: DatabaseSync, pragma: string): SQLOutputValue {
  const row = db.prepare(`PRAGMA ${pragma}`).get();
  return row?.[pragma] ?? null;
}

function countRows(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
  const value = row?.count;
  return typeof value === 'number' ? value : Number.NaN;
}

describe('SqliteLedger schema', () => {
  it('creates every ledger table and index', () => {
    const db = new DatabaseSync(':memory:');

    try {
      applySchema(db);

      assert.deepEqual(
        schemaObjects(db, 'table').filter((name) => name !== 'sqlite_sequence'),
        ['reversals', MIGRATION_TABLE, 'session_files', 'sessions'],
      );
      assert.deepEqual(schemaObjects(db, 'index').filter((name) => name.startsWith('idx_')), [
        'idx_reversals_session',
        'idx_session_files_path',
        'idx_session_files_session',
        'idx_sessions_created_at',
        'idx_sessions_is_deleted',
      ]);
    } finally {
      db.close();
    }
  });

  it('records the schema version once across repeated applications', () => {
    const db = new DatabaseSync(':memory:');

    try {
      applySchema(db);
      assert.deepEqual(getAppliedMigrations(db), [SCHEMA_VERSION]);

      const applied = db
        .prepare(`SELECT applied_at FROM ${MIGRATION_TABLE} WHERE version = ?`)
        .get(SCHEMA_VERSION);
      assert.equal(typeof applied?.applied_at, 'string');

      applySchema(db);
      assert.deepEqual(getAppliedMigrations(db), [SCHEMA_VERSION]);
      assert.equal(countRows(db, MIGRATION_TABLE), 1);
    } finally {
      db.close();
    }
  });

  it('configures WAL, foreign keys, and synchronous mode for file databases', () => {
    const directory = createTemporaryDirectory();
    const db = new DatabaseSync(join(directory, 'schema.db'));

    try {
      applySchema(db);

      assert.equal(readPragma(db, 'journal_mode'), 'wal');
      assert.equal(readPragma(db, 'foreign_keys'), 1);
      assert.equal(readPragma(db, 'synchronous'), 1);
    } finally {
      db.close();
    }
  });

  it('keeps in-memory databases in memory journal mode', () => {
    const db = new DatabaseSync(':memory:');

    try {
      applySchema(db);

      assert.equal(readPragma(db, 'journal_mode'), 'memory');
      assert.equal(readPragma(db, 'foreign_keys'), 1);
    } finally {
      db.close();
    }
  });

  it('enforces foreign keys for orphaned child rows', () => {
    const db = new DatabaseSync(':memory:');

    try {
      applySchema(db);

      assert.throws(() => {
        db.prepare(`INSERT INTO session_files (
          session_id, relative_path, pre_sha256, post_sha256, is_binary
        ) VALUES (?, ?, ?, ?, 0)`).run('BR-20260101-999', 'src/index.ts', DIGEST_A, DIGEST_B);
      }, /FOREIGN KEY constraint failed/u);
    } finally {
      db.close();
    }
  });
});

describe('workspace-relative paths', () => {
  it('normalizes separators and strips trailing separators', () => {
    assert.equal(toWorkspaceRelativePath('src/index.ts'), 'src/index.ts');
    assert.equal(toWorkspaceRelativePath('src\\nested\\file.ts'), 'src/nested/file.ts');
    assert.equal(toWorkspaceRelativePath('src/dir/'), 'src/dir');
  });

  it('rejects empty, null-byte, absolute, and traversal paths', () => {
    assert.throws(() => toWorkspaceRelativePath(''), InvalidLedgerPathError);
    assert.throws(() => toWorkspaceRelativePath('/etc/passwd'), InvalidLedgerPathError);
    assert.throws(() => toWorkspaceRelativePath('C:\\Windows\\system.ini'), InvalidLedgerPathError);
    assert.throws(() => toWorkspaceRelativePath('\\\\server\\share\\file.ts'), InvalidLedgerPathError);
    assert.throws(() => toWorkspaceRelativePath('../outside.ts'), InvalidLedgerPathError);
    assert.throws(() => toWorkspaceRelativePath('src/\0evil.ts'), InvalidLedgerPathError);

    const error = captureError(() => toWorkspaceRelativePath('/etc/passwd'));
    assert.ok(error instanceof InvalidLedgerPathError);
    assert.equal(error.reason, 'ABSOLUTE_PATH');
    assert.equal(error.path, '/etc/passwd');
  });
});

describe('SqliteLedger sessions', () => {
  it('creates a session with soft-delete defaults and no files', () => {
    const ledger = createLedger();

    try {
      ledger.createSession(session('BR-20260101-001'));

      const stored = ledger.getSession('BR-20260101-001');
      assert.ok(stored);
      assert.deepEqual(stored.session, {
        session_id: 'BR-20260101-001',
        created_at: CREATED_AT,
        prompt: 'prompt BR-20260101-001',
        status: 'active',
        files_affected: '["src/index.ts"]',
        is_deleted: 0,
        deleted_at: null,
        expires_at: null,
      });
      assert.deepEqual(stored.files, []);
    } finally {
      ledger.close();
    }
  });

  it('returns null for unknown sessions', () => {
    const ledger = createLedger();

    try {
      assert.equal(ledger.getSession('BR-20260101-404'), null);
    } finally {
      ledger.close();
    }
  });

  it('rejects duplicate session identifiers', () => {
    const ledger = createLedger();

    try {
      ledger.createSession(session('BR-20260101-001'));

      assert.throws(
        () => ledger.createSession(session('BR-20260101-001')),
        /UNIQUE constraint failed/u,
      );
    } finally {
      ledger.close();
    }
  });

  it('rejects absolute paths and malformed file manifests', () => {
    const ledger = createLedger();

    try {
      assert.throws(
        () => ledger.createSession(session('BR-20260101-001', CREATED_AT, {
          files_affected: JSON.stringify(['/etc/passwd']),
        })),
        InvalidLedgerPathError,
      );

      const jsonError = captureError(() => ledger.createSession(
        session('BR-20260101-002', CREATED_AT, { files_affected: '{not json' }),
      ));
      assert.ok(jsonError instanceof InvalidLedgerValueError);
      assert.equal(jsonError.field, 'files_affected');

      assert.deepEqual(ledger.listSessions(), []);
    } finally {
      ledger.close();
    }
  });

  it('commits a session and its files atomically', () => {
    const ledger = createLedger();

    try {
      ledger.createSession(session('BR-20260101-001', CREATED_AT, {
        files_affected: JSON.stringify(['src/index.ts', 'assets/logo.bin']),
      }));

      ledger.commitSession('BR-20260101-001', [
        file('src/index.ts'),
        file('assets/logo.bin', {
          diff_content: null,
          blob_sha256: DIGEST_C,
          is_binary: 1,
        }),
      ]);

      const stored = ledger.getSession('BR-20260101-001');
      assert.ok(stored);
      assert.equal(stored.session.status, 'committed');
      assert.equal(stored.files.length, 2);
      assert.equal(typeof stored.files[0]?.id, 'number');
      assert.deepEqual(
        stored.files.map((entry) => entry.relative_path),
        ['src/index.ts', 'assets/logo.bin'],
      );
      assert.deepEqual(stored.files[1], {
        id: stored.files[1]?.id,
        session_id: 'BR-20260101-001',
        relative_path: 'assets/logo.bin',
        pre_sha256: DIGEST_A,
        post_sha256: DIGEST_B,
        diff_content: null,
        blob_sha256: DIGEST_C,
        is_binary: 1,
      });
    } finally {
      ledger.close();
    }
  });

  it('stores canonical relative paths for existing digests', () => {
    const ledger = createLedger();

    try {
      ledger.createSession(session('BR-20260101-001'));
      ledger.commitSession('BR-20260101-001', [file('src\\nested\\file.ts')]);

      const stored = ledger.getSession('BR-20260101-001');
      assert.ok(stored);
      assert.equal(stored.files[0]?.relative_path, 'src/nested/file.ts');
    } finally {
      ledger.close();
    }
  });

  it('throws for commits against unknown sessions', () => {
    const ledger = createLedger();

    try {
      const error = captureError(() => ledger.commitSession('BR-20260101-404', [file('a.ts')]));
      assert.ok(error instanceof SessionNotFoundError);
      assert.equal(error.sessionId, 'BR-20260101-404');
      assert.deepEqual(ledger.listSessions(), []);
    } finally {
      ledger.close();
    }
  });

  it('rolls back the status update and partial file inserts when a commit fails', () => {
    const ledger = createLedger();

    try {
      ledger.createSession(session('BR-20260101-001'));

      const error = captureError(() => ledger.commitSession('BR-20260101-001', [
        file('src/index.ts'),
        file('/etc/passwd'),
      ]));

      assert.ok(error instanceof InvalidLedgerPathError);

      const stored = ledger.getSession('BR-20260101-001');
      assert.ok(stored);
      assert.equal(stored.session.status, 'active');
      assert.deepEqual(stored.files, []);

      ledger.commitSession('BR-20260101-001', [file('src/index.ts')]);
      const recommitted = ledger.getSession('BR-20260101-001');
      assert.ok(recommitted);
      assert.equal(recommitted.session.status, 'committed');
      assert.equal(recommitted.files.length, 1);
    } finally {
      ledger.close();
    }
  });

  it('rejects unsupported binary flags before writing rows', () => {
    const ledger = createLedger();

    try {
      ledger.createSession(session('BR-20260101-001'));

      const error = captureError(() => ledger.commitSession('BR-20260101-001', [
        file('src/index.ts', { is_binary: 7 }),
      ]));

      assert.ok(error instanceof InvalidLedgerValueError);
      assert.equal(error.field, 'is_binary');

      const stored = ledger.getSession('BR-20260101-001');
      assert.ok(stored);
      assert.equal(stored.session.status, 'active');
      assert.deepEqual(stored.files, []);
    } finally {
      ledger.close();
    }
  });

  it('rejects invalid timestamps', () => {
    const ledger = createLedger();

    try {
      assert.throws(
        () => ledger.createSession(session('BR-20260101-001', 'not-a-date')),
        InvalidLedgerValueError,
      );
    } finally {
      ledger.close();
    }
  });
});

describe('SqliteLedger queries', () => {
  function seed(ledger: SqliteLedger): void {
    for (let day = 1; day <= 5; day += 1) {
      const padded = day.toString().padStart(2, '0');
      const sessionId = `BR-202601${padded}-001`;

      ledger.createSession(session(sessionId, `2026-01-${padded}T00:00:00.000Z`, {
        status: day === 1 ? 'committed' : 'active',
      }));
    }
  }

  it('lists sessions newest first', () => {
    const ledger = createLedger();

    try {
      seed(ledger);

      assert.deepEqual(
        ledger.listSessions().map((entry) => entry.session_id),
        [
          'BR-20260105-001',
          'BR-20260104-001',
          'BR-20260103-001',
          'BR-20260102-001',
          'BR-20260101-001',
        ],
      );
    } finally {
      ledger.close();
    }
  });

  it('applies limit and offset pagination', () => {
    const ledger = createLedger();

    try {
      seed(ledger);

      assert.deepEqual(
        ledger.listSessions({ limit: 2 }).map((entry) => entry.session_id),
        ['BR-20260105-001', 'BR-20260104-001'],
      );
      assert.deepEqual(
        ledger.listSessions({ limit: 2, offset: 2 }).map((entry) => entry.session_id),
        ['BR-20260103-001', 'BR-20260102-001'],
      );
      assert.deepEqual(ledger.listSessions({ limit: 0 }), []);
      assert.equal(ledger.listSessions({ limit: Number.POSITIVE_INFINITY }).length, 5);
    } finally {
      ledger.close();
    }
  });

  it('filters by status and creation timestamp', () => {
    const ledger = createLedger();

    try {
      seed(ledger);

      assert.deepEqual(
        ledger.listSessions({ status: 'committed' }).map((entry) => entry.session_id),
        ['BR-20260101-001'],
      );
      assert.deepEqual(
        ledger.listSessions({ since: '2026-01-04T00:00:00.000Z' })
          .map((entry) => entry.session_id),
        ['BR-20260105-001', 'BR-20260104-001'],
      );
    } finally {
      ledger.close();
    }
  });

  it('hides soft-deleted sessions unless requested', () => {
    const ledger = createLedger();

    try {
      seed(ledger);
      ledger.softDeleteSession('BR-20260105-001', {
        deletedAt: '2026-02-01T00:00:00.000Z',
        expiresAt: '2026-03-01T00:00:00.000Z',
      });

      assert.deepEqual(
        ledger.listSessions().map((entry) => entry.session_id),
        ['BR-20260104-001', 'BR-20260103-001', 'BR-20260102-001', 'BR-20260101-001'],
      );

      const included = ledger.listSessions({ includeDeleted: true });
      assert.equal(included.length, 5);
      assert.deepEqual(included[0], {
        session_id: 'BR-20260105-001',
        created_at: '2026-01-05T00:00:00.000Z',
        prompt: 'prompt BR-20260105-001',
        status: 'active',
        files_affected: '["src/index.ts"]',
        is_deleted: 1,
        deleted_at: '2026-02-01T00:00:00.000Z',
        expires_at: '2026-03-01T00:00:00.000Z',
      });
    } finally {
      ledger.close();
    }
  });
});

describe('SqliteLedger retention', () => {
  it('soft-deletes, restores, and reports state transitions', () => {
    const ledger = createLedger();

    try {
      ledger.createSession(session('BR-20260101-001'));

      assert.equal(
        ledger.softDeleteSession('BR-20260101-001', {
          deletedAt: '2026-02-01T00:00:00.000Z',
          expiresAt: '2026-03-01T00:00:00.000Z',
        }),
        true,
      );
      assert.equal(
        ledger.softDeleteSession('BR-20260101-001', {
          deletedAt: '2026-02-02T00:00:00.000Z',
          expiresAt: '2026-03-02T00:00:00.000Z',
        }),
        false,
      );
      assert.equal(ledger.softDeleteSession('BR-20260101-404', {
        deletedAt: '2026-02-01T00:00:00.000Z',
        expiresAt: '2026-03-01T00:00:00.000Z',
      }), false);

      assert.equal(ledger.restoreSession('BR-20260101-001'), true);
      assert.equal(ledger.restoreSession('BR-20260101-001'), false);

      const restored = ledger.getSession('BR-20260101-001');
      assert.ok(restored);
      assert.equal(restored.session.is_deleted, 0);
      assert.equal(restored.session.deleted_at, null);
      assert.equal(restored.session.expires_at, null);
      assert.equal(ledger.listSessions().length, 1);
    } finally {
      ledger.close();
    }
  });

  it('purges only expired soft-deleted sessions', () => {
    const directory = createTemporaryDirectory();
    const dbPath = join(directory, 'retention.db');
    const ledger = new SqliteLedger({ dbPath });

    try {
      ledger.createSession(session('BR-20260101-001'));
      ledger.commitSession('BR-20260101-001', [file('src/index.ts')]);
      ledger.recordReversal(reversal('RV-20260101-001', 'BR-20260101-001'));

      ledger.createSession(session('BR-20260102-001'));
      ledger.createSession(session('BR-20260103-001'));

      ledger.softDeleteSession('BR-20260101-001', {
        deletedAt: '2026-02-01T00:00:00.000Z',
        expiresAt: '2026-03-01T00:00:00.000Z',
      });
      ledger.softDeleteSession('BR-20260102-001', {
        deletedAt: '2026-02-01T00:00:00.000Z',
        expiresAt: '2026-03-15T00:00:00.000Z',
      });
      ledger.softDeleteSession('BR-20260103-001', {
        deletedAt: '2026-02-01T00:00:00.000Z',
        expiresAt: '2026-04-01T00:00:00.000Z',
      });

      assert.deepEqual(
        ledger.purgeExpiredSessions('2026-03-15T00:00:00.000Z'),
        ['BR-20260101-001', 'BR-20260102-001'],
      );
      assert.deepEqual(ledger.purgeExpiredSessions('2026-03-15T00:00:00.000Z'), []);
      assert.equal(ledger.getSession('BR-20260101-001'), null);
      assert.deepEqual(ledger.getReversalsForSession('BR-20260101-001'), []);

      const remaining = ledger.listSessions({ includeDeleted: true });
      assert.deepEqual(remaining.map((entry) => entry.session_id), ['BR-20260103-001']);
    } finally {
      ledger.close();
    }

    const db = new DatabaseSync(dbPath);

    try {
      assert.equal(countRows(db, 'sessions'), 1);
      assert.equal(countRows(db, 'session_files'), 0);
      assert.equal(countRows(db, 'reversals'), 0);
    } finally {
      db.close();
    }
  });
});

describe('SqliteLedger reversals', () => {
  it('records reversals and reads them in execution order', () => {
    const ledger = createLedger();

    try {
      ledger.createSession(session('BR-20260101-001'));
      ledger.recordReversal(reversal('RV-20260101-002', 'BR-20260101-001', {
        executed_at: '2026-01-03T00:00:00.000Z',
        status: 'failed',
        error_message: 'blob mismatch',
      }));
      ledger.recordReversal(reversal('RV-20260101-001', 'BR-20260101-001', {
        executed_at: '2026-01-02T00:00:00.000Z',
      }));

      assert.deepEqual(ledger.getReversalsForSession('BR-20260101-001'), [
        {
          reversal_id: 'RV-20260101-001',
          session_id: 'BR-20260101-001',
          target_state: 'pre',
          executed_at: '2026-01-02T00:00:00.000Z',
          status: 'success',
          reverted_operations: '["op-1","op-2"]',
          error_message: null,
        },
        {
          reversal_id: 'RV-20260101-002',
          session_id: 'BR-20260101-001',
          target_state: 'pre',
          executed_at: '2026-01-03T00:00:00.000Z',
          status: 'failed',
          reverted_operations: '["op-1","op-2"]',
          error_message: 'blob mismatch',
        },
      ]);
      assert.deepEqual(ledger.getReversalsForSession('BR-20260101-404'), []);
    } finally {
      ledger.close();
    }
  });

  it('rejects reversals for unknown sessions', () => {
    const ledger = createLedger();

    try {
      const error = captureError(
        () => ledger.recordReversal(reversal('RV-20260101-001', 'BR-20260101-404')),
      );

      assert.ok(error instanceof SessionNotFoundError);
      assert.equal(error.sessionId, 'BR-20260101-404');
    } finally {
      ledger.close();
    }
  });

  it('rejects malformed operation identifiers', () => {
    const ledger = createLedger();

    try {
      ledger.createSession(session('BR-20260101-001'));

      const error = captureError(() => ledger.recordReversal(
        reversal('RV-20260101-001', 'BR-20260101-001', {
          reverted_operations: JSON.stringify([1, 2]),
        }),
      ));

      assert.ok(error instanceof InvalidLedgerValueError);
      assert.equal(error.field, 'reverted_operations');
      assert.deepEqual(ledger.getReversalsForSession('BR-20260101-001'), []);
    } finally {
      ledger.close();
    }
  });
});

describe('SqliteLedger lifecycle', () => {
  it('persists data and WAL mode across reopens', () => {
    const directory = createTemporaryDirectory();
    const dbPath = join(directory, 'nested', 'ledger.db');

    const ledger = new SqliteLedger({ dbPath });

    try {
      ledger.createSession(session('BR-20260101-001'));
      ledger.commitSession('BR-20260101-001', [file('src/index.ts')]);
    } finally {
      ledger.close();
    }

    const reopened = new SqliteLedger({ dbPath });

    try {
      const stored = reopened.getSession('BR-20260101-001');
      assert.ok(stored);
      assert.equal(stored.session.status, 'committed');
      assert.equal(stored.files[0]?.relative_path, 'src/index.ts');
      assert.deepEqual(getAppliedMigrationsProbe(dbPath), [SCHEMA_VERSION]);
    } finally {
      reopened.close();
    }

    const probe = new DatabaseSync(dbPath);

    try {
      assert.equal(readPragma(probe, 'journal_mode'), 'wal');
    } finally {
      probe.close();
    }
  });

  it('rejects non-memory relative database paths', () => {
    assert.throws(() => new SqliteLedger({ dbPath: 'relative/ledger.db' }), RangeError);
  });

  it('throws typed errors after close and tolerates repeated closes', () => {
    const ledger = createLedger();
    ledger.createSession(session('BR-20260101-001'));

    ledger.close();
    ledger.close();

    assert.throws(() => ledger.listSessions(), LedgerClosedError);
    assert.throws(() => ledger.getSession('BR-20260101-001'), LedgerClosedError);
    assert.throws(() => ledger.createSession(session('BR-20260101-002')), LedgerClosedError);
  });
});

function getAppliedMigrationsProbe(dbPath: string): readonly number[] {
  const probe = new DatabaseSync(dbPath);

  try {
    return getAppliedMigrations(probe);
  } finally {
    probe.close();
  }
}
