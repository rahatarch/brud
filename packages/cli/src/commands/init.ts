import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { flagOn, type ParsedArgs } from '../args.js';
import { hardcoreModulePaths, type KernelPackage } from '../composition.js';
import { CommandError } from '../errors.js';
import type { Io } from '../io.js';
import { loadPackage } from '../project.js';
import { printData, type Style } from '../report.js';
import { participantPath, projectFiles } from './scaffold.js';
import { initTarget } from './target.js';

export const INIT_FLAGS = { boolean: ['kind', 'guest', 'no-install'] } as const;

function installDependencies(dir: string): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });

    child.once('error', fail);
    child.once('exit', (code) => {
      if (code === 0) {
        done();
      } else {
        fail(new CommandError('INIT_INSTALL_FAILED', `npm install exited with ${String(code)}; your files are in place, run \`npm install\` yourself`));
      }
    });
  });
}

async function write(dir: string, file: string, text: string): Promise<void> {
  const path = join(dir, file);

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, { encoding: 'utf8', flag: 'wx' });
}

/**
 * `brud init [name]`: scaffolds a project that passes `brud doctor` and
 * `npm test` on first run. It writes only inside the target folder and
 * refuses to overwrite anything that is already there.
 */
export async function runInit(io: Io, style: Style, args: ParsedArgs): Promise<number> {
  if (flagOn(args, 'guest')) {
    const { runInitGuest } = await import('./initGuest.js');

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

  let kernel: KernelPackage;

  try {
    kernel = await loadPackage('@brud/kernel', dir);
  } catch {
    throw new CommandError('PACKAGE_NOT_FOUND', `files written, but @brud/kernel is not installed in ${dir}, so the composition could not list its hardcore services. Run \`npm install\` there, then \`brud init\` again in a new folder, or write brud.config.json from the docs`);
  }

  const services = [...hardcoreModulePaths(kernel.root).map((path) => ({ path, official: true })), { path: `./${participantPath(name)}`, official: true }];

  await write(dir, 'brud.config.json', `${JSON.stringify({ services }, null, 2)}\n`);

  const created = [...Object.keys(files), 'brud.config.json'].sort();
  const where = relative(io.cwd, dir) || '.';

  printData(io, style, { dir, name, kind, files: created }, () => `Created ${name} in ${where}:\n${created.map((file) => `  ${file}`).join('\n')}\n\nNext:\n${where === '.' ? '' : `  cd ${where}\n`}  npm test\n  npm run doctor\n  npm run check\n  npm start\n`);

  return 0;
}
