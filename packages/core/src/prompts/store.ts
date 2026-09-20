import type { UserPrompt } from './types';

export interface PromptStore {
  list(): Promise<UserPrompt[]>;
  get(id: string): Promise<UserPrompt | null>;
  save(prompt: UserPrompt): Promise<void>;
  delete(id: string): Promise<void>;
}