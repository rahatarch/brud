export interface DirectoryEntryLike {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

/**
 * Filesystem surface used by the personal prompt vault.
 *
 * `IBrudFileSystem` satisfies this contract structurally, but the vault does
 * not depend on the kernel package so it can be used by any host.
 */
export interface PromptVaultFileSystem {
  readText(relativePath: string): Promise<string>;
  writeAtomic(relativePath: string, data: Uint8Array | string): Promise<void>;
  deleteFile(relativePath: string): Promise<void>;
  exists(relativePath: string): Promise<boolean>;
  readDirectory(relativeDirectoryPath: string): Promise<readonly DirectoryEntryLike[]>;
}