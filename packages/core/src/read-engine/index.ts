import path from 'path';
import { FileSystem } from '../types/filesystem.js';
import { readFileWithImports } from '../import-resolver/index.js';
import { searchFiles } from '../search/fileSearch.js';
import type { FileSearchQuery } from '../search/types.js';
import { BrudAPI, BrudError } from '../api/index.js';

export interface ReadFileEntry {
  path: string;
  content: string;
  size: number;
  startLine: number;
  endLine: number;
  totalLines: number;
  isImported?: boolean;
  importedFrom?: string;
}

export interface ReadResult {
  files: ReadFileEntry[];
  totalFiles: number;
  totalSize: number;
}

function calculateTotalLines(content: string): number {
  const trimmed = content.endsWith('\n') ? content.slice(0, -1) : content;
  return trimmed.length === 0 ? 0 : (trimmed.match(/\n/g) || []).length + 1;
}

function sliceContent(content: string, startLine: number, endLine: number): string {
  const lines = content.split('\n');
  const slicedLines = lines.slice(startLine - 1, endLine);
  return slicedLines.join('\n') + (content.endsWith('\n') ? '\n' : '');
}

function buildEntry(
  filePath: string,
  content: string,
  startLine?: number,
  endLine?: number,
  isImported?: boolean,
  importedFrom?: string,
): ReadFileEntry {
  const totalLines = calculateTotalLines(content);

  if (startLine !== undefined || endLine !== undefined) {
    const vr = BrudAPI.validate.lineRange(startLine, endLine, totalLines);
    if (!vr.success) {
      throw new BrudError({
        code: vr.code!,
        friendly: vr.friendly!,
        details: vr.details!,
        path: filePath,
      });
    }
    const range = vr.data as { startLine: number; endLine: number; totalLines: number };
    const sliced = sliceContent(content, range.startLine, range.endLine);
    return {
      path: filePath,
      content: sliced,
      size: Buffer.byteLength(sliced, 'utf8'),
      startLine: range.startLine,
      endLine: range.endLine,
      totalLines: range.totalLines,
      isImported,
      importedFrom,
    };
  }

  return {
    path: filePath,
    content,
    size: Buffer.byteLength(content, 'utf8'),
    startLine: 1,
    endLine: totalLines,
    totalLines,
    isImported,
    importedFrom,
  };
}

export async function readFiles(
  fs: FileSystem,
  filePaths: string[],
  isImportRead: boolean,
  maxDepth: number,
  excludePatterns?: string[],
  importSyntax?: string[],
  startLine?: number,
  endLine?: number,
): Promise<ReadResult> {
  const entries: ReadFileEntry[] = [];
  let totalSize = 0;

  for (const filePath of filePaths) {
    try {
      if (isImportRead) {
        const effectiveDepth = maxDepth === 0 ? Infinity : maxDepth;
        const { files: fileMap } = await readFileWithImports(fs, filePath, effectiveDepth, excludePatterns, importSyntax);
        let isFirst = true;
        for (const [p, content] of fileMap) {
          const entry = isFirst
            ? buildEntry(p, content, startLine, endLine)
            : buildEntry(p, content, undefined, undefined, true, filePath);
          totalSize += entry.size;
          entries.push(entry);
          isFirst = false;
        }
      } else {
        const content = await fs.readFile(filePath);
        const entry = buildEntry(filePath, content, startLine, endLine);
        totalSize += entry.size;
        entries.push(entry);
      }
} catch (err) {
        if (err instanceof BrudError) throw err;
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
    patterns: ['**'],
    excludePatterns,
    directory: directoryPath,
    recursive,
    maxResults: maxResults ?? Infinity,
  };

  const response = await searchFiles(fs, query);
  return response.results.map(r => path.resolve(directoryPath, r.path));
}