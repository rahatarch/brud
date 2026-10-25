export interface FileStats {
  size: number;
  mtimeMs: number;
  isFile: boolean;
  isDirectory: boolean;

  /**
   * Permission bits (`0o777` mask) when the driver can report them.
   *
   * Used by staged writes to preserve an executable target's mode across an
   * atomic replacement. Drivers without a permission model simply omit it.
   */
  mode?: number;
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
