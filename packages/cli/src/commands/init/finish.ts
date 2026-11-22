import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { UsageError, flagOn, type ParsedArgs } from '../../core/args.js';
import { CommandError } from '../../core/errors.js';
import type { Io } from '../../core/io.js';
import { printData, type Style } from '../../core/report.js';
import { compositionText, findKernel, write, type KernelLoader } from './config.js';
import { participantPath } from './scaffold.js';
import { initTarget } from './target.js';

/**
 * `brud init --finish [dir]`: completes a project that `brud init` could not finish (it was made
 * with `--no-install`, or `npm install` failed) by writing only `brud.config.json`, once the
 * project has a kernel. It touches no other file and never replaces an existing config.
 */
export async function runInitFinish(io: Io, style: Style, args: ParsedArgs, load: KernelLoader): Promise<number> {
  if (flagOn(args, 'guest') || flagOn(args, 'kind') || flagOn(args, 'no-install')) {
    throw new UsageError('`brud init --finish` takes only a folder; the other init flags apply to creating a project');
  }

  const { dir, name } = initTarget(io, args.positionals[0]);
  const relativeDir = relative(io.cwd, dir);
  const where = relativeDir === '' ? 'this folder' : relativeDir;

  if (!existsSync(join(dir, 'package.json')) || !existsSync(join(dir, participantPath(name)))) {
    throw new CommandError('INIT_NOT_A_PROJECT', `${where} is not a project made by \`brud init\` (no package.json, or no ${participantPath(name)}); \`--finish\` only completes one`);
  }

  if (existsSync(join(dir, 'brud.config.json'))) {
    throw new CommandError('INIT_EXISTS', `brud.config.json already exists in ${where}; nothing to finish`);
  }

  const kernel = await findKernel(load, dir);

  if (kernel === undefined) {
    throw new CommandError('PACKAGE_NOT_FOUND', `@brud/kernel is not installed in ${where}. Run \`npm install\` there, then \`npx brud init --finish\` again`);
  }

  await write(dir, 'brud.config.json', compositionText(kernel, name));

  printData(io, style, { dir, name, file: 'brud.config.json' }, () => `Wrote brud.config.json in ${where}.\n\nNext:\n${relativeDir === '' ? '' : `  cd ${relativeDir}\n`}  npm test\n  npm run doctor\n  npm run check\n`);

  return 0;
}
