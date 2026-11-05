import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OperationResult } from '../../src/contracts/handler.js';

const run = promisify(execFile);
const FIXTURE = fileURLToPath(new URL('./fixtures/kernelWorker.ts', import.meta.url));
const WORKERS = ['a', 'b', 'c'] as const;

interface Outbox {
  readonly workerId: string;
  readonly result: OperationResult;
}

describe('real child-process concurrency', () => {
  it('three kernels boot, execute, write and exit cleanly', { timeout: 120_000 }, async (t) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'brud-concurrency-')));
    t.after(() => rm(root, { recursive: true, force: true }));

    const outboxes = WORKERS.map((workerId) => join(root, `outbox-${workerId}.json`));

    const runs = await Promise.all(
      WORKERS.map((workerId, index) =>
        run(process.execPath, [
          '--import',
          'tsx',
          FIXTURE,
          root,
          workerId,
          outboxes[index] as string,
        ]),
      ),
    );

    for (const { stderr } of runs) {
      assert.doesNotMatch(stderr, /unhandled/i);
    }

    for (const [index, workerId] of WORKERS.entries()) {
      const outbox = JSON.parse(await readFile(outboxes[index] as string, 'utf8')) as Outbox;

      assert.equal(outbox.workerId, workerId);
      assert.equal(outbox.result.status, 'success');
      assert.equal(
        await readFile(join(root, `worker-${workerId}.txt`), 'utf8'),
        `from-${workerId}`,
      );
    }

    const dbPath = join(root, '.brud', 'history', 'universal.db');
    await access(dbPath);

    const db = new DatabaseSync(dbPath);
    try {
      const row = db.prepare('PRAGMA integrity_check').get() as Record<string, unknown>;
      assert.equal(Object.values(row)[0], 'ok');
    } finally {
      db.close();
    }
  });
});
