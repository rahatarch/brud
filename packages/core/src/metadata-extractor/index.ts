import path from 'path';
import { FileSystem } from '../types/filesystem';

const IGNORED_DIRECTORIES = new Set([
  'node_modules', 'dist', 'target', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.cache', 'vendor', 'bower_components',
  '__pycache__', '.venv', 'venv',
]);

export async function extractCodebaseMetadata(
  fs: FileSystem,
  rootPath: string,
): Promise<{
  root: string;
  totalFiles: number;
  totalFolders: number;
  mostDenseFolder: string;
  mostDenseCount: number;
}> {
  let totalFiles = 0;
  let totalFolders = 0;
  let mostDenseFolder = '';
  let mostDenseCount = 0;

  async function traverse(dirPath: string): Promise<void> {
    const entries = await fs.listDirectoryContents(dirPath);
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
        await traverse(path.join(dirPath, entry.name));
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

  const root = path.basename(rootPath) || rootPath;
  const relativeDenseFolder = (() => {
    const rel = path.relative(rootPath, mostDenseFolder);
    return rel.startsWith('..') ? mostDenseFolder : rel;
  })();

  return {
    root,
    totalFiles,
    totalFolders,
    mostDenseFolder: relativeDenseFolder,
    mostDenseCount,
  };
}