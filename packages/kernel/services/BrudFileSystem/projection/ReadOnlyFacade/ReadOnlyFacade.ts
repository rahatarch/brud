import type { DirectoryEntry, FileStats } from '../../../../drivers/contracts/index.js';
import type { IBrudFileSystem } from '../../contracts/IBrudFileSystem/IBrudFileSystem.js';

export class ReadOnlyViolationError extends Error {
  public readonly code = 'READ_ONLY_VIOLATION' as const;

  public readonly operation: string;

  constructor(operation: string) {
    super(`Operation "${operation}" is not permitted on a read-only filesystem projection`);
    this.name = 'ReadOnlyViolationError';
    this.operation = operation;
  }
}

export type ReadOnlyBrudFileSystem = Pick<
  IBrudFileSystem,
  'readFile' | 'readText' | 'readDirectory' | 'stat' | 'exists'
>;

export class ReadOnlyFacade implements IBrudFileSystem {
  private readonly service: IBrudFileSystem;

  constructor(service: IBrudFileSystem) {
    this.service = service;
  }

  async readFile(relativePath: string): Promise<Uint8Array> {
    return this.service.readFile(relativePath);
  }

  async readText(relativePath: string, encoding?: BufferEncoding): Promise<string> {
    return this.service.readText(relativePath, encoding);
  }

  async writeAtomic(_relativePath: string, _data: Uint8Array | string): Promise<void> {
    throw new ReadOnlyViolationError('writeAtomic');
  }

  async createFile(
    _relativePath: string,
    _data: Uint8Array | string,
    _options?: { overwrite?: boolean },
  ): Promise<void> {
    throw new ReadOnlyViolationError('createFile');
  }

  async deleteFile(_relativePath: string): Promise<void> {
    throw new ReadOnlyViolationError('deleteFile');
  }

  async readDirectory(relativeDirectoryPath: string): Promise<readonly DirectoryEntry[]> {
    return this.service.readDirectory(relativeDirectoryPath);
  }

  async stat(relativePath: string): Promise<FileStats | null> {
    return this.service.stat(relativePath);
  }

  async exists(relativePath: string): Promise<boolean> {
    return this.service.exists(relativePath);
  }
}
