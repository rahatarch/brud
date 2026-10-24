import { open, readFile, unlink } from 'node:fs/promises';
import type { DaemonEndpoint } from './endpoint.js';

const LOCK_FILE_MODE = 0o600;
const MAX_ACQUIRE_ATTEMPTS = 3;

export interface DaemonLockMetadata {
  readonly pid: number;
  readonly version: string;
}

export interface DaemonLockRecord {
  readonly pid: number;
  readonly startedAt: number;
  readonly version: string;
  readonly workspaceRoot: string;
}

export interface LockHandle {
  readonly endpoint: DaemonEndpoint;
  readonly lockPath: string;
  readonly record: DaemonLockRecord;
  release(): Promise<void>;
}

export class LockContentionError extends Error {
  readonly existingPid: number | undefined;

  readonly lockPath: string;

  constructor(lockPath: string, existingPid: number | undefined, message?: string) {
    super(message ?? `Daemon lock at "${lockPath}" is held by running pid ${existingPid ?? 'unknown'}`);
    this.name = 'LockContentionError';
    this.existingPid = existingPid;
    this.lockPath = lockPath;
  }
}

export class LockAcquisitionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LockAcquisitionError';
  }
}

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  const code = error.code;
  return typeof code === 'string' ? code : undefined;
}

function asLockRecord(value: unknown): DaemonLockRecord | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  if (!('pid' in value) || !('startedAt' in value) || !('version' in value) || !('workspaceRoot' in value)) {
    return undefined;
  }

  const { pid, startedAt, version, workspaceRoot } = value;

  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return undefined;
  }

  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) {
    return undefined;
  }

  if (typeof version !== 'string' || typeof workspaceRoot !== 'string') {
    return undefined;
  }

  return { pid, startedAt, version, workspaceRoot };
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return readErrorCode(error) === 'EPERM';
  }
}

async function readLockRecord(lockPath: string): Promise<DaemonLockRecord | undefined> {
  let content: string;

  try {
    content = await readFile(lockPath, 'utf8');
  } catch (error: unknown) {
    if (readErrorCode(error) === 'ENOENT') {
      return undefined;
    }

    throw error;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    throw new LockContentionError(
      lockPath,
      undefined,
      `Daemon lock at "${lockPath}" is unreadable`,
    );
  }

  const record = asLockRecord(parsed);

  if (record === undefined) {
    throw new LockContentionError(
      lockPath,
      undefined,
      `Daemon lock at "${lockPath}" is malformed`,
    );
  }

  return record;
}

export async function releaseDaemonLock(endpoint: DaemonEndpoint): Promise<void> {
  await unlink(endpoint.lockPath).catch((error: unknown) => {
    if (readErrorCode(error) !== 'ENOENT') {
      throw error;
    }
  });
}

async function reclaimStaleLock(endpoint: DaemonEndpoint): Promise<void> {
  await unlink(endpoint.lockPath).catch((error: unknown) => {
    if (readErrorCode(error) !== 'ENOENT') {
      throw error;
    }
  });

  if (!endpoint.isWindows) {
    await unlink(endpoint.socketPath).catch((error: unknown) => {
      if (readErrorCode(error) !== 'ENOENT') {
        throw error;
      }
    });
  }
}

async function writeLockRecord(lockPath: string, record: DaemonLockRecord): Promise<void> {
  const handle = await open(lockPath, 'wx', LOCK_FILE_MODE);

  try {
    await handle.writeFile(JSON.stringify(record), 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function acquireDaemonLock(
  endpoint: DaemonEndpoint,
  metadata: DaemonLockMetadata,
): Promise<LockHandle> {
  const record: DaemonLockRecord = {
    pid: metadata.pid,
    startedAt: Date.now(),
    version: metadata.version,
    workspaceRoot: endpoint.workspaceRoot,
  };

  for (let attempt = 1; attempt <= MAX_ACQUIRE_ATTEMPTS; attempt += 1) {
    try {
      await writeLockRecord(endpoint.lockPath, record);
    } catch (error: unknown) {
      if (readErrorCode(error) !== 'EEXIST') {
        throw new LockAcquisitionError(
          `Failed to create daemon lock at "${endpoint.lockPath}"`,
          { cause: error },
        );
      }

      const existing = await readLockRecord(endpoint.lockPath);

      if (existing === undefined) {
        continue;
      }

      if (isPidAlive(existing.pid)) {
        throw new LockContentionError(endpoint.lockPath, existing.pid);
      }

      await reclaimStaleLock(endpoint);
      continue;
    }

    return {
      endpoint,
      lockPath: endpoint.lockPath,
      record,
      release: (): Promise<void> => releaseDaemonLock(endpoint),
    };
  }

  throw new LockAcquisitionError(
    `Failed to acquire daemon lock at "${endpoint.lockPath}" after ${MAX_ACQUIRE_ATTEMPTS} attempts`,
  );
}
