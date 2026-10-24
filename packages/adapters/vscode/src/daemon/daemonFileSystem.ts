import { Buffer } from 'node:buffer';
import type { FileSystem } from '@brud/core';
import type { DaemonExecutionClient } from './daemonClientTypes';
import { resolveClientWorkspaceRoot } from './daemonClientTypes';
import { toWorkspaceRelativePath } from './daemonPaths';

export class DaemonUnsupportedFileSystemOperationError extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super(`The daemon filesystem does not support "${operation}"`);
    this.name = 'DaemonUnsupportedFileSystemOperationError';
    this.operation = operation;
  }
}

export interface DaemonFileSystemOptions {
  readonly workspaceRoot: string;
  readonly fallback?: FileSystem;
}

export class DaemonFileSystem implements FileSystem {
  private readonly client: DaemonExecutionClient;

  private readonly workspaceRoot: string;

  private readonly fallback: FileSystem | undefined;

  constructor(client: DaemonExecutionClient, options: DaemonFileSystemOptions) {
    this.client = client;
    this.workspaceRoot = resolveClientWorkspaceRoot(client, options.workspaceRoot);
    this.fallback = options.fallback;
  }

  async readFile(path: string): Promise<string> {
    return this.client.fsReadFile(this.toRelative(path), 'utf8');
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    const encoded = await this.client.fsReadFile(this.toRelative(path), 'base64');
    return new Uint8Array(Buffer.from(encoded, 'base64'));
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.client.fsWriteAtomic(this.toRelative(path), content, 'utf8');
  }

  async deleteFile(path: string): Promise<void> {
    if (this.fallback !== undefined) {
      await this.fallback.deleteFile(path);
      return;
    }

    throw new DaemonUnsupportedFileSystemOperationError('deleteFile');
  }

  async renameFile(from: string, to: string): Promise<void> {
    if (this.fallback !== undefined) {
      await this.fallback.renameFile(from, to);
      return;
    }

    throw new DaemonUnsupportedFileSystemOperationError('renameFile');
  }

  async copyFile(from: string, to: string): Promise<void> {
    if (this.fallback !== undefined) {
      await this.fallback.copyFile(from, to);
      return;
    }

    throw new DaemonUnsupportedFileSystemOperationError('copyFile');
  }

  async exists(path: string): Promise<boolean> {
    return this.client.fsExists(this.toRelative(path));
  }

  async stat(path: string): Promise<{ size: number; isDirectory: boolean }> {
    const stat = await this.client.fsStat(this.toRelative(path));

    if (stat === null) {
      throw new Error(`Cannot stat missing path "${path}"`);
    }

    return { size: stat.size, isDirectory: stat.isDirectory };
  }

  async createDirectory(path: string): Promise<void> {
    if (this.fallback !== undefined) {
      await this.fallback.createDirectory(path);
    }
  }

  async deleteDirectoryRecursive(path: string): Promise<void> {
    if (this.fallback !== undefined) {
      await this.fallback.deleteDirectoryRecursive(path);
      return;
    }

    throw new DaemonUnsupportedFileSystemOperationError('deleteDirectoryRecursive');
  }

  async moveDirectory(from: string, to: string): Promise<void> {
    if (this.fallback !== undefined) {
      await this.fallback.moveDirectory(from, to);
      return;
    }

    throw new DaemonUnsupportedFileSystemOperationError('moveDirectory');
  }

  async listDirectory(path: string): Promise<string[]> {
    const entries = await this.client.fsList(this.toRelative(path));
    return entries.map((entry) => entry.name);
  }

  async listDirectoryContents(
    path: string,
  ): Promise<{ name: string; isDirectory: boolean }[]> {
    const entries = await this.client.fsList(this.toRelative(path));
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory,
    }));
  }

  private toRelative(path: string): string {
    return toWorkspaceRelativePath(this.workspaceRoot, path);
  }
}
