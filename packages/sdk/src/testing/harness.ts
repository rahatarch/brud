import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { bootKernel, provisionIdentityRegistryStorage, type BrudKernel } from '@brud/kernel';

/**
 * The kernel's hardcore service modules. Kept here until the kernel exports
 * its hardcore set (plan decision S-3).
 */
const HARDCORE_MODULES = ['identityRegistry', 'exposedApiRegistry', 'parser', 'router', 'wasmCage', 'events', 'interception']
  .map((name) => `kernel:serviceModules/${name}.js`);

/** One participant in a test composition: a module path, or a module source to write. */
export interface TestEntry {
  /** Absolute path of a service module. */
  readonly path?: string;
  /** Full source of an ES module exporting `createService` (written to a temp file). */
  readonly source?: string;
  /** Composition officialness (W-01). */
  readonly official?: boolean;
}

/** Teardown registration, as `node:test`'s `t.after`. */
export interface TestTeardown {
  after(fn: () => Promise<void> | void): void;
}

/**
 * Boots the real kernel with its hardcores plus `entries`, in order — the way
 * a product boots. Shuts down and cleans up through `t.after`.
 *
 * @param t - The test context.
 * @param entries - Participants, in composition order.
 * @param options - Extra composition options.
 * @returns The running kernel.
 */
export async function bootTestKernel(
  t: TestTeardown,
  entries: readonly TestEntry[],
  options: Readonly<Record<string, unknown>> = {},
): Promise<BrudKernel> {
  const root = await mkdtemp(join(tmpdir(), 'brud-sdk-'));
  let kernel: BrudKernel | undefined;

  t.after(async () => {
    if (kernel?.lifecycleState === 'RUNNING') {
      await kernel.shutdown();
    }

    await rm(root, { recursive: true, force: true });
  });

  const services: { path: string; official?: boolean }[] = HARDCORE_MODULES.map((path) => ({ path, official: true }));

  for (const [index, entry] of entries.entries()) {
    let path = entry.path;

    if (entry.source !== undefined) {
      path = join(root, `participant-${String(index)}.mjs`);
      await writeFile(path, entry.source, 'utf8');
    }

    if (path === undefined || !isAbsolute(path)) {
      throw new TypeError(`test entry ${String(index)} needs an absolute path or a source`);
    }

    services.push(entry.official === undefined ? { path } : { path, official: entry.official });
  }

  const identityPath = join(root, 'identity.json');
  const configPath = join(root, 'brud.config.json');

  await writeFile(configPath, JSON.stringify({ services }), 'utf8');
  provisionIdentityRegistryStorage(identityPath);
  kernel = await bootKernel(configPath, {
    options: { 'identity.registry.path': identityPath, 'router.root': root, ...options },
  });

  return kernel;
}
