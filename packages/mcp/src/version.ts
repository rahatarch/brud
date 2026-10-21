import { readFileSync, realpathSync } from 'node:fs';
import * as path from 'node:path';

export function resolvePackageVersion(entry: string = process.argv[1] ?? __filename): string | undefined {
  try {
    const directory = path.dirname(realpathSync(entry));
    const manifest = JSON.parse(
      readFileSync(path.join(directory, '..', 'package.json'), 'utf8'),
    ) as { version?: unknown };
    if (typeof manifest.version === 'string' && manifest.version.length > 0) {
      return manifest.version;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function applyPackageVersion(entry: string = process.argv[1] ?? __filename): void {
  if (process.env.BRUD_CLIENT_VERSION) {
    return;
  }
  const version = resolvePackageVersion(entry);
  if (version) {
    process.env.BRUD_CLIENT_VERSION = version;
  }
}
