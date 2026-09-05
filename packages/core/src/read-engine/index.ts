import path from 'path';
import { FileSystem } from '../types/filesystem.js';
import { readFileWithImports } from '../import-resolver/index.js';
import { searchFiles } from '../search/fileSearch.js';
import type { FileSearchQuery } from '../search/types.js';

export interface ReadFileEntry {
  path: string;
  content: string;
  size: number;
  isImported?: boolean;
  importedFrom?: string;
}

export interface ReadResult {
  files: ReadFileEntry[];
  totalFiles: number;
  totalSize: number;
}

export async function readFiles(
  fs: FileSystem,
  filePaths: string[],
  isImportRead: boolean,
  maxDepth: number,
  excludePatterns?: string[],
  importSyntax?: string[],
): Promise<ReadResult> {
  const entries: ReadFileEntry[] = [];
  let totalSize = 0;

  for (const filePath of filePaths) {
    try {
      if (isImportRead && maxDepth > 0) {
        const { files: fileMap } = await readFileWithImports(fs, filePath, maxDepth, excludePatterns, importSyntax);
        let isFirst = true;
        for (const [p, content] of fileMap) {
          const size = Buffer.byteLength(content, 'utf8');
          totalSize += size;
          entries.push({
            path: p,
            content,
            size,
            isImported: !isFirst,
            importedFrom: isFirst ? undefined : filePath,
          });
          isFirst = false;
        }
      } else {
        const content = await fs.readFile(filePath);
        const size = Buffer.byteLength(content, 'utf8');
        totalSize += size;
        entries.push({ path: filePath, content, size });
      }
    } catch {
      // skip unreadable files
    }
  }

  return { files: entries, totalFiles: entries.length, totalSize };
}

export async function readDirectoryFiles(
  fs: FileSystem,
  directoryPath: string,
  recursive: boolean,
  excludePatterns?: string[],
  maxResults?: number,
): Promise<string[]> {
  const query: FileSearchQuery = {
    patterns: ['*'],
    excludePatterns,
    directory: directoryPath,
    recursive,
    maxResults: maxResults ?? 500,
  };

  const response = await searchFiles(fs, query);
  return response.results.map(r => path.resolve(directoryPath, r.path));
}