import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { flagOn, type ParsedArgs } from '../../core/args.js';
import type { KernelPackage } from '../../composition/load.js';
import { CommandError } from '../../core/errors.js';
import type { Io } from '../../core/io.js';
import { loadPackage } from '../../core/project.js';
import { printData, type Style } from '../../core/report.js';
import { compositionText, findKernel, write, type KernelLoader } from './config.js';
import { runInitFinish } from './finish.js';
import { projectFiles } from './scaffold.js';
import { initTarget } from './target.js';

export const INIT_FLAGS = { boolean: ['kind', 'guest', 'no-install', 'finish'], value: ['lang'] } as const;

function installDependencies(dir: string): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });

    child.once('error', fail);
    child.once('exit', (code) => {
      if (code === 0) {
        done();
      } else {
        fail(new CommandError('INIT_INSTALL_FAILED', `npm install exited with ${String(code)}; your files are in place. Run \`npm install\` in ${dir}, then \`npx brud init --finish\` there to write brud.config.json`));
      }
    });
  });
}

const loadOwnKernel: KernelLoader = (dir) => loadPackage<KernelPackage['module']>('@brud/kernel', dir);

/**
 * `brud init [name]`: scaffolds a project that passes `brud doctor` and `npm test` on first run.
 * It writes only inside the target folder and refuses to overwrite anything that is already there.
 *
 * `brud.config.json` lists the kernel's services, so it is written once the project's kernel is
 * installed. With `--no-install` (no kernel yet) the project is created without it and init exits 0,
 * telling the user to run `npm install` and then `brud init --finish`, which writes only that file.
 */
export async function runInit(io: Io, style: Style, args: ParsedArgs, load: KernelLoader = loadOwnKernel): Promise<number> {
  if (flagOn(args, 'finish')) {
    return runInitFinish(io, style, args, load);
  }

  if (flagOn(args, 'guest')) {
    const { runInitGuest } = await import('./guest/index.js');

    return runInitGuest(io, style, args);
  }

  const { dir, name } = initTarget(io, args.positionals[0]);
  const kind = flagOn(args, 'kind');
  const files = projectFiles(name, kind);
  const existing = Object.keys({ ...files, 'brud.config.json': '' }).filter((file) => existsSync(join(dir, file)));

  if (existing.length > 0) {
    throw new CommandError('INIT_EXISTS', `refusing to overwrite: ${existing.join(', ')} already exist in ${dir}`);
  }

  await mkdir(dir, { recursive: true });

  for (const [file, text] of Object.entries(files)) {
    await write(dir, file, text);
  }

  if (!flagOn(args, 'no-install')) {
    await installDependencies(dir);
  }

  const installed = !flagOn(args, 'no-install');
  const kernel = await findKernel(load, dir);
  const where = relative(io.cwd, dir) || '.';
  const cd = where === '.' ? '' : `  cd ${where}\n`;

  if (kernel === undefined) {
    if (installed) {
      throw new CommandError('PACKAGE_NOT_FOUND', `npm install finished but @brud/kernel is not in ${where}. Check the project's package.json, run \`npm install\`, then \`npx brud init --finish\` there to write brud.config.json`);
    }

    // --no-install: the composition lists the kernel's services, so it can only be written once the kernel is installed.
    const pending = Object.keys(files).sort();

    printData(io, style, { dir, name, kind, files: pending, configWritten: false }, () => `Created ${name} in ${where}:\n${pending.map((file) => `  ${file}`).join('\n')}\n\nNot finished: brud.config.json lists the kernel's services, so it is written once the kernel is installed.\n\nNext:\n${cd}  npm install\n  npx brud init --finish\n  npm test\n`);

    return 0;
  }

  await write(dir, 'brud.config.json', compositionText(kernel, name));

  const created = [...Object.keys(files), 'brud.config.json'].sort();

  printData(io, style, { dir, name, kind, files: created, configWritten: true }, () => `Created ${name} in ${where}:\n${created.map((file) => `  ${file}`).join('\n')}\n\nNext:\n${cd}  npm test\n  npm run doctor\n  npm run check\n  npm start\n`);

  return 0;
}
