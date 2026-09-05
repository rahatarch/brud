import path from 'path';
import { FileOperation, TerminalInteractiveOperation } from '../types/patch';
import { FileSystem } from '../types/filesystem';
import { validateWorkspacePath } from '../utils/workspacePath';
import { extractDirectoryStructure } from '../structure-extractor';
import { extractCodebaseMetadata } from '../metadata-extractor';
import { searchFiles } from '../search/fileSearch';
import { readFiles, readDirectoryFiles } from '../read-engine/index.js';
import type { FileSearchQuery } from '../search/types';
import type { HistoryStore, SnapshotData } from '../history/index.js';
import { createSnapshot, recordAndSaveSession, generateSessionId, getNextSequenceNumber } from '../history/index.js';
import type { TerminalExecutor } from '../terminal/types';

let operationIdCounter = 0;

function generateOperationId(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  operationIdCounter++;
  const seq = String(operationIdCounter).padStart(3, '0');
  return `OP-${y}${m}${d}-${hh}${mm}${ss}-${seq}`;
}

export interface OperationResult {
  operationId: string;
  operationIndex: number;
  kind: string;
  status: 'success' | 'aborted' | 'failed';
  message: string;
  path: string;
  from?: string;
  to?: string;
  directoryPath?: string;
  files?: string[];
}

export interface FileOperationResult {
  success: boolean;
  message: string;
  errors: string[];
  operationResults: OperationResult[];
  sessionId?: string;
}



export async function executeFileOperations(
  operations: FileOperation[],
  fs: FileSystem,
  workspaceFolders: string[],
  historyStore?: HistoryStore,
  originalPrompt?: string,
  terminalExecutor?: TerminalExecutor,
  sessionIdOverride?: string,
): Promise<FileOperationResult> {
  if (operations.length === 0) {
    return { success: false, message: 'No operations to execute.', errors: ['No operations to execute.'], operationResults: [], sessionId: undefined };
  }

  const errors: string[] = [];
  const operationResults: OperationResult[] = [];
  const extractionResults: { directoryPath: string; depth: number; json: string; fileCount: number; directoryCount: number }[] = [];

  let filesAffected: string[] = [];
  let sessionId: string | undefined;
  let preSnapshot: SnapshotData | undefined;
  const preResolvedMultiFiles: Map<number, string[]> = new Map();
  const readResults: Map<number, { files: Array<{ path: string; content: string; size: number; isImported?: boolean; importedFrom?: string }>; totalFiles: number; totalSize: number }> = new Map();
  let existingSessionData: { filesAffected: string[]; preSnapshot: SnapshotData; postSnapshot: SnapshotData; operationResults: OperationResult[] } | undefined;

  if (historyStore) {
    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i];
      switch (operation.kind) {
        case 'search_replace':
        case 'create_file':
        case 'delete_file':
        case 'append_file': {
          const result = validateWorkspacePath(operation.path, workspaceFolders);
          if (result.valid && !filesAffected.includes(result.resolvedPath)) {
            filesAffected.push(result.resolvedPath);
          }
          break;
        }
        case 'rename_file':
        case 'move_file':
        case 'copy_file': {
          const fromResult = validateWorkspacePath(operation.from, workspaceFolders);
          if (fromResult.valid && !filesAffected.includes(fromResult.resolvedPath)) {
            filesAffected.push(fromResult.resolvedPath);
          }
          const toResult = validateWorkspacePath(operation.to, workspaceFolders);
          if (toResult.valid && !filesAffected.includes(toResult.resolvedPath)) {
            filesAffected.push(toResult.resolvedPath);
          }
          break;
        }
        case 'append_file_multi':
        case 'search_replace_multi': {
          if (workspaceFolders.length === 0) {
            break;
          }
          const workspaceRoot = workspaceFolders[0];
          const searchDirectory = operation.directory
            ? path.resolve(workspaceRoot, operation.directory)
            : path.resolve(workspaceRoot);
          if (!searchDirectory.startsWith(path.resolve(workspaceRoot))) {
            break;
          }
          const query: FileSearchQuery = {
            patterns: operation.patterns,
            excludePatterns: operation.excludePatterns,
            directory: searchDirectory,
            recursive: operation.recursive,
            maxResults: operation.maxResults,
          };
          const response = await searchFiles(fs, query);
          const matchedFiles = response.results.map(r => path.resolve(searchDirectory, r.path));
          for (const f of matchedFiles) {
            if (!filesAffected.includes(f)) {
              filesAffected.push(f);
            }
          }
          preResolvedMultiFiles.set(i, matchedFiles);
          break;
        }
      }
    }

    const now = new Date();
    if (sessionIdOverride) {
      sessionId = sessionIdOverride;
    } else {
      const existingSessions = await historyStore.getAllSessions();
      const seq = getNextSequenceNumber(existingSessions);
      sessionId = generateSessionId(now, seq);
    }

    if (sessionIdOverride && historyStore) {
      const existingEntry = await historyStore.getSession(sessionIdOverride);
      if (existingEntry) {
        existingSessionData = {
          filesAffected: existingEntry.session.filesAffected,
          preSnapshot: existingEntry.preSnapshot,
          postSnapshot: existingEntry.postSnapshot,
          operationResults: existingEntry.session.operations,
        };
        for (const f of existingSessionData.filesAffected) {
          if (!filesAffected.includes(f)) {
            filesAffected.push(f);
          }
        }
      }
    }

    preSnapshot = await createSnapshot(sessionId, 'pre', fs, filesAffected);
  }

  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i];
    try {
      switch (operation.kind) {
        case 'search_replace': {
          const result = validateWorkspacePath(operation.path, workspaceFolders);
          if (!result.valid) {
            errors.push(result.error);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'search_replace',
              status: 'failed',
              message: result.error,
              path: operation.path,
            });
            continue;
          }

          const filePath = result.resolvedPath;
          const content = await fs.readFile(filePath);

          let count = 0;
          let searchIndex = content.indexOf(operation.search);
          while (searchIndex !== -1) {
            count++;
            searchIndex = content.indexOf(operation.search, searchIndex + 1);
          }

          if (count === 0) {
            errors.push(`Search text not found in file: ${operation.path}`);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'search_replace',
              status: 'aborted',
              message: `Search text not found in ${operation.path}. No changes made.`,
              path: operation.path,
            });
            continue;
          }

          if (count > 1) {
            errors.push(`Multiple matches found for search text in file: ${operation.path}. Please provide more context to make the search unique.`);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'search_replace',
              status: 'aborted',
              message: `Multiple matches found in ${operation.path}. Patch aborted to avoid ambiguity.`,
              path: operation.path,
            });
            continue;
          }

          const matchIndex = content.indexOf(operation.search);
          const updatedContent = content.substring(0, matchIndex) + operation.replace + content.substring(matchIndex + operation.search.length);
          await fs.writeFile(filePath, updatedContent);
          operationResults.push({
            operationIndex: i,
              operationId: generateOperationId(),
            kind: 'search_replace',
            status: 'success',
            message: `Patched ${operation.path}.`,
            path: operation.path,
          });
          break;
        }

        case 'create_file': {
          const result = validateWorkspacePath(operation.path, workspaceFolders);
          if (!result.valid) {
            errors.push(result.error);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'create_file',
              status: 'failed',
              message: result.error,
              path: operation.path,
            });
            continue;
          }

          const filePath = result.resolvedPath;

          if (await fs.exists(filePath)) {
            errors.push(`File already exists: ${operation.path}`);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'create_file',
              status: 'aborted',
              message: `File already exists: ${operation.path}. Creation aborted, existing content preserved.`,
              path: operation.path,
            });
            continue;
          }

          const parentDir = path.dirname(filePath);
          await fs.createDirectory(parentDir);
          await fs.writeFile(filePath, operation.content);
          operationResults.push({
            operationIndex: i,
              operationId: generateOperationId(),
            kind: 'create_file',
            status: 'success',
            message: `Created ${operation.path}.`,
            path: operation.path,
          });
          break;
        }

        case 'delete_file': {
          const result = validateWorkspacePath(operation.path, workspaceFolders);
          if (!result.valid) {
            errors.push(result.error);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'delete_file',
              status: 'failed',
              message: result.error,
              path: operation.path,
            });
            continue;
          }

          const filePath = result.resolvedPath;

          if (!(await fs.exists(filePath))) {
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'delete_file',
              status: 'success',
              message: `${operation.path} does not exist. Nothing to delete.`,
              path: operation.path,
            });
            break;
          }

          await fs.deleteFile(filePath);

          if (await fs.exists(filePath)) {
            errors.push(`Failed to delete file: ${operation.path}`);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'delete_file',
              status: 'failed',
              message: `Failed to delete ${operation.path}.`,
              path: operation.path,
            });
          } else {
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'delete_file',
              status: 'success',
              message: `Deleted ${operation.path}.`,
              path: operation.path,
            });
          }
          break;
        }

        case 'rename_file': {
          const fromResult = validateWorkspacePath(operation.from, workspaceFolders);
          if (!fromResult.valid) {
            errors.push(fromResult.error);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'rename_file',
              status: 'failed',
              message: fromResult.error,
              path: operation.from,
            });
            continue;
          }

          const toResult = validateWorkspacePath(operation.to, workspaceFolders);
          if (!toResult.valid) {
            errors.push(toResult.error);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'rename_file',
              status: 'failed',
              message: toResult.error,
              path: operation.to,
            });
            continue;
          }

          const sourcePath = fromResult.resolvedPath;
          const targetPath = toResult.resolvedPath;

          if (!(await fs.exists(sourcePath))) {
            errors.push(`Source file not found: ${operation.from}`);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'rename_file',
              status: 'aborted',
              message: `Source file not found: ${operation.from}. Rename aborted.`,
              path: operation.from,
            });
            continue;
          }

          if (await fs.exists(targetPath)) {
            errors.push(`Destination file already exists: ${operation.to}`);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'rename_file',
              status: 'aborted',
              message: `Destination file already exists: ${operation.to}. Rename aborted.`,
              path: operation.to,
            });
            continue;
          }

          await fs.renameFile(sourcePath, targetPath);
          operationResults.push({
            operationIndex: i,
              operationId: generateOperationId(),
            kind: 'rename_file',
            status: 'success',
            message: `Renamed ${operation.from} to ${operation.to}.`,
            path: operation.from,
            from: operation.from,
            to: operation.to,
          });
          break;
        }

        case 'move_file': {
          const fromResult = validateWorkspacePath(operation.from, workspaceFolders);
          if (!fromResult.valid) {
            errors.push(fromResult.error);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'move_file',
              status: 'failed',
              message: fromResult.error,
              path: operation.from,
            });
            continue;
          }

          const toResult = validateWorkspacePath(operation.to, workspaceFolders);
          if (!toResult.valid) {
            errors.push(toResult.error);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'move_file',
              status: 'failed',
              message: toResult.error,
              path: operation.to,
            });
            continue;
          }

          const sourcePath = fromResult.resolvedPath;
          const targetPath = toResult.resolvedPath;

          if (!(await fs.exists(sourcePath))) {
            errors.push(`Source file not found: ${operation.from}`);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'move_file',
              status: 'aborted',
              message: `Source file not found: ${operation.from}. Move aborted.`,
              path: operation.from,
            });
            continue;
          }

          if (await fs.exists(targetPath)) {
            errors.push(`Destination file already exists: ${operation.to}`);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'move_file',
              status: 'aborted',
              message: `Destination file already exists: ${operation.to}. Move aborted.`,
              path: operation.to,
            });
            continue;
          }

          const parentDir = path.dirname(targetPath);
          await fs.createDirectory(parentDir);
          await fs.renameFile(sourcePath, targetPath);
          operationResults.push({
            operationIndex: i,
              operationId: generateOperationId(),
            kind: 'move_file',
            status: 'success',
            message: `Moved ${operation.from} to ${operation.to}.`,
            path: operation.from,
            from: operation.from,
            to: operation.to,
          });
          break;
        }

        case 'copy_file': {
          const fromResult = validateWorkspacePath(operation.from, workspaceFolders);
          if (!fromResult.valid) {
            errors.push(fromResult.error);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'copy_file',
              status: 'failed',
              message: fromResult.error,
              path: operation.from,
            });
            continue;
          }

          const toResult = validateWorkspacePath(operation.to, workspaceFolders);
          if (!toResult.valid) {
            errors.push(toResult.error);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'copy_file',
              status: 'failed',
              message: toResult.error,
              path: operation.to,
            });
            continue;
          }

          const sourcePath = fromResult.resolvedPath;
          const targetPath = toResult.resolvedPath;

          if (!(await fs.exists(sourcePath))) {
            errors.push(`Source file not found: ${operation.from}`);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'copy_file',
              status: 'aborted',
              message: `Source file not found: ${operation.from}. Copy aborted.`,
              path: operation.from,
            });
            continue;
          }

          if (await fs.exists(targetPath)) {
            errors.push(`Destination file already exists: ${operation.to}`);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'copy_file',
              status: 'aborted',
              message: `Destination file already exists: ${operation.to}. Copy aborted.`,
              path: operation.to,
            });
            continue;
          }

          const parentDir = path.dirname(targetPath);
          await fs.createDirectory(parentDir);
          await fs.copyFile(sourcePath, targetPath);
          operationResults.push({
            operationIndex: i,
              operationId: generateOperationId(),
            kind: 'copy_file',
            status: 'success',
            message: `Copied ${operation.from} to ${operation.to}.`,
            path: operation.from,
            from: operation.from,
            to: operation.to,
          });
          break;
        }

        case 'append_file': {
          const result = validateWorkspacePath(operation.path, workspaceFolders);
          if (!result.valid) {
            errors.push(result.error);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'append_file',
              status: 'failed',
              message: result.error,
              path: operation.path,
            });
            continue;
          }

          const filePath = result.resolvedPath;

          let existingContent = '';
          if (!(await fs.exists(filePath))) {
            errors.push(`File not found: ${operation.path}`);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'append_file',
              status: 'aborted',
              message: `File not found: ${operation.path}. Append aborted.`,
              path: operation.path,
            });
            continue;
          }
          existingContent = await fs.readFile(filePath);

          const updatedContent = operation.position === 'end'
            ? existingContent + '\n\n' + operation.content
            : operation.content + '\n\n' + existingContent;

          await fs.writeFile(filePath, updatedContent);
          operationResults.push({
            operationIndex: i,
              operationId: generateOperationId(),
            kind: 'append_file',
            status: 'success',
            message: `Appended content to ${operation.path}.`,
            path: operation.path,
          });
          break;
        }

        case 'create_directory': {
          const result = validateWorkspacePath(operation.directoryPath, workspaceFolders);
          if (!result.valid) {
            errors.push(result.error);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'create_directory',
              status: 'failed',
              message: result.error,
              path: operation.directoryPath,
            });
            continue;
          }

          const directoryPath = result.resolvedPath;
          await fs.createDirectory(directoryPath);

          for (const file of operation.files) {
            const fileResult = validateWorkspacePath(path.join(operation.directoryPath, file), workspaceFolders);
            if (!fileResult.valid) {
              errors.push(fileResult.error);
              continue;
            }
            const filePath = fileResult.resolvedPath;
            const parentDir = path.dirname(filePath);
            await fs.createDirectory(parentDir);
            await fs.writeFile(filePath, '');
          }
          operationResults.push({
            operationIndex: i,
              operationId: generateOperationId(),
            kind: 'create_directory',
            status: 'success',
            message: `Created directory ${operation.directoryPath} with ${operation.files.length} files.`,
            path: operation.directoryPath,
            directoryPath: operation.directoryPath,
            files: operation.files,
          });
          break;
        }

        case 'delete_directory': {
          const result = validateWorkspacePath(operation.directoryPath, workspaceFolders);
          if (!result.valid) {
            errors.push(result.error);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'delete_directory',
              status: 'failed',
              message: result.error,
              path: operation.directoryPath,
            });
            continue;
          }

          const directoryPath = result.resolvedPath;

          if (!(await fs.exists(directoryPath))) {
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'delete_directory',
              status: 'success',
              message: `${operation.directoryPath} does not exist. Nothing to delete.`,
              path: operation.directoryPath,
            });
            break;
          }

          await fs.deleteDirectoryRecursive(directoryPath);

          if (await fs.exists(directoryPath)) {
            errors.push(`Failed to delete directory: ${operation.directoryPath}`);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'delete_directory',
              status: 'failed',
              message: `Failed to delete directory ${operation.directoryPath}.`,
              path: operation.directoryPath,
            });
          } else {
operationResults.push({
            operationIndex: i,
              operationId: generateOperationId(),
            kind: 'delete_directory',
            status: 'success',
            message: `Deleted directory ${operation.directoryPath} and all its contents.`,
            path: operation.directoryPath,
            directoryPath: operation.directoryPath,
          });
          }
          break;
        }

        case 'move_directory': {
          const fromResult = validateWorkspacePath(operation.from, workspaceFolders);
          if (!fromResult.valid) {
            errors.push(fromResult.error);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'move_directory',
              status: 'failed',
              message: fromResult.error,
              path: operation.from,
            });
            continue;
          }

          const toResult = validateWorkspacePath(operation.to, workspaceFolders);
          if (!toResult.valid) {
            errors.push(toResult.error);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'move_directory',
              status: 'failed',
              message: toResult.error,
              path: operation.to,
            });
            continue;
          }

          const sourcePath = fromResult.resolvedPath;
          const targetPath = toResult.resolvedPath;

          if (!(await fs.exists(sourcePath))) {
            errors.push(`Source directory not found: ${operation.from}`);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'move_directory',
              status: 'aborted',
              message: `Source directory not found: ${operation.from}. Move aborted.`,
              path: operation.from,
            });
            continue;
          }

          if (await fs.exists(targetPath)) {
            errors.push(`Destination directory already exists: ${operation.to}`);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'move_directory',
              status: 'aborted',
              message: `Destination directory already exists: ${operation.to}. Move aborted.`,
              path: operation.to,
            });
            continue;
          }

          await fs.moveDirectory(sourcePath, targetPath);
          operationResults.push({
            operationIndex: i,
              operationId: generateOperationId(),
            kind: 'move_directory',
            status: 'success',
            message: `Moved directory ${operation.from} to ${operation.to}.`,
            path: operation.from,
            from: operation.from,
            to: operation.to,
          });
          break;
        }

        case 'extract_structure': {
          console.error('DEBUG extract_structure: directoryPath=' + operation.directoryPath + ', depth=' + operation.depth);
          console.error('DEBUG extract_structure: workspaceFolders=' + JSON.stringify(workspaceFolders));
          const result = validateWorkspacePath(operation.directoryPath, workspaceFolders);
          console.error('DEBUG extract_structure: validateWorkspacePath result=' + JSON.stringify(result));
          if (!result.valid) {
            errors.push(result.error);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'extract_structure',
              status: 'failed',
              message: result.error,
              path: operation.directoryPath,
            });
            continue;
          }

          const directoryPath = result.resolvedPath;
          const exists = await fs.exists(directoryPath);
          console.error('DEBUG extract_structure: fs.exists result=' + exists);
          if (!exists) {
            errors.push(`Directory not found: ${operation.directoryPath}`);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'extract_structure',
              status: 'aborted',
              message: `Directory not found: ${operation.directoryPath}. Extraction aborted.`,
              path: operation.directoryPath,
            });
            continue;
          }

          const json = await extractDirectoryStructure(fs, directoryPath, operation.depth);
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
          extractionResults.push({
            directoryPath: operation.directoryPath,
            depth: operation.depth,
            json,
            fileCount,
            directoryCount,
          });
          operationResults.push({
            operationIndex: i,
              operationId: generateOperationId(),
            kind: 'extract_structure',
            status: 'success',
            message: `Extracted directory structure of ${operation.directoryPath} at depth ${operation.depth}.`,
            path: operation.directoryPath,
          });
          break;
        }

        case 'codebase_metadata': {
          if (workspaceFolders.length === 0) {
            errors.push('No workspace root available for codebase metadata.');
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'codebase_metadata',
              status: 'aborted',
              message: 'No workspace root available for codebase metadata.',
              path: '',
            });
            continue;
          }

          const workspaceRoot = workspaceFolders[0];
          const metadata = await extractCodebaseMetadata(fs, path.resolve(workspaceRoot));
          const message = JSON.stringify(metadata, null, 2);
          operationResults.push({
            operationIndex: i,
              operationId: generateOperationId(),
            kind: 'codebase_metadata',
            status: 'success',
            message: `Analyzed codebase metadata for ${workspaceRoot}.`,
            path: workspaceRoot,
          });
          return { success: true, message, errors, operationResults };
        }

        case 'search_files': {
          if (workspaceFolders.length === 0) {
            errors.push('No workspace root available for file search.');
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'search_files',
              status: 'aborted',
              message: 'No workspace root available for file search.',
              path: '',
            });
            continue;
          }

          const workspaceRoot = workspaceFolders[0];
          const searchDirectory = operation.directory
            ? path.resolve(workspaceRoot, operation.directory)
            : path.resolve(workspaceRoot);

          if (!searchDirectory.startsWith(path.resolve(workspaceRoot))) {
            errors.push(`Search directory is outside workspace root: ${operation.directory}`);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'search_files',
              status: 'failed',
              message: `Search directory is outside workspace root: ${operation.directory}.`,
              path: operation.directory || '',
            });
            continue;
          }

          const query: FileSearchQuery = {
            patterns: operation.patterns,
            extensions: operation.extensions,
            excludePatterns: operation.excludePatterns,
            directory: searchDirectory,
            recursive: operation.recursive,
            maxResults: operation.maxResults,
          };

          const response = await searchFiles(fs, query);
          const resultJson = JSON.stringify(response, null, 2);
          operationResults.push({
            operationIndex: i,
            operationId: generateOperationId(),
            kind: 'search_files',
            status: 'success',
            message: `Found ${response.totalMatches} files matching pattern.`,
            path: operation.directory || '',
          });
          return { success: true, message: resultJson, errors, operationResults };
        }

        case 'append_file_multi': {
          if (workspaceFolders.length === 0) {
            errors.push('No workspace root available for file search.');
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'append_file_multi',
              status: 'aborted',
              message: 'No workspace root available for file search.',
              path: '',
            });
            continue;
          }

          const workspaceRoot = workspaceFolders[0];
          const searchDirectory = operation.directory
            ? path.resolve(workspaceRoot, operation.directory)
            : path.resolve(workspaceRoot);

          if (!searchDirectory.startsWith(path.resolve(workspaceRoot))) {
            errors.push(`Search directory is outside workspace root: ${operation.directory}`);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'append_file_multi',
              status: 'failed',
              message: `Search directory is outside workspace root: ${operation.directory}.`,
              path: operation.directory || '',
            });
            continue;
          }

          const appendQuery: FileSearchQuery = {
            patterns: operation.patterns,
            excludePatterns: operation.excludePatterns,
            directory: searchDirectory,
            recursive: operation.recursive,
            maxResults: operation.maxResults,
          };

          const matchedFiles = preResolvedMultiFiles.has(i)
            ? preResolvedMultiFiles.get(i)!
            : (await searchFiles(fs, appendQuery)).results.map(r => path.resolve(searchDirectory, r.path));

          const modifiedFiles: string[] = [];
          const skippedFiles: string[] = [];
          const failedFiles: string[] = [];

          for (const filePath of matchedFiles) {
            try {
              let existingContent = '';
              if (!(await fs.exists(filePath))) {
                failedFiles.push(filePath);
                continue;
              }
              existingContent = await fs.readFile(filePath);

              const updatedContent = operation.position === 'end'
                ? existingContent + '\n\n' + operation.content
                : operation.content + '\n\n' + existingContent;

              await fs.writeFile(filePath, updatedContent);
              modifiedFiles.push(filePath);
            } catch {
              failedFiles.push(filePath);
            }
          }

          if (modifiedFiles.length > 0) {
            for (const f of modifiedFiles) {
              if (!filesAffected.includes(f)) {
                filesAffected.push(f);
              }
            }
          }

          operationResults.push({
            operationIndex: i,
            operationId: generateOperationId(),
            kind: 'append_file_multi',
            status: failedFiles.length === 0 ? 'success' : 'failed',
            message: `Appended content to ${modifiedFiles.length} files.`,
            path: operation.directory || '',
          });
          break;
        }

        case 'search_replace_multi': {
          if (workspaceFolders.length === 0) {
            errors.push('No workspace root available for file search.');
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'search_replace_multi',
              status: 'aborted',
              message: 'No workspace root available for file search.',
              path: '',
            });
            continue;
          }

          const workspaceRoot = workspaceFolders[0];
          const searchDirectory = operation.directory
            ? path.resolve(workspaceRoot, operation.directory)
            : path.resolve(workspaceRoot);

          if (!searchDirectory.startsWith(path.resolve(workspaceRoot))) {
            errors.push(`Search directory is outside workspace root: ${operation.directory}`);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'search_replace_multi',
              status: 'failed',
              message: `Search directory is outside workspace root: ${operation.directory}.`,
              path: operation.directory || '',
            });
            continue;
          }

          const srQuery: FileSearchQuery = {
            patterns: operation.patterns,
            excludePatterns: operation.excludePatterns,
            directory: searchDirectory,
            recursive: operation.recursive,
            maxResults: operation.maxResults,
          };

          const matchedFiles = preResolvedMultiFiles.has(i)
            ? preResolvedMultiFiles.get(i)!
            : (await searchFiles(fs, srQuery)).results.map(r => path.resolve(searchDirectory, r.path));

          const modifiedFiles: string[] = [];
          const skippedFiles: string[] = [];
          const failedFiles: string[] = [];

          for (const filePath of matchedFiles) {
            try {
              const content = await fs.readFile(filePath);

              let count = 0;
              let searchIndex = content.indexOf(operation.search);
              while (searchIndex !== -1) {
                count++;
                searchIndex = content.indexOf(operation.search, searchIndex + 1);
              }

              if (count === 0) {
                skippedFiles.push(filePath);
                continue;
              }

              if (count > 1) {
                skippedFiles.push(filePath);
                continue;
              }

              const matchIndex = content.indexOf(operation.search);
              const updatedContent = content.substring(0, matchIndex) + operation.replace + content.substring(matchIndex + operation.search.length);
              await fs.writeFile(filePath, updatedContent);
              modifiedFiles.push(filePath);
            } catch {
              failedFiles.push(filePath);
            }
          }

          if (modifiedFiles.length > 0) {
            for (const f of modifiedFiles) {
              if (!filesAffected.includes(f)) {
                filesAffected.push(f);
              }
            }
          }

          const skipMsg = skippedFiles.length > 0 ? ` Skipped ${skippedFiles.length} files.` : '';
          operationResults.push({
            operationIndex: i,
            operationId: generateOperationId(),
            kind: 'search_replace_multi',
            status: failedFiles.length === 0 ? 'success' : 'failed',
            message: `Patched ${modifiedFiles.length} files.${skipMsg}`,
            path: operation.directory || '',
          });
          break;
        }

        case 'read_file': {
          const result = validateWorkspacePath(operation.path, workspaceFolders);
          if (!result.valid) {
            errors.push(result.error);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'read_file',
              status: 'failed',
              message: result.error,
              path: operation.path,
            });
            continue;
          }

          const resultData = await readFiles(
            fs,
            [result.resolvedPath],
            operation.isImportRead,
            operation.maxDepth,
            operation.excludePatterns,
            operation.importSyntax,
          );
          readResults.set(i, resultData);
          operationResults.push({
            operationIndex: i,
            operationId: generateOperationId(),
            kind: 'read_file',
            status: 'success',
            message: JSON.stringify(resultData),
            path: operation.path,
          });
          break;
        }

        case 'read_files': {
          if (workspaceFolders.length === 0) {
            errors.push('No workspace root available for file read.');
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'read_files',
              status: 'aborted',
              message: 'No workspace root available for file read.',
              path: '',
            });
            continue;
          }

          const workspaceRoot = workspaceFolders[0];
          const searchDirectory = operation.directory
            ? path.resolve(workspaceRoot, operation.directory)
            : path.resolve(workspaceRoot);

          if (!searchDirectory.startsWith(path.resolve(workspaceRoot))) {
            errors.push(`Search directory is outside workspace root: ${operation.directory}`);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'read_files',
              status: 'failed',
              message: `Search directory is outside workspace root: ${operation.directory}.`,
              path: operation.directory || '',
            });
            continue;
          }

          const fileQuery: FileSearchQuery = {
            patterns: operation.patterns,
            excludePatterns: operation.excludePatterns,
            directory: searchDirectory,
            recursive: operation.recursive,
            maxResults: operation.maxResults,
          };

          const searchResponse = await searchFiles(fs, fileQuery);
          const filePaths = searchResponse.results.map(r => path.resolve(searchDirectory, r.path));

          const resultData = await readFiles(
            fs,
            filePaths,
            operation.isImportRead,
            operation.maxDepth,
            operation.excludePatterns,
            operation.importSyntax,
          );
          readResults.set(i, resultData);
          operationResults.push({
            operationIndex: i,
            operationId: generateOperationId(),
            kind: 'read_files',
            status: 'success',
            message: JSON.stringify(resultData),
            path: operation.directory || '',
          });
          break;
        }

        case 'read_directory': {
          const dirResult = validateWorkspacePath(operation.directoryPath, workspaceFolders);
          if (!dirResult.valid) {
            errors.push(dirResult.error);
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'read_directory',
              status: 'failed',
              message: dirResult.error,
              path: operation.directoryPath,
            });
            continue;
          }

          const dirFilePaths = await readDirectoryFiles(
            fs,
            dirResult.resolvedPath,
            operation.recursive,
            operation.excludePatterns,
          );

          const resultData = await readFiles(
            fs,
            dirFilePaths,
            operation.isImportRead,
            operation.maxDepth,
            operation.excludePatterns,
            operation.importSyntax,
          );
          readResults.set(i, resultData);
          operationResults.push({
            operationIndex: i,
            operationId: generateOperationId(),
            kind: 'read_directory',
            status: 'success',
            message: JSON.stringify(resultData),
            path: operation.directoryPath,
          });
          break;
        }

        case 'terminal_interactive': {
          if (!terminalExecutor) {
            errors.push('Terminal executor not available. This operation requires a VS Code environment.');
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'terminal_interactive',
              status: 'failed',
              message: 'Terminal executor not available.',
              path: '',
            });
            continue;
          }

          const termOp = operation as TerminalInteractiveOperation;
          const termResult = await terminalExecutor.execute(termOp.command, termOp.answers, termOp.cwd, (termOp.timeout ?? 120) * 1000);
          operationResults.push({
            operationIndex: i,
            operationId: generateOperationId(),
            kind: 'terminal_interactive',
            status: termResult.success ? 'success' : 'failed',
            message: termResult.success
              ? `Terminal command executed successfully.\nOutput:\n${termResult.output}`
              : `Terminal command failed (exit code: ${termResult.exitCode})\nOutput:\n${termResult.output}`,
            path: '',
          });
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error && err.stack ? `\nStack: ${err.stack}` : '';
      errors.push(`Unexpected error during ${operation.kind}: ${message}${operation.kind === 'extract_structure' ? stack : ''}`);
      operationResults.push({
        operationIndex: i,
              operationId: generateOperationId(),
        kind: operation.kind,
        status: 'failed',
        message: `Unexpected error: ${message}`,
        path: '',
      });
    }
  }

  let result: { success: boolean; message: string; errors: string[]; operationResults: OperationResult[]; sessionId?: string };

  if (extractionResults.length > 0) {
    const allSucceeded = extractionResults.length === operations.filter(o => o.kind === 'extract_structure').length;
    const message = JSON.stringify(extractionResults.map(r => ({
      directoryPath: r.directoryPath,
      depth: r.depth,
      fileCount: r.fileCount,
      directoryCount: r.directoryCount,
      json: r.json,
    })));
    result = { success: allSucceeded, message, errors, operationResults };
  } else if (readResults.size > 0) {
    const readData = Array.from(readResults.entries()).map(([idx, data]) => ({
      operationIndex: idx,
      totalFiles: data.totalFiles,
      totalSize: data.totalSize,
      files: data.files,
    }));
    result = { success: true, message: JSON.stringify(readData), errors, operationResults };
  } else {
    const hasExtractOps = operations.some(o => o.kind === 'extract_structure');
    if (hasExtractOps) {
      const errorMessages = operationResults
        .filter(r => r.kind === 'extract_structure')
        .map(r => r.message)
        .join('; ');
      result = {
        success: false,
        message: 'All extraction operations failed. ' + errorMessages,
        errors,
        operationResults,
      };
    } else {
      const successCount = operationResults.filter(r => r.status === 'success').length;
      const abortedCount = operationResults.filter(r => r.status === 'aborted').length;
      const failedCount = operationResults.filter(r => r.status === 'failed').length;

      let prefix: string;
      if (failedCount === 0 && abortedCount === 0) {
        prefix = 'All operations completed successfully.';
      } else if (failedCount === 0 && abortedCount > 0 && successCount === 0) {
        prefix = 'All operations aborted safely.';
      } else if (failedCount === 0 && abortedCount > 0 && successCount > 0) {
        prefix = 'Some operations completed, some aborted safely.';
      } else if (failedCount > 0 && successCount === 0 && abortedCount === 0) {
        prefix = 'All operations failed.';
      } else {
        prefix = 'Some operations failed.';
      }

      result = { success: failedCount === 0, message: prefix, errors, operationResults };
    }
  }

  if (historyStore && sessionId && preSnapshot) {
    if (existingSessionData) {
      for (const [filePath, content] of existingSessionData.preSnapshot.files) {
        if (!preSnapshot.files.has(filePath)) {
          preSnapshot.files.set(filePath, content);
        }
      }
    }

    const postSnapshot = await createSnapshot(sessionId, 'post', fs, filesAffected, preSnapshot);

    if (existingSessionData) {
      for (const [filePath, diff] of existingSessionData.postSnapshot.files) {
        if (!postSnapshot.files.has(filePath)) {
          postSnapshot.files.set(filePath, diff);
        }
      }
    }

    const mergedOperationResults = existingSessionData
      ? [...existingSessionData.operationResults, ...operationResults]
      : operationResults;

    await recordAndSaveSession(
      operations,
      { success: result.success, message: result.message, errors: result.errors },
      filesAffected,
      originalPrompt || '',
      preSnapshot,
      postSnapshot,
      historyStore,
      mergedOperationResults,
      sessionId,
    );
  }

  return { ...result, sessionId };
}