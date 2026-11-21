import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { flagText, UsageError, type ParsedArgs } from '../../../core/args.js';
import { CommandError } from '../../../core/errors.js';
import type { Io } from '../../../core/io.js';
import { printData, type Style } from '../../../core/report.js';
import { initTarget } from '../target.js';
import { assemblyScriptFiles } from './assemblyscript.js';
import { javaScriptFiles } from './javascript.js';
import { GUEST_LANGS, type GuestLang } from './shared.js';

const LANGUAGE_NAMES: Readonly<Record<GuestLang, string>> = { as: 'AssemblyScript', js: 'JavaScript', ts: 'TypeScript' };

function langOf(args: ParsedArgs): GuestLang {
  const lang = flagText(args, 'lang') ?? 'as';

  if (!(GUEST_LANGS as readonly string[]).includes(lang)) {
    throw new UsageError(`--lang must be one of: ${GUEST_LANGS.join(', ')} (as = AssemblyScript, js = JavaScript, ts = TypeScript)`);
  }

  return lang as GuestLang;
}

function filesFor(name: string, lang: GuestLang): Record<string, string> {
  return lang === 'as' ? assemblyScriptFiles(name) : javaScriptFiles(name, lang === 'ts');
}

/**
 * `brud init <name> --guest [--lang as|js|ts]`: scaffolds a caged-participant
 * guest project that `brud pack` builds. AssemblyScript (default) compiles to
 * native-speed WebAssembly; JavaScript and TypeScript run in an interpreter
 * inside the cage. Experimental.
 */
export async function runInitGuest(io: Io, style: Style, args: ParsedArgs): Promise<number> {
  const lang = langOf(args);
  const { dir, name } = initTarget(io, args.positionals[0]);
  const files = filesFor(name, lang);
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

  printData(io, style, { dir, name, guest: true, language: LANGUAGE_NAMES[lang], files: Object.keys(files).sort() }, () => `Created a ${LANGUAGE_NAMES[lang]} guest project ${name} in ${where} (experimental).\n\nNext:\n${where === '.' ? '' : `  cd ${where}\n`}  npm install\n  npm run pack\n\nThen list dist/brud.participant.json in a composition with "official": false.\n`);

  return 0;
}
