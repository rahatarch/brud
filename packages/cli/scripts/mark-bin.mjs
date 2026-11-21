import { chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The bin entry must be executable on POSIX installs from a local build.
try {
  chmodSync(fileURLToPath(new URL('../dist/cli.js', import.meta.url)), 0o755);
} catch {
  // Windows and read-only checkouts: npm sets the bin mode at install time.
}
