import { spawn } from 'node:child_process';
import { flagOn, UsageError, type ParsedArgs } from '../../core/args.js';
import { CommandError } from '../../core/errors.js';
import type { Io } from '../../core/io.js';
import { confirm, isInteractive } from '../../core/prompt.js';
import type { Style } from '../../core/report.js';

/** Runs `npm install` in `dir`, showing npm's own output. */
export function installDependencies(dir: string): Promise<void> {
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

/**
 * Decides whether `brud init` installs the packages. `--install` and
 * `--no-install` decide without asking. Otherwise a person at a terminal is
 * asked; with no one to ask (a pipe, CI, `--json`) it takes `whenNotAsked`.
 *
 * @throws {UsageError} When both flags are given.
 */
export async function wantsInstall(io: Io, style: Style, args: ParsedArgs, where: string, whenNotAsked: boolean): Promise<boolean> {
  const yes = flagOn(args, 'install');
  const no = flagOn(args, 'no-install');

  if (yes && no) {
    throw new UsageError('--install and --no-install cannot be used together');
  }

  if (yes || no) {
    return yes;
  }

  return isInteractive(io, style)
    ? confirm(io, `Install the packages now? This runs \`npm install\` in ${where}.`, true)
    : whenNotAsked;
}
