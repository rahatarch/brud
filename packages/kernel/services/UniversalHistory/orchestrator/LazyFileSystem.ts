import type { DirectoryEntry, FileStats } from '../../../drivers/contracts/index.js';
import type { IBrudFileSystem } from '../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';

/**
 * Defers resolution of a workspace filesystem until the first method call.
 *
 * The kernel only permits {@link IKernelAccessBroker.requestAccess} while it
 * is `RUNNING`, but service factories are invoked during `BOOTING`. Passing
 * this facade through the descriptor lets the history service construct its
 * collaborators eagerly while every filesystem operation resolves the
 * upstream service after boot.
 */
export class LazyFileSystem implements IBrudFileSystem {
  private readonly resolver: () => IBrudFileSystem;

  private resolved: IBrudFileSystem | undefined;

  constructor(resolver: () => IBrudFileSystem) {
    this.resolver = resolver;
  }

  /** Whether the underlying filesystem has been resolved. */
  get isResolved(): boolean {
    return this.resolved !== undefined;
  }

  readFile(relativePath: string): Promise<Uint8Array> {
    return this.target().readFile(relativePath);
  }

  readText(relativePath: string, encoding?: BufferEncoding): Promise<string> {
    return this.target().readText(relativePath, encoding);
  }

  writeAtomic(relativePath: string, data: Uint8Array | string): Promise<void> {
    return this.target().writeAtomic(relativePath, data);
  }

  createFile(
    relativePath: string,
    data: Uint8Array | string,
    options?: { overwrite?: boolean },
  ): Promise<void> {
    return this.target().createFile(relativePath, data, options);
  }

  deleteFile(relativePath: string): Promise<void> {
    return this.target().deleteFile(relativePath);
  }

  readDirectory(relativeDirectoryPath: string): Promise<readonly DirectoryEntry[]> {
    return this.target().readDirectory(relativeDirectoryPath);
  }

  stat(relativePath: string): Promise<FileStats | null> {
    return this.target().stat(relativePath);
  }

  exists(relativePath: string): Promise<boolean> {
    return this.target().exists(relativePath);
  }

  private target(): IBrudFileSystem {
    if (this.resolved === undefined) {
      this.resolved = this.resolver();
    }

    return this.resolved;
  }
}
