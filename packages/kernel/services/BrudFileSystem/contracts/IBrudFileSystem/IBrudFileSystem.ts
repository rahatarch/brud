import type { DirectoryEntry, FileStats } from '../../../../drivers/contracts/index.js';

export interface IBrudFileSystem {
  readFile(relativePath: string): Promise<Uint8Array>;

  readText(relativePath: string, encoding?: BufferEncoding): Promise<string>;

  writeAtomic(relativePath: string, data: Uint8Array | string): Promise<void>;

  createFile(
    relativePath: string,
    data: Uint8Array | string,
    options?: { overwrite?: boolean },
  ): Promise<void>;

  deleteFile(relativePath: string): Promise<void>;

  readDirectory(relativeDirectoryPath: string): Promise<readonly DirectoryEntry[]>;

  stat(relativePath: string): Promise<FileStats | null>;

  exists(relativePath: string): Promise<boolean>;
}
