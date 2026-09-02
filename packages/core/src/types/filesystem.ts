export interface FileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  renameFile(from: string, to: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  createDirectory(path: string): Promise<void>;
  deleteDirectoryRecursive(path: string): Promise<void>;
  moveDirectory(from: string, to: string): Promise<void>;
  listDirectory(path: string): Promise<string[]>;
}