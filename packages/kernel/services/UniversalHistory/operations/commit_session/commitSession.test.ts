import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { TestContext } from 'node:test';
import { InMemoryStorageDriver } from '../../../../drivers/memory/index.js';
import { BrudFileSystem } from '../../../BrudFileSystem/orchestrator/BrudFileSystem.js';
import {
  InvalidLedgerPathError,
  SessionNotFoundError,
  SqliteLedger,
} from '../../storage/SqliteLedger/SqliteLedger.js';
import type { SessionInsertRow } from '../../storage/SqliteLedger/types.js';
import { computeDelta } from '../compute_delta/computeDelta.js';
import type { FileDelta } from '../compute_delta/types.js';
import {
  HISTORY_BLOBS_DIRECTORY,
  casBlobPath,
  commitSession,
} from './commitSession.js';
import {
  BlobDigestMismatchError,
  MissingBlobPayloadError,
} from './types.js';

const SESSION_ID = 'BR-20260201-001';
const COMMITTED_AT = '2026-02-01T10:00:00.000Z';

interface Harness {
  readonly ledger: SqliteLedger;
  readonly fileSystem: BrudFileSystem;
  readonly driver: InMemoryStorageDriver;
}

async function createHarness(context: TestContext): Promise<Harness> {
  const ledger = new SqliteLedger({ dbPath: ':memory:' });
  context.after(() => ledger.close());

  const driver = new InMemoryStorageDriver();
  const fileSystem = new BrudFileSystem('/workspace', driver, { trustedWriteScopes: ['.brud/history'] });
  await fileSystem.initialize();

  return { ledger, fileSystem, driver };
}

function sessionRow(sessionId: string, filesAffected: readonly string[] = []): SessionInsertRow {
  return {
    session_id: sessionId,
    created_at: '2026-02-01T09:00:00.000Z',
    prompt: 'implement universal history operations',
    status: 'active',
    files_affected: JSON.stringify(filesAffected),
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function missingDigest(relativePath: string) {
  return {
    relativePath,
    sha256: '',
    sizeBytes: 0,
    isBinary: false,
    exists: false,
  };
}

async function createdDelta(
  fileSystem: BrudFileSystem,
  relativePath: string,
  data: Uint8Array | string,
): Promise<FileDelta> {
  await fileSystem.createFile(relativePath, data);
  return computeDelta({
    fileSystem,
    relativePath,
    baseline: missingDigest(relativePath),
  });
}

function fileOf(ledger: SqliteLedger, sessionId: string, relativePath: string) {
  const session = ledger.getSession(sessionId);
  assert.ok(session);
  const file = session.files.find((row) => row.relative_path === relativePath);
  assert.ok(file);
  return { session, file };
}

describe('commitSession', () => {
  it('commits text-only sessions directly to SQLite', async (context) => {
    const { ledger, fileSystem } = await createHarness(context);
    ledger.createSession(sessionRow(SESSION_ID, ['src/a.ts']));

    const delta = await createdDelta(fileSystem, 'src/a.ts', 'export const a = 1;\n');

    const receipt = await commitSession({
      ledger,
      fileSystem,
      sessionId: SESSION_ID,
      deltas: [delta],
      committedAt: COMMITTED_AT,
    });

    assert.equal(receipt.sessionId, SESSION_ID);
    assert.equal(receipt.committedFileCount, 1);
    assert.equal(receipt.committedAt, COMMITTED_AT);
    assert.deepEqual(receipt.blobs, []);

    const { session, file } = fileOf(ledger, SESSION_ID, 'src/a.ts');
    assert.equal(session.session.status, 'committed');
    assert.equal(session.files.length, 1);
    assert.equal(file.pre_sha256, '');
    assert.equal(file.post_sha256, sha256(Buffer.from('export const a = 1;\n', 'utf8')));
    assert.match(file.diff_content ?? '', /\+export const a = 1;\n/u);
    assert.equal(file.blob_sha256, null);
    assert.equal(file.is_binary, 0);
    assert.equal(await fileSystem.exists(HISTORY_BLOBS_DIRECTORY), false);
  });

  it('ignores unchanged deltas', async (context) => {
    const { ledger, fileSystem } = await createHarness(context);
    ledger.createSession(sessionRow(SESSION_ID));

    const delta = await createdDelta(fileSystem, 'src/a.ts', 'stable\n');
    const unchanged: FileDelta = {
      ...delta,
      changeKind: 'unchanged',
      isChanged: false,
      blobPayload: null,
      diffContent: null,
    };

    const receipt = await commitSession({
      ledger,
      fileSystem,
      sessionId: SESSION_ID,
      deltas: [unchanged],
      committedAt: COMMITTED_AT,
    });

    assert.equal(receipt.committedFileCount, 0);

    const session = ledger.getSession(SESSION_ID);
    assert.ok(session);
    assert.equal(session.session.status, 'committed');
    assert.equal(session.files.length, 0);
  });

  it('stores binary payloads under a two-character shard', async (context) => {
    const { ledger, fileSystem } = await createHarness(context);
    ledger.createSession(sessionRow(SESSION_ID, ['assets/archive.bin']));

    const bytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x10]);
    const delta = await createdDelta(fileSystem, 'assets/archive.bin', bytes);
    const digest = sha256(bytes);

    const receipt = await commitSession({
      ledger,
      fileSystem,
      sessionId: SESSION_ID,
      deltas: [delta],
      committedAt: COMMITTED_AT,
    });

    const expectedPath = `${HISTORY_BLOBS_DIRECTORY}/${digest.slice(0, 2)}/${digest}`;
    assert.equal(casBlobPath(digest), expectedPath);
    assert.equal(receipt.blobs.length, 1);
    assert.deepEqual(receipt.blobs[0], { sha256: digest, relativePath: expectedPath });

    assert.equal(await fileSystem.exists(expectedPath), true);
    assert.deepEqual(Array.from(await fileSystem.readFile(expectedPath)), Array.from(bytes));

    const { file } = fileOf(ledger, SESSION_ID, 'assets/archive.bin');
    assert.equal(file.blob_sha256, digest);
    assert.equal(file.post_sha256, digest);
    assert.equal(file.diff_content, null);
    assert.equal(file.is_binary, 1);
  });

  it('stores oversized text payloads as blobs', async (context) => {
    const { ledger, fileSystem } = await createHarness(context);
    ledger.createSession(sessionRow(SESSION_ID));

    const content = 'y'.repeat(70 * 1024);
    const delta = await createdDelta(fileSystem, 'logs/huge.txt', content);

    const receipt = await commitSession({
      ledger,
      fileSystem,
      sessionId: SESSION_ID,
      deltas: [delta],
      committedAt: COMMITTED_AT,
    });

    assert.equal(delta.isBinary, true);
    assert.equal(receipt.blobs.length, 1);
    assert.equal(await fileSystem.exists(receipt.blobs[0].relativePath), true);
    assert.equal(
      (await fileSystem.readText(receipt.blobs[0].relativePath)).length,
      content.length,
    );

    const { file } = fileOf(ledger, SESSION_ID, 'logs/huge.txt');
    assert.equal(file.blob_sha256, sha256(Buffer.from(content, 'utf8')));
    assert.equal(file.is_binary, 1);
  });

  it('does not rewrite an existing CAS blob', async (context) => {
    const { ledger, fileSystem } = await createHarness(context);
    const bytes = Uint8Array.from([0x01, 0x00, 0x02]);
    const firstSession = 'BR-20260201-001';
    const secondSession = 'BR-20260201-002';
    ledger.createSession(sessionRow(firstSession));
    ledger.createSession(sessionRow(secondSession));

    const delta = await createdDelta(fileSystem, 'assets/shared.bin', bytes);
    const first = await commitSession({
      ledger,
      fileSystem,
      sessionId: firstSession,
      deltas: [delta],
      committedAt: COMMITTED_AT,
    });
    const second = await commitSession({
      ledger,
      fileSystem,
      sessionId: secondSession,
      deltas: [delta],
      committedAt: COMMITTED_AT,
    });

    assert.equal(first.blobs[0].relativePath, second.blobs[0].relativePath);
    assert.deepEqual(Array.from(await fileSystem.readFile(first.blobs[0].relativePath)), Array.from(bytes));
  });

  it('rolls back the manifest when a file row is invalid', async (context) => {
    const { ledger, fileSystem } = await createHarness(context);
    ledger.createSession(sessionRow(SESSION_ID));

    const valid = await createdDelta(fileSystem, 'src/a.ts', 'alpha\n');
    const invalid: FileDelta = {
      ...valid,
      relativePath: '/etc/passwd',
    };

    await assert.rejects(
      commitSession({
        ledger,
        fileSystem,
        sessionId: SESSION_ID,
        deltas: [valid, invalid],
        committedAt: COMMITTED_AT,
      }),
      (error: unknown) => error instanceof InvalidLedgerPathError,
    );

    const afterFailure = ledger.getSession(SESSION_ID);
    assert.ok(afterFailure);
    assert.equal(afterFailure.session.status, 'active');
    assert.deepEqual(afterFailure.files, []);

    const receipt = await commitSession({
      ledger,
      fileSystem,
      sessionId: SESSION_ID,
      deltas: [valid],
      committedAt: COMMITTED_AT,
    });

    assert.equal(receipt.committedFileCount, 1);
    const afterRetry = fileOf(ledger, SESSION_ID, 'src/a.ts');
    assert.equal(afterRetry.session.session.status, 'committed');
    assert.equal(afterRetry.session.files.length, 1);
  });

  it('fails before touching the ledger when a binary payload is missing', async (context) => {
    const { ledger, fileSystem } = await createHarness(context);
    ledger.createSession(sessionRow(SESSION_ID));

    const delta = await createdDelta(
      fileSystem,
      'assets/broken.bin',
      Uint8Array.from([0x00, 0x01]),
    );
    const broken: FileDelta = { ...delta, blobPayload: null };

    await assert.rejects(
      commitSession({
        ledger,
        fileSystem,
        sessionId: SESSION_ID,
        deltas: [broken],
        committedAt: COMMITTED_AT,
      }),
      (error: unknown) => error instanceof MissingBlobPayloadError,
    );

    const session = ledger.getSession(SESSION_ID);
    assert.ok(session);
    assert.equal(session.session.status, 'active');
    assert.equal(session.files.length, 0);
  });

  it('rejects blob payloads that do not match the post-digest', async (context) => {
    const { ledger, fileSystem } = await createHarness(context);
    ledger.createSession(sessionRow(SESSION_ID));

    const delta = await createdDelta(
      fileSystem,
      'assets/mismatch.bin',
      Uint8Array.from([0x00, 0x03]),
    );
    const mismatched: FileDelta = {
      ...delta,
      postDigest: { ...delta.postDigest, sha256: 'f'.repeat(64) },
    };

    await assert.rejects(
      commitSession({
        ledger,
        fileSystem,
        sessionId: SESSION_ID,
        deltas: [mismatched],
        committedAt: COMMITTED_AT,
      }),
      (error: unknown) => error instanceof BlobDigestMismatchError,
    );

    assert.equal(await fileSystem.exists(casBlobPath('f'.repeat(64))), false);
  });

  it('rejects unknown sessions without inserting rows', async (context) => {
    const { ledger, fileSystem } = await createHarness(context);
    const delta = await createdDelta(fileSystem, 'src/ghost.ts', 'ghost\n');

    await assert.rejects(
      commitSession({
        ledger,
        fileSystem,
        sessionId: 'BR-20260201-999',
        deltas: [delta],
        committedAt: COMMITTED_AT,
      }),
      (error: unknown) => error instanceof SessionNotFoundError,
    );

    assert.equal(ledger.getSession('BR-20260201-999'), null);
  });

  it('rejects malformed CAS digests', () => {
    assert.throws(() => casBlobPath('not-a-digest'));
  });
});
