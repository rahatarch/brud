import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStandardKernel } from '../../bootstrap/index.js';
import type { ServiceContext } from '../../contracts/lifecycle.js';
import { DurableNodeStorageDriver } from '../../../services/BrudFileSystem/drivers/DurableNodeStorageDriver.js';
import { FileSystemToken } from '../../../services/BrudFileSystem/descriptor/tokens.js';
import type { IBrudPlugin } from '../../../services/PluginManager/contracts/IBrudPlugin.js';
import { PluginManagerToken } from '../../../services/PluginManager/contracts/tokens.js';
import { WorkspaceViolationError } from '../../../services/WorkspaceService/contracts/errors.js';
import { safeRm } from '../support/cleanup.js';
import { workspaceContextOptions } from '../support/workspaceContext.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGINS_ROOT = resolve(HERE, '../../../../plugins');
const USER_PROMPTS_ID = 'akkhar-labs.plugin.user-prompts';

interface UserPromptVersionLike {
  version: number;
  content: string;
  timestamp: string;
}

interface UserPromptLike {
  id: string;
  title: string;
  description: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  currentVersion: number;
  scope: 'global' | 'workspace';
  versions: UserPromptVersionLike[];
}

interface PromptStoreLike {
  save(prompt: UserPromptLike): Promise<void>;
  get(id: string): Promise<UserPromptLike | null>;
}

interface UserPromptsPluginLike extends IBrudPlugin {
  getStore(): PromptStoreLike | undefined;
}

interface UserPromptsModule {
  createUserPromptsPlugin(): UserPromptsPluginLike;
}

async function loadUserPromptsModule(): Promise<UserPromptsModule> {
  const entry = pathToFileURL(join(PLUGINS_ROOT, 'UserPrompts', 'src', 'index.ts')).href;

  return await import(entry) as UserPromptsModule;
}

function samplePrompt(id = 'my-prompt'): UserPromptLike {
  return {
    id,
    title: 'Review prompt',
    description: 'Used by the path-isolation invariant.',
    tags: ['review', 'verification'],
    createdAt: '2026-11-05T00:00:00.000Z',
    updatedAt: '2026-11-05T00:00:00.000Z',
    currentVersion: 1,
    scope: 'workspace',
    versions: [
      {
        version: 1,
        content: 'Review ${[file]} for correctness.',
        timestamp: '2026-11-05T00:00:00.000Z',
      },
    ],
  };
}

describe('UserPrompts path isolation invariant', () => {
  it('round-trips prompts through real disk and rejects every escape outside .brud/prompts', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'brud-leaf-userprompts-')));
    const kernel = createStandardKernel({
      storageDriver: new DurableNodeStorageDriver(),
      history: { dbPath: join(root, '.brud', 'history', 'universal.db') },
    });

    try {
      await kernel.boot({ options: {...workspaceContextOptions(root)} });

      const caller: ServiceContext = {
        callerId: 'test.userprompts-path-isolation',
        tier: 'core',
        options: {...workspaceContextOptions(root)},
      };
      const manager = kernel.requestAccess(caller, PluginManagerToken);
      const fileSystem = kernel.requestAccess(caller, FileSystemToken);

      const module = await loadUserPromptsModule();
      const plugin = module.createUserPromptsPlugin();
      manager.register(plugin);
      await manager.activateAll();

      assert.equal(manager.getPlugin(USER_PROMPTS_ID)?.state, 'active');
      const store = plugin.getStore();
      assert.ok(store !== undefined, 'the activated plugin must expose its vault');

      const prompt = samplePrompt();
      await store.save(prompt);

      const promptDirectory = join(root, '.brud', 'prompts');
      const promptFile = join(promptDirectory, 'my-prompt.json');

      assert.equal(existsSync(promptFile), true, 'the prompt must exist on real disk');

      const rawContent = await readFile(promptFile, 'utf8');
      assert.deepEqual(JSON.parse(rawContent), prompt);

      const roundTripped = await store.get('my-prompt');
      assert.deepEqual(roundTripped, prompt, 'reading the prompt back must equal what was saved');

      assert.deepEqual(await readdir(promptDirectory), ['my-prompt.json']);

      const escapedTarget = resolve(root, '../../../etc/passwd.json');

      await assert.rejects(
        () => fileSystem.writeAtomic('../../../etc/passwd.json', '{"escaped":true}\n'),
        (error: unknown) => {
          assert.ok(
            error instanceof WorkspaceViolationError,
            `expected WorkspaceViolationError, received ${String(error)}`,
          );
          assert.equal(error.code, 'WORKSPACE_PATH_VIOLATION');
          return true;
        },
        'the kernel must reject a workspace-escaping write with WORKSPACE_PATH_VIOLATION',
      );

      assert.equal(existsSync(escapedTarget), false, 'no traversal write may land outside the workspace');

      await assert.rejects(
        () => store.save(samplePrompt('../../../etc/passwd')),
        /Invalid prompt id/u,
        'the vault must reject a traversal prompt id before it reaches the kernel',
      );
      assert.equal(existsSync(escapedTarget), false);

      assert.deepEqual(
        await readdir(promptDirectory),
        ['my-prompt.json'],
        'the vault must not create any file outside its own directory',
      );
    } finally {
      try {
        await kernel.shutdown();
      } finally {
        await safeRm(root);
      }
    }
  });
});
