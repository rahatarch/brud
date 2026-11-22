import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { hardcoreModulePaths, type KernelPackage } from '../../composition/load.js';
import { CommandError } from '../../core/errors.js';
import { participantPath } from './scaffold.js';

/** How `init` finds the kernel a project uses. Replaceable so tests can simulate a project with no kernel. */
export type KernelLoader = (dir: string) => Promise<KernelPackage>;

/** Writes one new file inside the project, creating folders; refuses to replace an existing file. */
export async function write(dir: string, file: string, text: string): Promise<void> {
  const path = join(dir, file);

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, { encoding: 'utf8', flag: 'wx' });
}

/**
 * The kernel the project at `dir` uses, or undefined when none is installed there.
 * Any other failure (a kernel that is present but will not load) is a real error and propagates.
 */
export async function findKernel(load: KernelLoader, dir: string): Promise<KernelPackage | undefined> {
  try {
    return await load(dir);
  } catch (error) {
    if (error instanceof CommandError && error.code === 'PACKAGE_NOT_FOUND') {
      return undefined;
    }

    throw error;
  }
}

/**
 * The text of `brud.config.json`: the installed kernel's hardcore services, in order, then the
 * project's own participant. The list belongs to the kernel version the project installs, so it is
 * read from that kernel and never baked into the CLI.
 *
 * @throws {CommandError} `INIT_NO_HARDCORE` when the kernel ships no hardcore modules, because a
 * composition without them would be silently broken.
 */
export function compositionText(kernel: KernelPackage, name: string): string {
  const hardcore = hardcoreModulePaths(kernel.root);

  if (hardcore.length === 0) {
    throw new CommandError('INIT_NO_HARDCORE', `the kernel at ${kernel.root} ships no hardcore service modules (dist/serviceModules is missing or empty); reinstall @brud/kernel and try again`);
  }

  const services = [...hardcore.map((path) => ({ path, official: true })), { path: `./${participantPath(name)}`, official: true }];

  return `${JSON.stringify({ services }, null, 2)}\n`;
}
