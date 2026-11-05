/**
 * Cross-process lock for the seven Filesystem cross-cutting test files.
 *
 * Node's test runner executes files in parallel processes. The Filesystem
 * cross tests boot real kernels and perform real file I/O; running all seven
 * at once starves timing-sensitive tests in other packages. Serializing them
 * keeps this plugin's peak load at one process while preserving the required
 * file layout.
 */
import { open, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOCK_PATH = join(tmpdir(), 'brud-filesystem-cross-tests.lock');
const WAIT_MS = 50;
const TIMEOUT_MS = 120_000;
const STALE_MS = 120_000;

interface LockRecord {
  pid?: number;
  at?: number;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: string }).code
    : undefined;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

async function readRecord(): Promise<LockRecord | undefined> {
  try {
    return JSON.parse(await readFile(LOCK_PATH, 'utf8')) as LockRecord;
  } catch {
    return undefined;
  }
}

/** Acquires the cross-test lock, waiting for a live holder to finish. */
export async function acquireCrossTestLock(): Promise<void> {
  const started = Date.now();

  for (;;) {
    try {
      const handle = await open(LOCK_PATH, 'wx');

      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }));
      } finally {
        await handle.close();
      }

      return;
    } catch (error: unknown) {
      if (errorCode(error) !== 'EEXIST') {
        throw error;
      }
    }

    const record = await readRecord();
    const stale = record === undefined
      || record.pid === undefined
      || !processAlive(record.pid)
      || Date.now() - (record.at ?? 0) > STALE_MS;

    if (stale) {
      await unlink(LOCK_PATH).catch(() => undefined);
    }

    if (Date.now() - started > TIMEOUT_MS) {
      throw new Error('Timed out waiting for the Filesystem cross-test lock.');
    }

    await new Promise<void>((resolve) => setTimeout(resolve, WAIT_MS));
  }
}

/** Releases the lock only when this process owns it. */
export async function releaseCrossTestLock(): Promise<void> {
  const record = await readRecord();

  if (record?.pid === process.pid) {
    await unlink(LOCK_PATH).catch(() => undefined);
  }
}