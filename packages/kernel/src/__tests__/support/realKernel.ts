import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { createStandardKernel } from '../../bootstrap/index.js';
import type { BrudKernel } from '../../engine/BrudKernel.js';
import type { IBrudPlugin } from '../../../../services/PluginManager/contracts/IBrudPlugin.js';
import { workspaceContextOptions } from './workspaceContext.js';

/** A booted kernel plus the real workspace and database it owns. */
export interface RealKernel {
  readonly kernel: BrudKernel;
  readonly root: string;
  readonly dbPath: string;
}

/**
 * Boots the standard kernel against a fresh real workspace.
 *
 * The workspace is a real temporary directory, the storage driver is the
 * default durable node driver, and history is a real SQLite file. Cleanup is
 * registered on the test context so every test tears down its own kernel.
 *
 * @param context - Node test context used to register cleanup.
 * @param options - Workspace prefix and optional initial plugins.
 */
export async function bootRealKernel(
  context: TestContext,
  options: { readonly prefix: string; readonly initialPlugins?: readonly IBrudPlugin[] },
): Promise<RealKernel> {
  const root = await mkdtemp(join(tmpdir(), options.prefix));
  const dbPath = join(root, '.brud', 'history', 'universal.db');
  const kernel = createStandardKernel({
    history: { dbPath },
    ...(options.initialPlugins === undefined ? {} : { initialPlugins: options.initialPlugins }),
  });

  await kernel.boot({ options: workspaceContextOptions(root) });

  context.after(async () => {
    await kernel.shutdown().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  return { kernel, root, dbPath };
}
