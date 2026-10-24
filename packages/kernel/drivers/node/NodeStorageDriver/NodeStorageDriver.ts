import { lstat, mkdir, readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import type {
  DirectoryEntry,
  FileStats,
  IStorageDriver,
  PathEntryStats,
} from '../../contracts/index.js';

function isErrnoException(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

export class NodeStorageDriver implements IStorageDriver {
  async readFile(absolutePath: string): Promise<Uint8Array> {
    return readFile(absolutePath);
  }

  async readText(absolutePath: string, encoding?: BufferEncoding): Promise<string> {
    return readFile(absolutePath, encoding ?? 'utf8');
  }

  async writeFile(absolutePath: string, data: Uint8Array | string): Promise<void> {
    if (typeof data === 'string') {
      await writeFile(absolutePath, data, 'utf8');
      return;
    }
    await writeFile(absolutePath, data);
  }

  async deleteFile(absolutePath: string): Promise<void> {
    await unlink(absolutePath);
  }

  async rename(sourcePath: string, targetPath: string): Promise<void> {
    await rename(sourcePath, targetPath);
  }

  async mkdir(absoluteDirectoryPath: string, options?: { recursive?: boolean }): Promise<void> {
    await mkdir(absoluteDirectoryPath, { recursive: options?.recursive ?? false });
  }

  async readDir(absoluteDirectoryPath: string): Promise<readonly DirectoryEntry[]> {
    const entries = await readdir(absoluteDirectoryPath, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isFile: entry.isFile(),
      isDirectory: entry.isDirectory(),
    }));
  }

  async stat(absolutePath: string): Promise<FileStats | null> {
    try {
      const stats = await stat(absolutePath);
      return {
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
      };
    } catch (error: unknown) {
      if (isErrnoException(error, 'ENOENT')) {
        return null;
      }
      throw error;
    }
  }

  async exists(absolutePath: string): Promise<boolean> {
    return (await this.stat(absolutePath)) !== null;
  }

  async lstat(absolutePath: string): Promise<PathEntryStats | null> {
    try {
      const stats = await lstat(absolutePath);
      return { isSymbolicLink: stats.isSymbolicLink() };
    } catch (error: unknown) {
      if (isErrnoException(error, 'ENOENT') || isErrnoException(error, 'ENOTDIR')) {
        return null;
      }
      throw error;
    }
  }

  async realpath(absolutePath: string): Promise<string> {
    return realpath(absolutePath);
  }
}
