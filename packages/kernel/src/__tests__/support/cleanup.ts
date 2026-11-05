import { rm } from 'node:fs/promises';

/**
 * Removes a test directory, retrying transient Windows file-lock errors.
 *
 * On Windows a SQLite handle can still be settling (or an antivirus scanner can
 * briefly hold a file) when a teardown hook runs, so a bare `rm` may fail with
 * EBUSY/EPERM/EACCES/ENOTEMPTY. POSIX permits unlinking open files, which is
 * why this was never visible on Linux/macOS.
 */
export async function safeRm(path: string, retries = 5): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' || code === 'ENOTEMPTY') {
        if (i === retries - 1) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 50 * Math.pow(2, i)));
        continue;
      }
      throw err;
    }
  }
}