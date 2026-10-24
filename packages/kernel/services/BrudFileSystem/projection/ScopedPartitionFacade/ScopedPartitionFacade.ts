import type { DirectoryEntry, FileStats } from '../../../../drivers/contracts/index.js';
import type { IBrudFileSystem } from '../../contracts/IBrudFileSystem/IBrudFileSystem.js';
import {
  PathTraversalViolationError,
  assertSafeRelativePath,
  defaultPathFlavor,
} from '../../validation/PathValidator/PathValidator.js';
import type { PathFlavor } from '../../validation/PathValidator/PathValidator.js';

export interface ScopedPartitionFacadeOptions {
  readonly flavor?: PathFlavor;
}

function normalizePartitionPrefix(prefix: string, flavor: PathFlavor): string {
  const safePrefix = assertSafeRelativePath(prefix, flavor);
  const segments = safePrefix
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0 && segment !== '.');

  if (segments.length === 0) {
    throw new PathTraversalViolationError({
      rule: 'TRAVERSAL',
      root: '',
      candidatePath: prefix,
      reason: 'partition prefix must not resolve to the workspace root',
    });
  }

  return segments.join('/');
}

export class ScopedPartitionFacade implements IBrudFileSystem {
  private readonly service: IBrudFileSystem;

  private readonly scopePrefix: string;

  private readonly pathFlavor: PathFlavor;

  constructor(
    service: IBrudFileSystem,
    partitionPrefix: string,
    options?: ScopedPartitionFacadeOptions,
  ) {
    this.service = service;
    this.pathFlavor = options?.flavor ?? defaultPathFlavor();
    this.scopePrefix = normalizePartitionPrefix(partitionPrefix, this.pathFlavor);
  }

  get partitionPrefix(): string {
    return this.scopePrefix;
  }

  async readFile(relativePath: string): Promise<Uint8Array> {
    return this.service.readFile(this.toScopedPath(relativePath));
  }

  async readText(relativePath: string, encoding?: BufferEncoding): Promise<string> {
    return this.service.readText(this.toScopedPath(relativePath), encoding);
  }

  async writeAtomic(relativePath: string, data: Uint8Array | string): Promise<void> {
    await this.service.writeAtomic(this.toScopedPath(relativePath), data);
  }

  async createFile(
    relativePath: string,
    data: Uint8Array | string,
    options?: { overwrite?: boolean },
  ): Promise<void> {
    await this.service.createFile(this.toScopedPath(relativePath), data, options);
  }

  async deleteFile(relativePath: string): Promise<void> {
    await this.service.deleteFile(this.toScopedPath(relativePath));
  }

  async readDirectory(relativeDirectoryPath: string): Promise<readonly DirectoryEntry[]> {
    return this.service.readDirectory(this.toScopedPath(relativeDirectoryPath));
  }

  async stat(relativePath: string): Promise<FileStats | null> {
    return this.service.stat(this.toScopedPath(relativePath));
  }

  async exists(relativePath: string): Promise<boolean> {
    return this.service.exists(this.toScopedPath(relativePath));
  }

  private toScopedPath(relativePath: string): string {
    const safePath = assertSafeRelativePath(relativePath, this.pathFlavor);

    if (safePath === '' || safePath === '.') {
      return this.scopePrefix;
    }

    return `${this.scopePrefix}/${safePath}`;
  }
}
