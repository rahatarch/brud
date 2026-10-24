import type { DirectoryEntry, FileStats, PathEntryStats } from './types.js';

export interface IStorageDriver {
  readFile(absolutePath: string): Promise<Uint8Array>;
  readText(absolutePath: string, encoding?: BufferEncoding): Promise<string>;
  writeFile(absolutePath: string, data: Uint8Array | string): Promise<void>;
  deleteFile(absolutePath: string): Promise<void>;
  rename(sourcePath: string, targetPath: string): Promise<void>;
  mkdir(absoluteDirectoryPath: string, options?: { recursive?: boolean }): Promise<void>;
  readDir(absoluteDirectoryPath: string): Promise<readonly DirectoryEntry[]>;
  stat(absolutePath: string): Promise<FileStats | null>;
  exists(absolutePath: string): Promise<boolean>;
  lstat(absolutePath: string): Promise<PathEntryStats | null>;
  realpath(absolutePath: string): Promise<string>;
}
