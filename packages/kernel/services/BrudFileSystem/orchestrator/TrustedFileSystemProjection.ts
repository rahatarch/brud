import type { DirectoryEntry, FileStats } from '../../../drivers/contracts/index.js';
import type { IBrudFileSystem } from '../contracts/IBrudFileSystem/IBrudFileSystem.js';
import type { BrudFileSystem } from './BrudFileSystem.js';

/**
 * Filesystem projection that carries an explicit protected-write capability.
 *
 * Only projections minted by {@link BrudFileSystem.createTrustedProjection}
 * reach this class, and the descriptor mints them only for the owning core
 * service (the history subsystem). Reads are delegated unchanged.
 */
export class TrustedFileSystemProjection implements IBrudFileSystem {
  constructor(
    private readonly service: BrudFileSystem,
    private readonly scopes: readonly string[],
  ) {}

  readFile(relativePath: string): Promise<Uint8Array> {
    return this.service.readFile(relativePath);
  }

  readText(relativePath: string, encoding?: BufferEncoding): Promise<string> {
    return this.service.readText(relativePath, encoding);
  }

  writeAtomic(relativePath: string, data: Uint8Array | string): Promise<void> {
    return this.service.writeAtomicWithinScopes(relativePath, data, this.scopes);
  }

  createFile(
    relativePath: string,
    data: Uint8Array | string,
    options?: { overwrite?: boolean },
  ): Promise<void> {
    return this.service.createFileWithinScopes(relativePath, data, options, this.scopes);
  }

  deleteFile(relativePath: string): Promise<void> {
    return this.service.deleteFileWithinScopes(relativePath, this.scopes);
  }

  readDirectory(relativeDirectoryPath: string): Promise<readonly DirectoryEntry[]> {
    return this.service.readDirectory(relativeDirectoryPath);
  }

  stat(relativePath: string): Promise<FileStats | null> {
    return this.service.stat(relativePath);
  }

  exists(relativePath: string): Promise<boolean> {
    return this.service.exists(relativePath);
  }
}
