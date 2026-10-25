import type { DirectoryEntry, FileStats, PathEntryStats } from './types.js';

export interface IStorageDriver {
  readFile(absolutePath: string): Promise<Uint8Array>;
  readText(absolutePath: string, encoding?: BufferEncoding): Promise<string>;
  writeFile(absolutePath: string, data: Uint8Array | string): Promise<void>;

  /**
   * Creates a new file without following an existing entry.
   *
   * Implementations must use an exclusive-create primitive
   * (`O_CREAT | O_EXCL | O_WRONLY` or equivalent) so an existing file or
   * symlink at `absolutePath` fails with `EEXIST` instead of being followed
   * or overwritten. Optional so non-POSIX drivers can degrade safely.
   */
  writeFileExclusive?(
    absolutePath: string,
    data: Uint8Array | string,
    options?: { readonly mode?: number },
  ): Promise<void>;

  /**
   * Creates a hard link at `newPath` naming the existing `existingPath`.
   *
   * Used to publish a fully staged file only when the destination does not
   * exist yet; an existing destination fails with `EEXIST` atomically.
   */
  link?(existingPath: string, newPath: string): Promise<void>;

  /** Changes permission bits (`0o777` mask) when the driver supports modes. */
  chmod?(absolutePath: string, mode: number): Promise<void>;

  deleteFile(absolutePath: string): Promise<void>;
  rename(sourcePath: string, targetPath: string): Promise<void>;
  mkdir(absoluteDirectoryPath: string, options?: { recursive?: boolean }): Promise<void>;
  readDir(absoluteDirectoryPath: string): Promise<readonly DirectoryEntry[]>;
  stat(absolutePath: string): Promise<FileStats | null>;
  exists(absolutePath: string): Promise<boolean>;
  lstat(absolutePath: string): Promise<PathEntryStats | null>;
  realpath(absolutePath: string): Promise<string>;
}
