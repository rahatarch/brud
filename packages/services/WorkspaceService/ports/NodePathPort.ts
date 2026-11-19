import { lstat, realpath } from 'node:fs/promises';
import type { IWorkspacePathPort, WorkspacePathEntry } from '../contracts/IWorkspaceService.js';

function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;

  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Default path port backed by `node:fs/promises`.
 *
 * Owned by WorkspaceService so its descriptor needs no BrudFileSystem driver
 * (breaks the Workspace → BrudFileSystem runtime edge).
 */
export function createNodePathPort(): IWorkspacePathPort {
  return {
    lstat: async (absolutePath: string): Promise<WorkspacePathEntry | null> => {
      try {
        const stats = await lstat(absolutePath);

        return { isSymbolicLink: stats.isSymbolicLink(), mtimeMs: stats.mtimeMs };
      } catch (error: unknown) {
        if (isMissing(error)) {
          return null;
        }

        throw error;
      }
    },
    realpath: (absolutePath: string): Promise<string> => realpath(absolutePath),
  };
}
