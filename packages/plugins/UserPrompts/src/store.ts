import type { PromptVaultFileSystem } from './fsPort.js';
import type { PromptStore, UserPrompt } from './types.js';

/** Workspace-relative directory that holds the personal prompt vault. */
export const PROMPT_DIRECTORY = '.brud/prompts';

const PROMPT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Rejects identifiers that could escape the prompt directory.
 *
 * @param id - Caller-supplied prompt identifier.
 * @throws {Error} When the identifier is not a safe single path segment.
 */
export function assertSafePromptId(id: string): void {
  if (!PROMPT_ID_PATTERN.test(id) || id === '.' || id === '..') {
    throw new Error(`Invalid prompt id: ${JSON.stringify(id)}`);
  }
}

/**
 * Personal prompt vault backed by a workspace filesystem.
 *
 * Files are written under `.brud/prompts/<id>.json` through the kernel's
 * atomic write path. The vault never touches system prompts or BrudTools.
 */
export class FileSystemPromptStore implements PromptStore {
  constructor(
    private readonly fileSystem: PromptVaultFileSystem,
    private readonly directory: string = PROMPT_DIRECTORY,
  ) {}

  /** Absolute-to-workspace directory the vault owns. */
  get directoryPath(): string {
    return this.directory;
  }

  async list(): Promise<UserPrompt[]> {
    if (!(await this.fileSystem.exists(this.directory))) {
      return [];
    }

    let entries;
    try {
      entries = await this.fileSystem.readDirectory(this.directory);
    } catch {
      return [];
    }

    const results: UserPrompt[] = [];
    for (const entry of entries) {
      if (entry.isDirectory || !entry.name.endsWith('.json')) {
        continue;
      }

      try {
        const content = await this.fileSystem.readText(this.join(entry.name));
        const parsed: unknown = JSON.parse(content);
        if (isUserPrompt(parsed)) {
          results.push(parsed);
        }
      } catch {
        // A malformed prompt file must not hide the rest of the vault.
      }
    }

    return results;
  }

  async get(id: string): Promise<UserPrompt | null> {
    assertSafePromptId(id);
    const filePath = this.filePath(id);

    if (!(await this.fileSystem.exists(filePath))) {
      return null;
    }

    try {
      const content = await this.fileSystem.readText(filePath);
      const parsed: unknown = JSON.parse(content);
      return isUserPrompt(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async save(prompt: UserPrompt): Promise<void> {
    assertSafePromptId(prompt.id);
    await this.fileSystem.writeAtomic(
      this.filePath(prompt.id),
      JSON.stringify(prompt, null, 2),
    );
  }

  async delete(id: string): Promise<void> {
    assertSafePromptId(id);
    const filePath = this.filePath(id);

    if (!(await this.fileSystem.exists(filePath))) {
      return;
    }

    await this.fileSystem.deleteFile(filePath);
  }

  private filePath(id: string): string {
    return this.join(`${id}.json`);
  }

  private join(entryName: string): string {
    return this.directory.length === 0 ? entryName : `${this.directory}/${entryName}`;
  }
}

/**
 * Creates a prompt vault over the supplied filesystem.
 *
 * @param fileSystem - Workspace-scoped filesystem port.
 * @param directory - Optional override of {@link PROMPT_DIRECTORY}.
 */
export function createPromptVault(
  fileSystem: PromptVaultFileSystem,
  directory: string = PROMPT_DIRECTORY,
): FileSystemPromptStore {
  return new FileSystemPromptStore(fileSystem, directory);
}

function isUserPrompt(value: unknown): value is UserPrompt {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<UserPrompt>;
  return typeof candidate.id === 'string'
    && typeof candidate.title === 'string'
    && Array.isArray(candidate.versions);
}