export type { UserPrompt, UserPromptVersion, PromptStore } from './types.js';
export type { DirectoryEntryLike, PromptVaultFileSystem } from './fsPort.js';
export {
  FileSystemPromptStore,
  PROMPT_DIRECTORY,
  assertSafePromptId,
  createPromptVault,
} from './store.js';
export { detectFields, substituteFields } from './fields.js';
export { cascadePrompts } from './merge.js';
export {
  createUserPromptsPlugin,
  userPromptsManifest,
  userPromptsPlugin,
} from './plugin.js';
export type { UserPromptsPlugin } from './plugin.js';
export { userPromptsPlugin as default } from './plugin.js';