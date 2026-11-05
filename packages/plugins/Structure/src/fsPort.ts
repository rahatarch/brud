export interface DirectoryEntryLike {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

/** Read-only filesystem surface required by structure extraction. */
export interface StructureFileSystem {
  readText(relativePath: string): Promise<string>;
  readDirectory(relativeDirectoryPath: string): Promise<readonly DirectoryEntryLike[]>;
}