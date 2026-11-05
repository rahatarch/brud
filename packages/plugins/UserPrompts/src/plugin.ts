import type { IBrudPlugin, IPluginContext, PluginManifest } from '@brud/kernel';
import type { PromptStore } from './types.js';
import { createPromptVault } from './store.js';
import { PROMPT_DIRECTORY } from './store.js';

/** Declarative plugin metadata. */
export const userPromptsManifest: PluginManifest = {
  id: 'akkhar-labs.plugin.user-prompts',
  name: 'User Prompts',
  version: '0.0.1',
  description: 'Personal prompt vault stored under .brud/prompts; isolated from system prompts and BrudTools.',
  permissions: ['fs:read', 'fs:write'],
};

/**
 * Plugin surface that exposes the activated vault to the host UI.
 *
 * The vault is the only entry point: this plugin registers no tools, so
 * prompt management can never reach BrudTools.
 */
export interface UserPromptsPlugin extends IBrudPlugin {
  /** Returns the active vault, or `undefined` before activation. */
  getStore(): PromptStore | undefined;
}

/**
 * Builds a fresh UserPrompts plugin instance.
 *
 * The vault binds to the capability-scoped filesystem supplied during
 * activation and is released on deactivation.
 */
export function createUserPromptsPlugin(): UserPromptsPlugin {
  let store: PromptStore | undefined;

  return {
    manifest: userPromptsManifest,
    activate(context: IPluginContext): void {
      store = createPromptVault(context.getFileSystem(), PROMPT_DIRECTORY);
      context.logger.info('User prompt vault ready', { directory: PROMPT_DIRECTORY });
    },
    deactivate(): void {
      store = undefined;
    },
    getStore(): PromptStore | undefined {
      return store;
    },
  };
}

/** Shared UserPrompts plugin instance. */
export const userPromptsPlugin: UserPromptsPlugin = createUserPromptsPlugin();

export default userPromptsPlugin;