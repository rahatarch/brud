/** Helpers shared by the twelve tool handlers. */
import type { IBrudFileSystem, OperationResult } from '@brud/kernel';
import { buildFailureResult } from './coordinator/index.js';
import type { MutationResult } from './envelope/index.js';
import { FilesystemError } from './errors/index.js';
import { checkDepth } from './governor/index.js';
import type { GovernorDecision } from './governor/index.js';
import { assertSafeTarget, depthOf, dirnamePath, joinPath } from './paths.js';
import type { FilesystemRuntime } from './runtime.js';

/** Converts a refused governor decision into an operation failure. */
export function governorFailure(
  kind: string,
  decision: GovernorDecision,
): OperationResult<MutationResult> {
  const code = decision.code === 'DEPTH_LIMIT_EXCEEDED'
    ? 'VALIDATION_ERROR'
    : 'BATCH_LIMIT_EXCEEDED';

  return buildFailureResult(
    kind,
    new FilesystemError(code, undefined, decision.message ?? 'Governor limit exceeded.'),
  );
}

/** Validates a multi-file scope before any search dispatch. */
export async function validateScope(
  runtime: FilesystemRuntime,
  scope: string | undefined,
): Promise<void> {
  if (scope === undefined) {
    return;
  }

  assertSafeTarget(scope);

  const depth = checkDepth(scope);

  if (!depth.ok) {
    throw new FilesystemError(
      'VALIDATION_ERROR',
      scope,
      depth.message ?? 'Scope is too deep.',
    );
  }

  await runtime.getFileSystem().stat(scope);
}

/** Recursively lists every file below a directory, relative to the workspace. */
export async function collectFiles(
  fs: IBrudFileSystem,
  directoryPath: string,
): Promise<string[]> {
  const entries = await fs.readDirectory(directoryPath);
  const files: string[] = [];

  for (const entry of entries) {
    const child = joinPath(directoryPath, entry.name);

    if (entry.isDirectory) {
      if (depthOf(child) > 32) {
        throw new FilesystemError(
          'VALIDATION_ERROR',
          child,
          `Directory depth exceeds the limit at "${child}".`,
        );
      }

      files.push(...await collectFiles(fs, child));
      continue;
    }

    if (entry.isFile) {
      files.push(child);
    }
  }

  return files.sort();
}

/**
 * Recursively lists every directory below a path, including the root itself.
 *
 * `move_directory` needs the complete directory tree so empty directories are
 * restored on reversal, not only the directories implied by files.
 */
export async function collectDirectories(
  fs: IBrudFileSystem,
  directoryPath: string,
): Promise<string[]> {
  const directories = [directoryPath];
  const entries = await fs.readDirectory(directoryPath);

  for (const entry of entries) {
    if (!entry.isDirectory) {
      continue;
    }

    const child = joinPath(directoryPath, entry.name);

    if (depthOf(child) > 32) {
      throw new FilesystemError(
        'VALIDATION_ERROR',
        child,
        `Directory depth exceeds the limit at "${child}".`,
      );
    }

    directories.push(...await collectDirectories(fs, child));
  }

  return directories.sort();
}

/**
 * Returns `base` plus every intermediate directory implied by `filePaths`.
 *
 * `create_directory` creates these parents implicitly through atomic writes, so
 * they must be declared as session targets to be removable on reversal.
 */
export function collectIntermediateDirectories(
  base: string,
  filePaths: readonly string[],
): string[] {
  const root = base.replace(/\/+$/u, '');
  const directories = new Set<string>([root]);

  for (const filePath of filePaths) {
    let parent = dirnamePath(filePath);

    while (parent.length > 0) {
      if (parent === root || parent.startsWith(`${root}/`)) {
        directories.add(parent);
      }

      if (parent === root || parent.length === 0) {
        break;
      }

      const next = dirnamePath(parent);

      if (next === parent) {
        break;
      }

      parent = next;
    }
  }

  return [...directories].sort();
}

/** Re-bases a path from one directory root onto another. */
export function rebasePath(
  sourceRoot: string,
  destinationRoot: string,
  path: string,
): string {
  const root = sourceRoot.replace(/\/+$/u, '');
  const relative = path === root
    ? ''
    : path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;

  return joinPath(destinationRoot, relative);
}