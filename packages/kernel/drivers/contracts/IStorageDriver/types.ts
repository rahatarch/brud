export interface FileStats {
  size: number;
  mtimeMs: number;
  isFile: boolean;
  isDirectory: boolean;
}

export interface DirectoryEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

export interface PathEntryStats {
  isSymbolicLink: boolean;

  /** Modification time in milliseconds, when the driver can report it. */
  mtimeMs?: number;
}
