import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flagOn, type ParsedArgs } from '../args.js';
import { hardcoreModulePaths, type KernelPackage } from '../composition.js';
import { CommandError } from '../errors.js';
import type { Io } from '../io.js';
import { loadPackage, readOwnPackage } from '../project.js';
import { printData, type Style } from '../report.js';
import { initTarget } from './target.js';

export const INIT_FLAGS = { boolean: ['kind', 'guest', 'no-install'] } as const;

const TEMPLATES = fileURLToPath(new URL('../../templates/', import.meta.url));

function template(file: string): string {
  return readFileSync(join(TEMPLATES, file), 'utf8');
}

/** Fills the example templates: their `acme.` ids become this project's, and their paths point at the scaffold's layout. */
function participantSource(name: string, kind: boolean): string {
  return template(kind ? 'kind.mjs' : 'participant.mjs').replace(/acme\./gu, `${name}.`);
}

function testSource(name: string, kind: boolean): string {
  return template(kind ? 'kind.test.mjs' : 'participant.test.mjs')
    .replace(/acme\./gu, `${name}.`)
    .replace(/'(?:vault|notes)\.mjs'/u, `'..', 'participants', '${name}.mjs'`);
}

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
  const own = readOwnPackage();
  const files: Record<string, string> = {
    'package.json': `${JSON.stringify({
      name,
      version: '0.0.0',
      private: true,
      type: 'module',
      scripts: { test: 'node --test', doctor: 'brud doctor', check: 'brud check', run: 'brud run' },
      dependencies: { '@brud/kernel': own.peerDependencies['@brud/kernel'], '@brud/sdk': own.peerDependencies['@brud/sdk'] },
      devDependencies: { '@brud/cli': `^${own.version}` },
    }, null, 2)}\n`,
    [`participants/${name}.mjs`]: participantSource(name, kind),
    [`test/${name}.test.mjs`]: testSource(name, kind),
    '.gitignore': 'node_modules\n.brud\n',
    'README.md': `# ${name}\n\nA Brud project.\n\n- \`npm test\` runs the participant's tests.\n- \`npm run doctor\` checks this machine and the composition.\n- \`npm run check\` boots the composition in a scratch state and reports problems.\n- \`npm run run\` boots it and routes Brud text from stdin.\n`,
  };
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

  const services = [...hardcoreModulePaths(kernel.root).map((path) => ({ path, official: true })), { path: `./participants/${name}.mjs`, official: true }];

  await write(dir, 'brud.config.json', `${JSON.stringify({ services }, null, 2)}\n`);

  const created = [...Object.keys(files), 'brud.config.json'].sort();
  const where = relative(io.cwd, dir) || '.';

  printData(io, style, { dir, name, kind, files: created }, () => `Created ${name} in ${where}:\n${created.map((file) => `  ${file}`).join('\n')}\n\nNext:\n${where === '.' ? '' : `  cd ${where}\n`}  npm test\n  npx brud doctor\n  npx brud run\n`);

  return 0;
}
