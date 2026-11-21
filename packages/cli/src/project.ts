import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CommandError } from './errors.js';

/** A Brud package found for this project, and its loaded module. */
export interface LoadedPackage<T> {
  readonly name: string;
  readonly root: string;
  readonly version: string;
  readonly module: T;
}

interface PackageJson {
  readonly version?: string;
  readonly main?: string;
  readonly exports?: unknown;
}

function entryOf(pkg: PackageJson): string {
  const root = (pkg.exports as Record<string, unknown> | undefined)?.['.'];

  if (typeof root === 'string') {
    return root;
  }

  if (root !== null && typeof root === 'object') {
    const entry = root as Record<string, unknown>;
    const chosen = entry.import ?? entry.default;

    if (typeof chosen === 'string') {
      return chosen;
    }
  }

  return pkg.main ?? 'index.js';
}

/** Resolves `name/package.json` from `cwd` first (the project's own copy), then from this CLI's install. */
function locate(name: string, cwd: string): string | undefined {
  for (const base of [join(cwd, 'noop.js'), import.meta.url]) {
    try {
      return createRequire(base).resolve(`${name}/package.json`);
    } catch {
      continue;
    }
  }

  return undefined;
}

/**
 * Loads a Brud package the way the project does: from its own `node_modules`
 * first, so the CLI never reports on a kernel the project does not use.
 *
 * @throws {CommandError} `PACKAGE_NOT_FOUND` when neither the project nor the CLI has it.
 */
export async function loadPackage<T>(name: string, cwd: string): Promise<LoadedPackage<T>> {
  const manifestPath = locate(name, cwd);

  if (manifestPath === undefined) {
    throw new CommandError('PACKAGE_NOT_FOUND', `${name} is not installed here`);
  }

  const root = dirname(manifestPath);
  const pkg = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageJson;
  const module = (await import(pathToFileURL(join(root, entryOf(pkg))).href)) as T;

  return { name, root, version: pkg.version ?? '0.0.0', module };
}

/** The folder of a package found from `cwd` (without loading it), or undefined. */
export function findPackageRoot(name: string, cwd: string): string | undefined {
  const manifest = locate(name, cwd);

  return manifest === undefined ? undefined : dirname(manifest);
}

/** Whether a package can be found from `cwd` (without loading it). */
export function isInstalled(name: string, cwd: string): boolean {
  return locate(name, cwd) !== undefined;
}

/** This CLI's own package.json (engines, version, peer ranges). */
export function readOwnPackage(): { readonly version: string; readonly engines: { readonly node: string }; readonly peerDependencies: Readonly<Record<string, string>> } {
  const text = readFileSync(new URL('../package.json', import.meta.url), 'utf8');

  return JSON.parse(text) as ReturnType<typeof readOwnPackage>;
}

/** Whether `version` satisfies a simple `^x.y.z` or `>=x` range (the only forms Brud packages publish). */
export function satisfies(version: string, range: string): boolean {
  if (/^\s*(\*|x)?\s*$/iu.test(range)) {
    return true;
  }

  const parse = (text: string): number[] => text.replace(/^[\^>=~\s]+/u, '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const have = parse(version);
  const want = parse(range);
  const compare = (): number => {
    for (let index = 0; index < 3; index += 1) {
      const difference = (have[index] ?? 0) - (want[index] ?? 0);

      if (difference !== 0) {
        return difference;
      }
    }

    return 0;
  };

  if (range.startsWith('>=')) {
    return compare() >= 0;
  }

  if (compare() < 0) {
    return false;
  }

  // Caret: the left-most non-zero part is the compatibility boundary.
  const pivot = want.findIndex((part) => part !== 0);
  const boundary = pivot === -1 ? 2 : pivot;

  return have.slice(0, boundary + 1).every((part, index) => part === (want[index] ?? 0));
}
