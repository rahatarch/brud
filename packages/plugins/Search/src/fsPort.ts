export interface DirectoryEntryLike {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

export interface FileStatsLike {
  size: number;
}

/** Read-only filesystem surface required by file search. */
export interface SearchFileSystem {
  readDirectory(relativeDirectoryPath: string): Promise<readonly DirectoryEntryLike[]>;
  stat(relativePath: string): Promise<FileStatsLike | null>;
}