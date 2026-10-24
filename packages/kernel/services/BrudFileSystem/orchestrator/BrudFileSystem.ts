import type { DirectoryEntry, FileStats } from '../../../drivers/contracts/index.js';
import type { IStorageDriver } from '../../../drivers/contracts/index.js';
import type { IServiceLifecycle } from '../../../src/contracts/lifecycle.js';
import { KeyedWriteMutex } from '../concurrency/KeyedWriteMutex/KeyedWriteMutex.js';
import type { IBrudFileSystem } from '../contracts/IBrudFileSystem/IBrudFileSystem.js';
import { createFile as createFileOperation } from '../operations/create_file/createFile.js';
import { deleteFile as deleteFileOperation } from '../operations/delete_file/deleteFile.js';
import { readFile as readFileOperation, readText as readTextOperation } from '../operations/read_file/readFile.js';
import { readDirectory as readDirectoryOperation } from '../operations/read_directory/readDirectory.js';
import { statPath as statPathOperation } from '../operations/stat_path/statPath.js';
import { writeAtomic as writeAtomicOperation } from '../operations/write_atomic/writeAtomic.js';
import { PathValidator } from '../validation/PathValidator/PathValidator.js';
import type { PathFlavor } from '../validation/PathValidator/PathValidator.js';

export interface BrudFileSystemOptions {
  readonly flavor?: PathFlavor;
}

export class BrudFileSystem implements IBrudFileSystem, IServiceLifecycle {
  private readonly driver: IStorageDriver;

  private readonly validator: PathValidator;

  private readonly writeMutex = new KeyedWriteMutex();

  constructor(workspaceRoot: string, driver: IStorageDriver, options?: BrudFileSystemOptions) {
    this.driver = driver;
    this.validator = new PathValidator(workspaceRoot, { flavor: options?.flavor });
  }

  get workspaceRoot(): string {
    return this.validator.root;
  }

  async initialize(): Promise<void> {
    await this.driver.mkdir(this.validator.root, { recursive: true });
  }

  async dispose(): Promise<void> {
    this.writeMutex.clear();
  }

  async readFile(relativePath: string): Promise<Uint8Array> {
    const absolutePath = await this.validator.resolveContained(relativePath, this.driver);
    return readFileOperation(this.driver, absolutePath);
  }

  async readText(relativePath: string, encoding?: BufferEncoding): Promise<string> {
    const absolutePath = await this.validator.resolveContained(relativePath, this.driver);
    return readTextOperation(this.driver, absolutePath, encoding);
  }

  async writeAtomic(relativePath: string, data: Uint8Array | string): Promise<void> {
    const absolutePath = await this.validator.resolveContained(relativePath, this.driver);
    await this.writeMutex.runExclusive(
      absolutePath,
      () => writeAtomicOperation(this.driver, absolutePath, data),
    );
  }

  async createFile(
    relativePath: string,
    data: Uint8Array | string,
    options?: { overwrite?: boolean },
  ): Promise<void> {
    const absolutePath = await this.validator.resolveContained(relativePath, this.driver);
    await this.writeMutex.runExclusive(
      absolutePath,
      () => createFileOperation(this.driver, absolutePath, data, options),
    );
  }

  async deleteFile(relativePath: string): Promise<void> {
    const absolutePath = await this.validator.resolveContained(relativePath, this.driver);
    await this.writeMutex.runExclusive(
      absolutePath,
      () => deleteFileOperation(this.driver, absolutePath),
    );
  }

  async readDirectory(relativeDirectoryPath: string): Promise<readonly DirectoryEntry[]> {
    const absolutePath = await this.validator.resolveContained(relativeDirectoryPath, this.driver);
    return readDirectoryOperation(this.driver, absolutePath);
  }

  async stat(relativePath: string): Promise<FileStats | null> {
    const absolutePath = await this.validator.resolveContained(relativePath, this.driver);
    return statPathOperation(this.driver, absolutePath);
  }

  async exists(relativePath: string): Promise<boolean> {
    const absolutePath = await this.validator.resolveContained(relativePath, this.driver);
    return this.driver.exists(absolutePath);
  }
}
