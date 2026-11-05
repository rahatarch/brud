import { baseNameRelativePath, joinRelativePath } from './pathUtils.js';
import type { StructureFileSystem } from './fsPort.js';

const IGNORED_DIRECTORIES = new Set([
  'node_modules', 'dist', 'target', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.cache', '.turbo', '.vscode', '.git',
  'vendor', 'bower_components', 'temp', 'tmp',
  '__pycache__', '.venv', 'venv',
]);

export interface CodebaseMetadata {
  root: string;
  totalFiles: number;
  totalFolders: number;
  mostDenseFolder: string;
  mostDenseCount: number;
}

/**
 * Counts files and folders, and identifies the directory with the most direct
 * files.
 *
 * @param fs - Read-only workspace filesystem port.
 * @param rootPath - Workspace-relative root (`''` is the workspace root).
 * @param rootLabel - Label used when `rootPath` is empty.
 */
export async function extractCodebaseMetadata(
  fs: StructureFileSystem,
  rootPath: string,
  rootLabel = 'workspace',
): Promise<CodebaseMetadata> {
  let totalFiles = 0;
  let totalFolders = 0;
  let mostDenseFolder = '';
  let mostDenseCount = 0;

  async function traverse(dirPath: string): Promise<void> {
    const entries = await fs.readDirectory(dirPath);
    let directFileCount = 0;

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }
      if (entry.isDirectory && IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      if (entry.isDirectory) {
        totalFolders++;
        await traverse(joinRelativePath(dirPath, entry.name));
      } else {
        totalFiles++;
        directFileCount++;
      }
    }

    if (directFileCount > mostDenseCount) {
      mostDenseCount = directFileCount;
      mostDenseFolder = dirPath;
    }
  }

  await traverse(rootPath);

  const root = baseNameRelativePath(rootPath) || rootLabel;

  return {
    root,
    totalFiles,
    totalFolders,
    mostDenseFolder,
    mostDenseCount,
  };
}