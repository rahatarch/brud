import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  IActionExecutionContext,
  IActionManager,
  IBrudToolsService,
  IPluginExecutionContext,
  IPluginHistoryService,
  OperationResult,
} from '@brud/kernel';
import { createStandardKernel } from '../../../../../kernel/src/bootstrap/index.js';
import type { BrudKernel } from '../../../../../kernel/src/engine/BrudKernel.js';
import { ActionManagerToken } from '../../../../../kernel/services/ActionManager/descriptor/tokens.js';
import { ACTION_MANAGER_DAEMON_CALLER_ID } from '../../../../../kernel/services/ActionManager/contracts/IActionManager.js';
import { BrudToolsToken } from '../../../../../kernel/services/BrudTools/descriptor/tokens.js';
import { UniversalHistoryToken } from '../../../../../kernel/services/UniversalHistory/descriptor/tokens.js';
import { createHistoryPlugin } from '../../plugin.js';

export const HISTORY_PLUGIN_ID = 'akkhar-labs.plugin.history';

export interface SeededSession {
  readonly sessionId: string;
  readonly entryId: string;
  readonly target: string;
}

export interface HistoryHarness {
  readonly kernel: BrudKernel;
  readonly root: string;
  readonly tools: IBrudToolsService;
  readonly actions: IActionManager;
  readonly history: IPluginHistoryService;
  readonly toolContext: IPluginExecutionContext;
  readonly actionContext: IActionExecutionContext;
  seed(target: string, content: string, prompt?: string): Promise<SeededSession>;
  shutdown(): Promise<void>;
}

export async function bootHistoryHarness(): Promise<HistoryHarness> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'brud-history-plugin-')));
  const kernel = createStandardKernel({
    history: { inMemory: true },
    certifyInitialPlugins: true,
    initialPlugins: [createHistoryPlugin()],
  });

  await kernel.boot({ options: { workspaceRoot: root } });

  const coreCaller = {
    callerId: 'test.history.plugin',
    tier: 'core' as const,
    workspaceRoot: root,
  };
  const actionCaller = {
    callerId: ACTION_MANAGER_DAEMON_CALLER_ID,
    tier: 'core' as const,
    workspaceRoot: root,
  };

  let tools: IBrudToolsService;
  let actions: IActionManager;
  let history: IPluginHistoryService;

  try {
    tools = kernel.requestAccess(coreCaller, BrudToolsToken);
    actions = kernel.requestAccess(actionCaller, ActionManagerToken);
    history = kernel.requestAccess(
      coreCaller,
      UniversalHistoryToken,
    ) as IPluginHistoryService;
  } catch (error: unknown) {
    await kernel.shutdown();
    await rm(root, { recursive: true, force: true });
    throw error;
  }

  const seed = async (
    target: string,
    content: string,
    prompt = 'history plugin probe',
  ): Promise<SeededSession> => {
    const sessionId = await history.beginSession(prompt, [target]);

    await writeFile(join(root, target), content);
    await history.commitSession(sessionId, 'completed');

    const view = history.getSessionView(sessionId);
    const entryId = view?.targets[0]?.entryId;

    if (entryId === undefined) {
      throw new Error(`Seeded session "${sessionId}" recorded no target entry`);
    }

    return { sessionId, entryId, target };
  };

  return {
    kernel,
    root,
    tools,
    actions,
    history,
    toolContext: {
      workspaceRoot: root,
      callerId: 'test.history.plugin',
    },
    actionContext: {
      workspaceRoot: root,
      callerId: 'c_ui',
      origin: 'daemon-rpc',
    },
    seed,
    shutdown: async (): Promise<void> => {
      try {
        await kernel.shutdown();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  };
}

export function resultError(result: OperationResult): string {
  if (typeof result.error === 'string') {
    return result.error;
  }

  return result.message ?? '';
}