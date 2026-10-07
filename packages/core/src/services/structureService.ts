import type { FileSystem } from '../types/filesystem.js';
import { extractDirectoryStructure } from '../structure-extractor/index.js';
import { extractCodebaseMetadata } from '../metadata-extractor/index.js';
import path from 'path';

export interface IStructureService {
  extractStructure(options: { directoryPath: string; depth?: number; workspaceFolders: string[] }): Promise<{
    directoryPath: string;
    depth: number;
    json: string;
    fileCount: number;
    directoryCount: number;
  }>;
  extractMetadata(workspaceFolders: string[]): Promise<{
    root: string;
    totalFiles: number;
    totalFolders: number;
    mostDenseFolder: string;
    mostDenseCount: number;
  }>;
}

export class StructureService implements IStructureService {
  constructor(private readonly fs: FileSystem) {}

  async extractStructure(options: { directoryPath: string; depth?: number; workspaceFolders: string[] }): Promise<{
    directoryPath: string;
    depth: number;
    json: string;
    fileCount: number;
    directoryCount: number;
  }> {
    const depth = options.depth ?? 3;
    const resolvedPath = path.resolve(options.directoryPath);
    const json = await extractDirectoryStructure(this.fs, resolvedPath, depth);

    let parsed: Record<string, any> = {};
    try {
      parsed = JSON.parse(json);
    } catch {
      // ignore parse errors for counting
    }

    let fileCount = 0;
    let directoryCount = 0;
    for (const value of Object.values(parsed)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string') {
            fileCount++;
          } else if (typeof item === 'object' && item !== null) {
            directoryCount++;
          }
        }
      }
    }

    return {
      directoryPath: options.directoryPath,
      depth,
      json,
      fileCount,
      directoryCount,
    };
  }

  async extractMetadata(workspaceFolders: string[]): Promise<{
    root: string;
    totalFiles: number;
    totalFolders: number;
    mostDenseFolder: string;
    mostDenseCount: number;
  }> {
    const workspaceRoot = workspaceFolders[0];
    return extractCodebaseMetadata(this.fs, path.resolve(workspaceRoot));
  }
}