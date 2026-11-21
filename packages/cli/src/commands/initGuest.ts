import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParsedArgs } from '../args.js';
import { CommandError } from '../errors.js';
import type { Io } from '../io.js';
import { readOwnPackage } from '../project.js';
import { printData, type Style } from '../report.js';
import { initTarget } from './target.js';

const GUEST = fileURLToPath(new URL('../../templates/guest/assembly/', import.meta.url));

/**
 * `brud init <name> --guest`: scaffolds a caged-participant guest project
 * (AssemblyScript) that `brud pack` builds. Experimental.
 */
export async function runInitGuest(io: Io, style: Style, args: ParsedArgs): Promise<number> {
  const { dir, name } = initTarget(io, args.positionals[0]);
  const own = readOwnPackage();
  const id = `${name}.guest`;
  const files: Record<string, string> = {
    'package.json': `${JSON.stringify({
      name,
      version: '0.0.0',
      private: true,
      type: 'module',
      scripts: { pack: 'brud pack --verify' },
      dependencies: { '@brud/kernel': own.peerDependencies['@brud/kernel'], '@brud/sdk': own.peerDependencies['@brud/sdk'] },
      devDependencies: { '@brud/cli': `^${own.version}`, assemblyscript: '^0.28.0' },
    }, null, 2)}\n`,
    'brud.participant.src.json': `${JSON.stringify({
      id,
      manifest: {
        requests: { capabilities: [] },
        exposures: [{ name: `${id}.hello`, version: 1, scope: 'any', policy: { policyVersion: 2, capabilities: [`${name}:read`] } }],
      },
      limits: { fuel: 1_000_000, maxMemoryBytes: 16_777_216, deadlineMs: 5000 },
      guest: { source: 'assembly/index.ts' },
    }, null, 2)}\n`,
    'assembly/brud.ts': readFileSync(join(GUEST, 'brud.ts.template'), 'utf8'),
    'assembly/index.ts': readFileSync(join(GUEST, 'index.ts.template'), 'utf8'),
    'assembly/tsconfig.json': readFileSync(join(GUEST, 'tsconfig.json'), 'utf8'),
    '.gitignore': 'node_modules\ndist\n',
  };
  const existing = Object.keys(files).filter((file) => existsSync(join(dir, file)));

  if (existing.length > 0) {
    throw new CommandError('INIT_EXISTS', `refusing to overwrite: ${existing.join(', ')} already exist in ${dir}`);
  }

  for (const [file, text] of Object.entries(files)) {
    const path = join(dir, file);

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, { encoding: 'utf8', flag: 'wx' });
  }

  const where = relative(io.cwd, dir) || '.';

  printData(io, style, { dir, name, guest: true, files: Object.keys(files).sort() }, () => `Created a guest project ${name} in ${where} (experimental).\n\nNext:\n${where === '.' ? '' : `  cd ${where}\n`}  npm install\n  npm run pack\n\nThen list dist/brud.participant.json in a composition with "official": false.\n`);

  return 0;
}
