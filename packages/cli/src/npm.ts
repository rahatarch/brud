import { spawn } from 'node:child_process';
import { CommandError } from './errors.js';

/** What npm printed and how it ended. */
export interface NpmResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Package specs and paths that are safe to hand to npm. On Windows npm runs
 * through a shell, so anything outside this set (spaces, `&`, `|`, `%`, quotes,
 * `^`) is refused on every platform rather than escaped.
 */
const SAFE = /^[A-Za-z0-9@._\-/\\:~+=]+$/u;

/** @throws {CommandError} `UNSAFE_SPEC` when a user-supplied argument has characters npm should not be given. */
export function assertSafeArgument(value: string, what: string): string {
  if (!SAFE.test(value) || value.startsWith('-')) {
    throw new CommandError('UNSAFE_SPEC', `${what} "${value}" has characters that are not allowed (use letters, digits and . _ - / @ : ~ +; no spaces, and no leading "-")`);
  }

  return value;
}

/** Runs npm in `cwd`, collecting its output. `show` also streams it to this process's stderr. */
export function runNpm(args: readonly string[], cwd: string, show = false): Promise<NpmResult> {
  return new Promise((done, fail) => {
    const child = spawn('npm', [...args], { cwd, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');

      if (show) {
        process.stderr.write(chunk);
      }
    });
    child.once('error', fail);
    child.once('close', (code) => {
      done({ code, stdout, stderr });
    });
  });
}

/** Unpacks a `.tgz` into `into` with the system `tar` (present on Linux, macOS and Windows 10+). */
export function extractTarball(tarball: string, into: string): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn('tar', ['-xzf', tarball, '-C', into], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', () => {
      fail(new CommandError('ADD_EXTRACT_FAILED', 'the `tar` command is not available, so the package could not be inspected'));
    });
    child.once('close', (code) => {
      if (code === 0) {
        done();
      } else {
        fail(new CommandError('ADD_EXTRACT_FAILED', `could not unpack the package (${stderr.trim().split('\n')[0] ?? 'tar failed'})`));
      }
    });
  });
}
