import * as path from 'path';
import { VSCodeFileSystem } from './filesystem';
import type { PromptStore, UserPrompt, UserPromptVersion } from '@brud/core';

export class VSCodePromptStore implements PromptStore {
  constructor(
    private storageDir: string,
    private fileSystem: VSCodeFileSystem,
  ) {}

  async list(): Promise<UserPrompt[]> {
    const exists = await this.fileSystem.exists(this.storageDir);
    if (!exists) {
      return [];
    }

    const entries = await this.fileSystem.listDirectoryContents(this.storageDir);
    const jsonFiles = entries.filter(e => !e.isDirectory && e.name.endsWith('.json'));

    const results: UserPrompt[] = [];
    for (const entry of jsonFiles) {
      try {
        const filePath = path.join(this.storageDir, entry.name);
        const content = await this.fileSystem.readFile(filePath);
        const parsed = JSON.parse(content) as UserPrompt;
        if (parsed.id && parsed.title && Array.isArray(parsed.versions)) {
          results.push(parsed);
        } else {
          console.warn(`[VSCodePromptStore] Malformed prompt file: ${entry.name}`);
        }
      } catch {
        console.warn(`[VSCodePromptStore] Failed to read prompt file: ${entry.name}`);
      }
    }

    return results;
  }

  async get(id: string): Promise<UserPrompt | null> {
    const filePath = this._filePath(id);
    const exists = await this.fileSystem.exists(filePath);
    if (!exists) {
      return null;
    }

    try {
      const content = await this.fileSystem.readFile(filePath);
      return JSON.parse(content) as UserPrompt;
    } catch {
      return null;
    }
  }

  async save(prompt: UserPrompt): Promise<void> {
    const dirExists = await this.fileSystem.exists(this.storageDir);
    if (!dirExists) {
      await this.fileSystem.createDirectory(this.storageDir);
    }

    const filePath = this._filePath(prompt.id);
    const tempPath = filePath + '.tmp';

    await this.fileSystem.writeFile(tempPath, JSON.stringify(prompt, null, 2));
    await this.fileSystem.renameFile(tempPath, filePath);
  }

  async delete(id: string): Promise<void> {
    const filePath = this._filePath(id);
    const exists = await this.fileSystem.exists(filePath);
    if (!exists) {
      return;
    }

    await this.fileSystem.deleteFile(filePath);
  }

  private _filePath(id: string): string {
    return path.join(this.storageDir, `${id}.json`);
  }
}