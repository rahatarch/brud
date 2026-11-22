import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root. BRUD_CLI_RELEASE_ROOT lets the tests point the scripts at a fixture repo. */
export const ROOT = process.env.BRUD_CLI_RELEASE_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** `--flag`, `--key value`, and positionals under `_`. */
export function parseArgs(argv, booleans = ['ci', 'push', 'dry-run', 'sign', 'from-registry']) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (booleans.includes(key)) out[key] = true;
      else out[key] = argv[++i];
    } else out._.push(a);
  }
  return out;
}
