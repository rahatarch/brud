/**
 * Lightweight in-memory runtime for governor, performance, and scalability
 * tests. These tests measure plugin-level behaviour (limits, mutex, envelope)
 * and deliberately avoid kernel boot and disk I/O so the full suite stays
 * fast. Real-kernel behaviour is covered by `real-environment.test.ts`,
 * `security.test.ts`, and `legacy-parity.test.ts`.
 */
import type { OperationResult, SessionManifest } from '@brud/kernel';
import type { DirectoryEntry, FileStats } from '@brud/service-filesystem';
import type { IBrudFileSystem } from '@brud/service-filesystem';
import type { IUniversalHistoryService } from '@brud/service-history';
import { SHARED_MUTEX } from '../../coordinator/index.js';
import type { FilesystemRuntime } from '../../runtime.js';

function errno(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export class MemoryFileSystem {
  public readonly files = new Map<string, string>();

  public readonly writes: string[] = [];

  public async stat(path: string): Promise<FileStats | null> {
    const normalized = path.replace(/\/+$/u, '');

    if (this.files.has(normalized)) {
      return {
        size: Buffer.byteLength(this.files.get(normalized)!, 'utf8'),
        mtimeMs: 0,
        isFile: true,
        isDirectory: false,
      };
    }

    if ([...this.files.keys()].some((file) => file.startsWith(`${normalized}/`))) {
      return { size: 0, mtimeMs: 0, isFile: false, isDirectory: true };
    }

    return null;
  }

  public async readFile(path: string): Promise<Uint8Array> {
    if (!this.files.has(path)) {
      throw errno('ENOENT', `ENOENT: ${path}`);
    }

    return new TextEncoder().encode(this.files.get(path)!);
  }

  public async readText(path: string): Promise<string> {
    if (!this.files.has(path)) {
      throw errno('ENOENT', `ENOENT: ${path}`);
    }

    return this.files.get(path)!;
  }

  public async writeAtomic(path: string, data: Uint8Array | string): Promise<void> {
    this.writes.push(path);
    this.files.set(path, typeof data === 'string' ? data : Buffer.from(data).toString('utf8'));
  }

  public async createFile(
    path: string,
    data: Uint8Array | string,
    options?: { overwrite?: boolean },
  ): Promise<void> {
    if (this.files.has(path) && options?.overwrite !== true) {
      throw errno('EEXIST', `EEXIST: ${path}`);
    }

    await this.writeAtomic(path, data);
  }

  public async deleteFile(path: string): Promise<void> {
    if (!this.files.delete(path)) {
      throw errno('ENOENT', `ENOENT: ${path}`);
    }
  }

  public async rename(source: string, destination: string): Promise<void> {
    if (!this.files.has(source)) {
      throw errno('ENOENT', `ENOENT: ${source}`);
    }

    if (this.files.has(destination)) {
      throw errno('EEXIST', `EEXIST: ${destination}`);
    }

    this.files.set(destination, this.files.get(source)!);
    this.files.delete(source);
  }

  public async copy(source: string, destination: string): Promise<void> {
    if (!this.files.has(source)) {
      throw errno('ENOENT', `ENOENT: ${source}`);
    }

    if (this.files.has(destination)) {
      throw errno('EEXIST', `EEXIST: ${destination}`);
    }

    this.files.set(destination, this.files.get(source)!);
  }

  public async createDirectory(): Promise<void> {
    return;
  }

  public async deleteDirectory(path: string): Promise<void> {
    for (const file of [...this.files.keys()]) {
      if (file === path || file.startsWith(`${path}/`)) {
        this.files.delete(file);
      }
    }
  }

  public async readDirectory(path: string): Promise<readonly DirectoryEntry[]> {
    const prefix = path.length === 0 ? '' : `${path}/`;
    const entries = new Map<string, DirectoryEntry>();

    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) {
        continue;
      }

      const remainder = file.slice(prefix.length);
      const slash = remainder.indexOf('/');
      const name = slash === -1 ? remainder : remainder.slice(0, slash);
      const isDirectory = slash !== -1;

      const existing = entries.get(name);

      if (existing === undefined || (existing.isDirectory && !isDirectory)) {
        entries.set(name, { name, isFile: !isDirectory, isDirectory });
      }
    }

    return [...entries.values()];
  }

  public async exists(path: string): Promise<boolean> {
    return (await this.stat(path)) !== null;
  }
}

export class MemoryHistory {
  private sequence = 0;

  public readonly sessions: string[] = [];

  public async beginSession(
    _prompt: string,
    _targets?: readonly string[],
  ): Promise<string> {
    this.sequence += 1;
    const id = `BR-20260101-${String(this.sequence).padStart(3, '0')}`;
    this.sessions.push(id);

    return id;
  }

  public async commitSession(): Promise<void> {
    return;
  }

  public async getSession(sessionId: string): Promise<SessionManifest | null> {
    if (!this.sessions.includes(sessionId)) {
      return null;
    }

    return {
      schemaVersion: 1,
      sessionId,
      createdAt: '1970-01-01T00:00:00.000Z',
      prompt: 'memory session',
      status: 'active',
      filesAffected: [],
      preDigests: {},
      postDigests: {},
    };
  }
}

export function createMemoryRuntime(options?: {
  readonly fs?: MemoryFileSystem;
  readonly history?: MemoryHistory;
  readonly executeTool?: (name: string, input: unknown) => Promise<OperationResult>;
}): {
  readonly fs: MemoryFileSystem;
  readonly history: MemoryHistory;
  readonly runtime: FilesystemRuntime;
} {
  const fs = options?.fs ?? new MemoryFileSystem();
  const history = options?.history ?? new MemoryHistory();
  const runtime: FilesystemRuntime = {
    getFileSystem: () => fs as unknown as IBrudFileSystem,
    getUniversalHistory: () => history as unknown as IUniversalHistoryService,
    executeTool: options?.executeTool ?? (async () => ({
      status: 'success',
      data: { results: [] },
    })),
    mutex: SHARED_MUTEX,
    workspaceRoot: '/workspace',
  };

  return { fs, history, runtime };
}