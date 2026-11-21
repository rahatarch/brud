import { basename, resolve } from 'node:path';
import { UsageError } from '../../core/args.js';
import type { Io } from '../../core/io.js';

const NAME = /^[a-z][a-z0-9-]*$/u;

/**
 * The project folder and participant name `brud init [name]` means. A name the
 * user typed must already be valid; a name taken from the current folder is
 * tidied (lower-case, hyphens) because the user did not choose it.
 */
export function initTarget(io: Io, requested: string | undefined): { readonly dir: string; readonly name: string } {
  const dir = requested === undefined ? io.cwd : resolve(io.cwd, requested);
  const raw = basename(dir);
  const name = requested === undefined ? raw.toLowerCase().replace(/[^a-z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '') : raw;

  if (!NAME.test(name)) {
    throw new UsageError(`"${raw}" cannot be a participant name; use lower-case letters, digits and hyphens, starting with a letter (for example \`brud init my-app\`)`);
  }

  return { dir, name };
}
