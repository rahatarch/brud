import * as fs from 'fs/promises';
import * as pathModule from 'path';
import { FileSystem } from '../types/filesystem.js';

export class NodeFileSystem implements FileSystem {
  async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf8');
  }
  async writeFile(filePath: string, content: string): Promise<void> {
    await fs.mkdir(pathModule.dirname(filePath), { recursive: true });
    return fs.writeFile(filePath, content, 'utf8');
  }
  async deleteFile(filePath: string): Promise<void> {
    return fs.unlink(filePath);
  }
  async renameFile(from: string, to: string): Promise<void> {
    await fs.mkdir(pathModule.dirname(to), { recursive: true });
    return fs.rename(from, to);
  }
  async copyFile(from: string, to: string): Promise<void> {
    await fs.mkdir(pathModule.dirname(to), { recursive: true });
    return fs.copyFile(from, to);
  }
  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
  async createDirectory(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }
  async deleteDirectoryRecursive(dirPath: string): Promise<void> {
    return fs.rm(dirPath, { recursive: true, force: true });
  }
  async moveDirectory(from: string, to: string): Promise<void> {
    await fs.mkdir(pathModule.dirname(to), { recursive: true });
    return fs.rename(from, to);
  }
  async listDirectory(dirPath: string): Promise<string[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.map(e => e.name);
  }
  async listDirectoryContents(dirPath: string): Promise<{ name: string; isDirectory: boolean }[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.map(e => ({ name: e.name, isDirectory: e.isDirectory() }));
  }
}