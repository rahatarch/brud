export interface UserPromptVersion {
  version: number;
  content: string;
  timestamp: string;
  message?: string;
}

export interface UserPrompt {
  id: string;
  title: string;
  description: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  currentVersion: number;
  scope: 'global' | 'workspace';
  versions: UserPromptVersion[];
}

export interface PromptStore {
  list(): Promise<UserPrompt[]>;
  get(id: string): Promise<UserPrompt | null>;
  save(prompt: UserPrompt): Promise<void>;
  delete(id: string): Promise<void>;
}