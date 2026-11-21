import { spawnSync } from 'node:child_process';

const isWindows = process.platform === 'win32';

/**
 * Runs a command and returns { status, stdout, stderr }. Throws on a non-zero
 * exit unless `check` is false. `.cmd` shims (npm, npx) need a shell on Windows.
 */
export function run(cmd, args = [], options = {}) {
  const { cwd, env, input, check = true, inherit = false } = options;
  const result = spawnSync(cmd, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    input,
    encoding: 'utf8',
    shell: isWindows && /^(npm|npx|node_modules)/i.test(cmd),
    stdio: inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const out = { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  if (check && out.status !== 0) {
    const tail = `${out.stdout}\n${out.stderr}`.trim().split('\n').slice(-15).join('\n');
    throw new Error(`${cmd} ${args.join(' ')} exited ${out.status}\n${tail}`);
  }
  return out;
}

export const git = (args, options = {}) => run('git', args, options);

/** Prints a failure list and exits 1; returns normally when the list is empty. */
export function failIfAny(title, problems) {
  if (problems.length === 0) return;
  console.error(`\n${title}`);
  for (const p of problems) console.error(`  [x] ${p}`);
  console.error('');
  process.exit(1);
}
