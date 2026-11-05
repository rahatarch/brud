import type { UserPrompt } from './types';

export function cascadePrompts(global: UserPrompt[], workspace: UserPrompt[]): UserPrompt[] {
  const map = new Map<string, UserPrompt>();
  for (const p of global) map.set(p.id, p);
  for (const p of workspace) map.set(p.id, p);
  return Array.from(map.values());
}