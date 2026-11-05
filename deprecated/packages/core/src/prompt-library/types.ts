export interface BrudPrompt {
  id: string;
  title: string;
  description: string;
  content: string;
}

export interface PromptLibrary {
  name: string;
  version: string;
  prompts: BrudPrompt[];
}