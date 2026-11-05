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