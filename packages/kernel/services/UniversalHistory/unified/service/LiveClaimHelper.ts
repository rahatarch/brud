/**
 * Chained liveness helper for one kernel instance (RL §3.3, rung 2).
 *
 * A tiny child process that outlives nothing: it stays alive while its
 * kernel's stdin pipe is open and exits as soon as the kernel dies, so a
 * claim's `helperPid` is a crash witness that the OS can test. Combined with
 * the owning `pid` in the claim, this protects against pid reuse in the window
 * between a crash and the next boot.
 *
 * Zero dependency: `node:child_process` and a `data:` URL, so no file is
 * added under `packages/` or `dist/`. Fails closed: when the runtime is
 * neither `node` nor `electron`, nothing is spawned and the claim carries no
 * `helperPid` (rungs 1 and 3 still apply).
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

/** Script the helper runs; it reports its pid, then idles until stdin closes. */
const HELPER_SOURCE = `
const { createInterface } = await import('node:readline');
const owner = Number(process.argv[1]);
process.stdout.write(String(process.pid) + String.fromCharCode(10));
const ownerGone = () => {
  try { process.kill(owner, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
};
const poll = setInterval(() => { if (ownerGone()) process.exit(0); }, 25);
poll.unref();
const rl = createInterface({ input: process.stdin });
await new Promise((resolve) => {
  rl.on('close', resolve);
  rl.on('line', () => undefined);
  process.stdin.on('error', resolve);
});
process.exit(0);
`;

/** Runtime basenames this helper is allowed to spawn itself under. */
const SPAWNABLE = new Set(['node', 'node.exe', 'electron', 'electron.exe']);

function runtimeIsSpawnable(): boolean {
  const base = process.execPath.split(/[\\/]/u).pop() ?? '';
  return SPAWNABLE.has(base);
}

export class LiveClaimHelper {
  private child: ChildProcess | undefined;

  private pidValue: number | undefined;

  /** True when a helper is running and can be named in a claim. */
  get available(): boolean {
    return this.pidValue !== undefined;
  }

  /** The helper's pid, or `undefined` when rung 2 is unavailable. */
  get pid(): number | undefined {
    return this.pidValue;
  }

  /**
   * Starts the helper. Idempotent and fail-closed: a runtime that cannot
   * spawn itself, or a spawn error, leaves {@link available} false.
   */
  async start(): Promise<void> {
    if (this.child !== undefined || !runtimeIsSpawnable()) {
      return;
    }
    const child = spawn(process.execPath, ['--input-type=module', '-e', HELPER_SOURCE, String(process.pid)], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
    try {
      const pid = await new Promise<number | undefined>((resolve) => {
        let buffered = '';
        const onData = (chunk: string): void => {
          buffered += chunk;
          const newline = buffered.indexOf('\n');
          if (newline >= 0) {
            child.stdout?.off('data', onData);
            resolve(Number(buffered.slice(0, newline).trim()));
          }
        };
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', onData);
        child.on('error', () => { resolve(undefined); });
        child.on('close', () => { resolve(undefined); });
      });
      if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 0) {
        child.kill('SIGKILL');
        return;
      }
      this.child = child;
      this.pidValue = pid;
      // Never let the helper hold the kernel's event loop open.
      child.unref();
      const stdin = child.stdin as (NodeJS.WritableStream & { unref?: () => void }) | null;
      stdin?.unref?.();
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // Already gone.
      }
    }
  }

  /** Kills the helper; the kernel's own claims are released separately. */
  stop(): void {
    const child = this.child;
    this.child = undefined;
    this.pidValue = undefined;
    if (child === undefined) {
      return;
    }
    try {
      child.stdin?.end();
    } catch {
      // Pipe already closed.
    }
    try {
      child.kill('SIGKILL');
    } catch {
      // Already gone.
    }
  }
}
