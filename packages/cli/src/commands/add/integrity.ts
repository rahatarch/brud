import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The `sha512-…` digest npm records for a tarball file. */
export function tarballIntegrity(file: string): string {
  return `sha512-${createHash('sha512').update(readFileSync(file)).digest('base64')}`;
}

/** The integrity the project's lockfile records for an installed package, if there is one. */
export function lockedIntegrity(projectDir: string, name: string): string | undefined {
  const lock = join(projectDir, 'package-lock.json');

  if (!existsSync(lock)) {
    return undefined;
  }

  const packages = (JSON.parse(readFileSync(lock, 'utf8')) as { packages?: Record<string, { integrity?: string }> }).packages;

  return packages?.[`node_modules/${name}`]?.integrity;
}
