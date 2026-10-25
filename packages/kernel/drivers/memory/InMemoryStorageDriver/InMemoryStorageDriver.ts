import { Buffer } from 'node:buffer';
import type {
  DirectoryEntry,
  FileStats,
  IStorageDriver,
  PathEntryStats,
} from '../../contracts/index.js';

interface MemoryFile {
  data: Uint8Array;
  mtimeMs: number;
  mode: number;
}

const ROOT = '/';

export class StorageError extends Error {
  readonly code: string;
  readonly syscall: string;
  readonly path: string;

  constructor(code: string, syscall: string, path: string) {
    super(`${code}: ${syscall} '${path}'`);
    this.name = 'StorageError';
    this.code = code;
    this.syscall = syscall;
    this.path = path;
  }
}

function normalizePath(input: string): string {
  const collapsed = input.replace(/\/+/g, '/');
  if (!collapsed.startsWith(ROOT)) {
    throw new StorageError('EINVAL', 'open', input);
  }
  if (collapsed.length > 1 && collapsed.endsWith(ROOT)) {
    return collapsed.slice(0, -1);
  }
  return collapsed;
}

function parentPath(path: string): string {
  if (path === ROOT) {
    return ROOT;
  }
  const separatorIndex = path.lastIndexOf(ROOT);
  return separatorIndex <= 0 ? ROOT : path.slice(0, separatorIndex);
}

function entryName(path: string): string {
  return path.slice(path.lastIndexOf(ROOT) + 1);
}

function copyBytes(data: Uint8Array): Uint8Array {
  return Uint8Array.from(data);
}

export class InMemoryStorageDriver implements IStorageDriver {
  private readonly files = new Map<string, MemoryFile>();
  private readonly directories = new Map<string, number>();

  constructor() {
    this.directories.set(ROOT, Date.now());
  }

  async readFile(absolutePath: string): Promise<Uint8Array> {
    const path = normalizePath(absolutePath);
    const file = this.files.get(path);
    if (file === undefined) {
      if (this.directories.has(path)) {
        throw new StorageError('EISDIR', 'read', path);
      }
      throw new StorageError('ENOENT', 'read', path);
    }
    return copyBytes(file.data);
  }

  async readText(absolutePath: string, encoding?: BufferEncoding): Promise<string> {
    const data = await this.readFile(absolutePath);
    return Buffer.from(data).toString(encoding ?? 'utf8');
  }

  async writeFile(absolutePath: string, data: Uint8Array | string): Promise<void> {
    const path = normalizePath(absolutePath);
    const parent = parentPath(path);
    if (this.files.has(parent)) {
      throw new StorageError('ENOTDIR', 'write', path);
    }
    if (!this.directories.has(parent)) {
      throw new StorageError('ENOENT', 'write', path);
    }
    if (this.directories.has(path)) {
      throw new StorageError('EISDIR', 'write', path);
    }
    const bytes = typeof data === 'string' ? Uint8Array.from(Buffer.from(data, 'utf8')) : copyBytes(data);
    const existing = this.files.get(path);
    this.files.set(path, {
      data: bytes,
      mtimeMs: Date.now(),
      mode: existing?.mode ?? 0o644,
    });
  }

  async writeFileExclusive(
    absolutePath: string,
    data: Uint8Array | string,
    options?: { readonly mode?: number },
  ): Promise<void> {
    const path = normalizePath(absolutePath);
    const parent = parentPath(path);

    if (this.files.has(parent)) {
      throw new StorageError('ENOTDIR', 'open', path);
    }
    if (!this.directories.has(parent)) {
      throw new StorageError('ENOENT', 'open', path);
    }
    if (this.files.has(path) || this.directories.has(path)) {
      throw new StorageError('EEXIST', 'open', path);
    }

    const bytes = typeof data === 'string' ? Uint8Array.from(Buffer.from(data, 'utf8')) : copyBytes(data);
    this.files.set(path, {
      data: bytes,
      mtimeMs: Date.now(),
      mode: options?.mode ?? 0o644,
    });
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    const source = normalizePath(existingPath);
    const target = normalizePath(newPath);

    if (this.files.has(target) || this.directories.has(target)) {
      throw new StorageError('EEXIST', 'link', target);
    }

    const sourceFile = this.files.get(source);
    if (sourceFile === undefined) {
      throw new StorageError('ENOENT', 'link', source);
    }

    const targetParent = parentPath(target);
    if (!this.directories.has(targetParent) || this.files.has(targetParent)) {
      throw new StorageError('ENOENT', 'link', target);
    }

    this.files.set(target, sourceFile);
  }

  async chmod(absolutePath: string, mode: number): Promise<void> {
    const path = normalizePath(absolutePath);
    const file = this.files.get(path);
    if (file === undefined) {
      throw new StorageError('ENOENT', 'chmod', path);
    }
    file.mode = mode & 0o777;
  }

  async deleteFile(absolutePath: string): Promise<void> {
    const path = normalizePath(absolutePath);
    if (this.directories.has(path)) {
      throw new StorageError('EISDIR', 'unlink', path);
    }
    if (!this.files.delete(path)) {
      throw new StorageError('ENOENT', 'unlink', path);
    }
  }

  async rename(sourcePath: string, targetPath: string): Promise<void> {
    const source = normalizePath(sourcePath);
    const target = normalizePath(targetPath);
    if (source === target) {
      return;
    }
    if (source === ROOT || target.startsWith(`${source}/`)) {
      throw new StorageError('EINVAL', 'rename', source);
    }

    const sourceFile = this.files.get(source);
    const sourceIsDirectory = this.directories.has(source);
    if (sourceFile === undefined && !sourceIsDirectory) {
      throw new StorageError('ENOENT', 'rename', source);
    }

    const targetParent = parentPath(target);
    if (this.files.has(targetParent)) {
      throw new StorageError('ENOTDIR', 'rename', target);
    }
    if (!this.directories.has(targetParent)) {
      throw new StorageError('ENOENT', 'rename', target);
    }

    if (sourceFile !== undefined) {
      if (this.directories.has(target)) {
        throw new StorageError('EISDIR', 'rename', target);
      }
      this.files.delete(source);
      this.files.set(target, sourceFile);
      return;
    }

    if (this.files.has(target)) {
      throw new StorageError('ENOTDIR', 'rename', target);
    }

    const movedFiles: Array<[string, MemoryFile]> = [];
    for (const [path, file] of this.files) {
      if (path.startsWith(`${source}/`)) {
        movedFiles.push([path, file]);
      }
    }
    const movedDirectories: Array<[string, number]> = [];
    for (const [path, mtimeMs] of this.directories) {
      if (path === source || path.startsWith(`${source}/`)) {
        movedDirectories.push([path, mtimeMs]);
      }
    }

    for (const [path] of movedFiles) {
      this.files.delete(path);
    }
    for (const [path] of movedDirectories) {
      this.directories.delete(path);
    }
    this.removeSubtree(target);

    for (const [path, file] of movedFiles) {
      this.files.set(`${target}${path.slice(source.length)}`, file);
    }
    for (const [path, mtimeMs] of movedDirectories) {
      this.directories.set(`${target}${path.slice(source.length)}`, mtimeMs);
    }
  }

  async mkdir(absoluteDirectoryPath: string, options?: { recursive?: boolean }): Promise<void> {
    const path = normalizePath(absoluteDirectoryPath);
    const recursive = options?.recursive ?? false;

    if (this.files.has(path)) {
      throw new StorageError('EEXIST', 'mkdir', path);
    }
    if (this.directories.has(path)) {
      if (recursive) {
        return;
      }
      throw new StorageError('EEXIST', 'mkdir', path);
    }

    if (recursive) {
      const segments = path.split(ROOT).filter((segment) => segment.length > 0);
      let current = '';
      for (const segment of segments) {
        current += `${ROOT}${segment}`;
        if (this.files.has(current)) {
          throw new StorageError('ENOTDIR', 'mkdir', path);
        }
        if (!this.directories.has(current)) {
          this.directories.set(current, Date.now());
        }
      }
      return;
    }

    const parent = parentPath(path);
    if (this.files.has(parent)) {
      throw new StorageError('ENOTDIR', 'mkdir', path);
    }
    if (!this.directories.has(parent)) {
      throw new StorageError('ENOENT', 'mkdir', path);
    }
    this.directories.set(path, Date.now());
  }

  async readDir(absoluteDirectoryPath: string): Promise<readonly DirectoryEntry[]> {
    const path = normalizePath(absoluteDirectoryPath);
    if (this.files.has(path)) {
      throw new StorageError('ENOTDIR', 'scandir', path);
    }
    if (!this.directories.has(path)) {
      throw new StorageError('ENOENT', 'scandir', path);
    }

    const entries: DirectoryEntry[] = [];
    for (const filePath of this.files.keys()) {
      if (parentPath(filePath) === path) {
        entries.push({ name: entryName(filePath), isFile: true, isDirectory: false });
      }
    }
    for (const directoryPath of this.directories.keys()) {
      if (directoryPath !== path && parentPath(directoryPath) === path) {
        entries.push({ name: entryName(directoryPath), isFile: false, isDirectory: true });
      }
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    return entries;
  }

  async stat(absolutePath: string): Promise<FileStats | null> {
    const path = normalizePath(absolutePath);
    const file = this.files.get(path);
    if (file !== undefined) {
      return {
        size: file.data.byteLength,
        mtimeMs: file.mtimeMs,
        isFile: true,
        isDirectory: false,
        mode: file.mode,
      };
    }
    const directoryMtime = this.directories.get(path);
    if (directoryMtime !== undefined) {
      return {
        size: 0,
        mtimeMs: directoryMtime,
        isFile: false,
        isDirectory: true,
        mode: 0o755,
      };
    }
    return null;
  }

  async exists(absolutePath: string): Promise<boolean> {
    const path = normalizePath(absolutePath);
    return this.files.has(path) || this.directories.has(path);
  }

  async lstat(absolutePath: string): Promise<PathEntryStats | null> {
    const path = normalizePath(absolutePath);
    if (!this.files.has(path) && !this.directories.has(path)) {
      return null;
    }
    return { isSymbolicLink: false };
  }

  async realpath(absolutePath: string): Promise<string> {
    return normalizePath(absolutePath);
  }

  private removeSubtree(path: string): void {
    this.files.delete(path);
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(`${path}/`)) {
        this.files.delete(filePath);
      }
    }
    for (const directoryPath of this.directories.keys()) {
      if (directoryPath === path || directoryPath.startsWith(`${path}/`)) {
        this.directories.delete(directoryPath);
      }
    }
  }
}
