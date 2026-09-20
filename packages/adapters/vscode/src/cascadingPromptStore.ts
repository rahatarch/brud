import type { PromptStore, UserPrompt } from '@brud/core';
import { cascadePrompts } from '@brud/core';

export class CascadingPromptStore implements PromptStore {
  constructor(
    private globalStore: PromptStore,
    private workspaceStore: PromptStore,
  ) {}

  async list(): Promise<UserPrompt[]> {
    const [global, workspace] = await Promise.all([
      this.globalStore.list(),
      this.workspaceStore.list(),
    ]);
    return cascadePrompts(global, workspace);
  }

  async get(id: string): Promise<UserPrompt | null> {
    const workspace = await this.workspaceStore.get(id);
    if (workspace) return workspace;
    return this.globalStore.get(id);
  }

  async save(prompt: UserPrompt): Promise<void> {
    if (prompt.scope === 'workspace') {
      await this.workspaceStore.save(prompt);
    } else {
      await this.globalStore.save(prompt);
    }
  }

  async delete(id: string): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return;
    if (existing.scope === 'workspace') {
      await this.workspaceStore.delete(id);
    } else {
      await this.globalStore.delete(id);
    }
  }
}