import path from 'path';
import { FileOperation, TerminalInteractiveOperation, TerminalCommandOperation } from '../types/patch';
import { FileSystem } from '../types/filesystem';
import { validateWorkspacePath } from '../utils/workspacePath';
import { isDangerousCommand, validateTerminalCwd } from '../validation/terminal';
import { BrudAPI } from '../api/index';
import type { BrudError } from '../api/types';
import {
  searchNotFoundError,
  multipleMatchesError,
  fileNotFoundError,
  fileAlreadyExistsError,
  deleteFailedError,
  directoryNotFoundError,
  directoryAlreadyExistsError,
  noWorkspaceError,
  pathOutsideWorkspaceError,
  terminalUnavailableError,
  dangerousCommandError,
  invalidCwdError,
  toolNotFoundError,
  unexpectedError,
  noValidOperationsError,
  validationError,
} from '../api/errors';
import { extractDirectoryStructure } from '../structure-extractor';
import { extractCodebaseMetadata } from '../metadata-extractor';
import { searchFiles } from '../search/fileSearch';
import { isGlobPattern } from '../search/globMatcher.js';
import { readFiles, readDirectoryFiles } from '../read-engine/index.js';
import type { FileSearchQuery } from '../search/types';
import type { HistoryStore, SnapshotData } from '../history/index.js';
import { createSnapshot, recordAndSaveSession, generateSessionId, getNextSequenceNumber } from '../history/index.js';
import type { TerminalExecutor, GroupResult, ConditionalCommand } from '../terminal/types';
import { globalToolRegistry } from '../tool-registry/registry.js';
import { initializeToolRegistry } from '../tool-registry/init.js';

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
  fileResults?: {
    modified: string[];
    skipped: string[];
    failed: string[];
  };
  data?: { command: string; output: string; exitCode: number | null; duration: number; success: boolean } | Array<{ command: string; output: string; exitCode: number | null; duration: number; success: boolean }>;
}

export interface FileOperationResult {
  success: boolean;
  message: string;
  errors: BrudError[];
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
    return { success: false, message: 'No operations to execute.', errors: [noValidOperationsError()], operationResults: [], sessionId: undefined };
  }

  const errors: BrudError[] = [];
  const operationResults: OperationResult[] = [];
  const extractionResults: { directoryPath: string; depth: number; json: string; fileCount: number; directoryCount: number }[] = [];

  let filesAffected: string[] = [];
  let sessionId: string | undefined;
  let preSnapshot: SnapshotData | undefined;
  const preResolvedMultiFiles: Map<number, string[]> = new Map();
  const readResults: Map<number, { files: Array<{ path: string; content: string; size: number; isImported?: boolean; importedFrom?: string }>; totalFiles: number; totalSize: number }> = new Map();
  let metadataResult: string | undefined;
  const searchResults: Map<number, string> = new Map();
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
          const wsResult = BrudAPI.validate.workspace(workspaceFolders);
          if (!wsResult.success) {
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
            errors.push(validationError(result.error));
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

          const matchResult = await BrudAPI.validate.singleMatch(fs, filePath, operation.search);
          if (!matchResult.success) {
            if (matchResult.code === 'SEARCH_NOT_FOUND') {
              errors.push(searchNotFoundError(operation.path, operation.search));
              operationResults.push({
                operationIndex: i,
                operationId: generateOperationId(),
                kind: 'search_replace',
                status: 'aborted',
                message: searchNotFoundError(operation.path, operation.search).details,
                path: operation.path,
              });
            } else {
              errors.push(multipleMatchesError(operation.path));
              operationResults.push({
                operationIndex: i,
                operationId: generateOperationId(),
                kind: 'search_replace',
                status: 'aborted',
                message: multipleMatchesError(operation.path).details,
                path: operation.path,
              });
            }
            continue;
          }

          const content = await fs.readFile(filePath);

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
            errors.push(validationError(result.error));
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

          const fileNotExistsResult = await BrudAPI.validate.fileNotExists(fs, filePath);
          if (!fileNotExistsResult.success) {
            errors.push(fileAlreadyExistsError(operation.path));
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'create_file',
              status: 'aborted',
              message: fileAlreadyExistsError(operation.path).details,
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
            errors.push(validationError(result.error));
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

          const fileExistsResult = await BrudAPI.validate.fileExists(fs, filePath);
          if (!fileExistsResult.success) {
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
            errors.push(deleteFailedError(operation.path));
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'delete_file',
              status: 'failed',
              message: deleteFailedError(operation.path).details,
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
            errors.push(validationError(fromResult.error));
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
            errors.push(validationError(toResult.error));
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

          const sourceExistsResult = await BrudAPI.validate.fileExists(fs, sourcePath);
          if (!sourceExistsResult.success) {
            errors.push(fileNotFoundError(operation.from));
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'rename_file',
              status: 'aborted',
              message: fileNotFoundError(operation.from).details,
              path: operation.from,
            });
            continue;
          }

          const targetNotExistsResult = await BrudAPI.validate.fileNotExists(fs, targetPath);
          if (!targetNotExistsResult.success) {
            errors.push(fileAlreadyExistsError(operation.to));
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'rename_file',
              status: 'aborted',
              message: fileAlreadyExistsError(operation.to).details,
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
            errors.push(validationError(fromResult.error));
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
            errors.push(validationError(toResult.error));
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

          const sourceExistsResult = await BrudAPI.validate.fileExists(fs, sourcePath);
          if (!sourceExistsResult.success) {
            errors.push(fileNotFoundError(operation.from));
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'move_file',
              status: 'aborted',
              message: fileNotFoundError(operation.from).details,
              path: operation.from,
            });
            continue;
          }

          const targetNotExistsResult = await BrudAPI.validate.fileNotExists(fs, targetPath);
          if (!targetNotExistsResult.success) {
            errors.push(fileAlreadyExistsError(operation.to));
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'move_file',
              status: 'aborted',
              message: fileAlreadyExistsError(operation.to).details,
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
            errors.push(validationError(fromResult.error));
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
            errors.push(validationError(toResult.error));
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

          const sourceExistsResult = await BrudAPI.validate.fileExists(fs, sourcePath);
          if (!sourceExistsResult.success) {
            errors.push(fileNotFoundError(operation.from));
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'copy_file',
              status: 'aborted',
              message: fileNotFoundError(operation.from).details,
              path: operation.from,
            });
            continue;
          }

          const targetNotExistsResult = await BrudAPI.validate.fileNotExists(fs, targetPath);
          if (!targetNotExistsResult.success) {
            errors.push(fileAlreadyExistsError(operation.to));
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'copy_file',
              status: 'aborted',
              message: fileAlreadyExistsError(operation.to).details,
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
            errors.push(validationError(result.error));
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
          const fileExistsResult = await BrudAPI.validate.fileExists(fs, filePath);
          if (!fileExistsResult.success) {
            errors.push(fileNotFoundError(operation.path));
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'append_file',
              status: 'aborted',
              message: fileNotFoundError(operation.path).details,
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
            errors.push(validationError(result.error));
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
              errors.push(validationError(fileResult.error));
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
            errors.push(validationError(result.error));
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

          const dirExistsResult = await BrudAPI.validate.directoryExists(fs, directoryPath);
          if (!dirExistsResult.success) {
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
            errors.push(deleteFailedError(operation.directoryPath));
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'delete_directory',
              status: 'failed',
              message: deleteFailedError(operation.directoryPath).details,
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
            errors.push(validationError(fromResult.error));
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
            errors.push(validationError(toResult.error));
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

          const sourceExistsResult = await BrudAPI.validate.directoryExists(fs, sourcePath);
          if (!sourceExistsResult.success) {
            errors.push(directoryNotFoundError(operation.from));
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'move_directory',
              status: 'aborted',
              message: directoryNotFoundError(operation.from).details,
              path: operation.from,
            });
            continue;
          }

          const targetNotExistsResult = await BrudAPI.validate.directoryNotExists(fs, targetPath);
          if (!targetNotExistsResult.success) {
            errors.push(directoryAlreadyExistsError(operation.to));
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'move_directory',
              status: 'aborted',
              message: directoryAlreadyExistsError(operation.to).details,
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
            errors.push(validationError(result.error));
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
          const dirExistsResult = await BrudAPI.validate.directoryExists(fs, directoryPath);
          if (!dirExistsResult.success) {
            errors.push(directoryNotFoundError(operation.directoryPath));
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'extract_structure',
              status: 'aborted',
              message: directoryNotFoundError(operation.directoryPath).details,
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
          const wsResult = BrudAPI.validate.workspace(workspaceFolders);
          if (!wsResult.success) {
            errors.push(noWorkspaceError());
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'codebase_metadata',
              status: 'aborted',
              message: noWorkspaceError().details,
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
          metadataResult = message;
          break;
        }

        case 'search_files': {
          const wsResult = BrudAPI.validate.workspace(workspaceFolders);
          if (!wsResult.success) {
            errors.push(noWorkspaceError());
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'search_files',
              status: 'aborted',
              message: noWorkspaceError().details,
              path: '',
            });
            continue;
          }

          const workspaceRoot = workspaceFolders[0];
          const searchDirectory = operation.directory
            ? path.resolve(workspaceRoot, operation.directory)
            : path.resolve(workspaceRoot);

          if (!searchDirectory.startsWith(path.resolve(workspaceRoot))) {
            errors.push(pathOutsideWorkspaceError(operation.directory || ''));
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
          searchResults.set(i, resultJson);
          break;
        }

        case 'append_file_multi': {
          const wsResult = BrudAPI.validate.workspace(workspaceFolders);
          if (!wsResult.success) {
            errors.push(noWorkspaceError());
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'append_file_multi',
              status: 'aborted',
              message: noWorkspaceError().details,
              path: '',
            });
            continue;
          }

          const workspaceRoot = workspaceFolders[0];
          const searchDirectory = operation.directory
            ? path.resolve(workspaceRoot, operation.directory)
            : path.resolve(workspaceRoot);

          if (!searchDirectory.startsWith(path.resolve(workspaceRoot))) {
            errors.push(pathOutsideWorkspaceError(operation.directory || ''));
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
            fileResults: {
              modified: modifiedFiles,
              skipped: skippedFiles,
              failed: failedFiles,
            },
          });
          break;
        }

        case 'search_replace_multi': {
          const wsResult = BrudAPI.validate.workspace(workspaceFolders);
          if (!wsResult.success) {
            errors.push(noWorkspaceError());
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'search_replace_multi',
              status: 'aborted',
              message: noWorkspaceError().details,
              path: '',
            });
            continue;
          }

          const workspaceRoot = workspaceFolders[0];
          const searchDirectory = operation.directory
            ? path.resolve(workspaceRoot, operation.directory)
            : path.resolve(workspaceRoot);

          if (!searchDirectory.startsWith(path.resolve(workspaceRoot))) {
            errors.push(pathOutsideWorkspaceError(operation.directory || ''));
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

              const matchResult = await BrudAPI.validate.singleMatch(fs, filePath, operation.search);
              if (!matchResult.success) {
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
            fileResults: {
              modified: modifiedFiles,
              skipped: skippedFiles,
              failed: failedFiles,
            },
          });
          break;
        }

        case 'read_file': {
          const result = validateWorkspacePath(operation.path, workspaceFolders);
          if (!result.valid) {
            errors.push(validationError(result.error));
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
          const wsResult = BrudAPI.validate.workspace(workspaceFolders);
          if (!wsResult.success) {
            errors.push(noWorkspaceError());
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'read_files',
              status: 'aborted',
              message: noWorkspaceError().details,
              path: '',
            });
            continue;
          }

          const workspaceRoot = workspaceFolders[0];
          const searchDirectory = operation.directory
            ? path.resolve(workspaceRoot, operation.directory)
            : path.resolve(workspaceRoot);

          if (!searchDirectory.startsWith(path.resolve(workspaceRoot))) {
            errors.push(pathOutsideWorkspaceError(operation.directory || ''));
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

          const patterns = operation.recursive
            ? operation.patterns.map(p => isGlobPattern(p) && !p.includes('**') ? `**/${p}` : p)
            : operation.patterns;

          const fileQuery: FileSearchQuery = {
            patterns,
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
            errors.push(validationError(dirResult.error));
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
            errors.push(terminalUnavailableError());
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'terminal_interactive',
              status: 'failed',
              message: terminalUnavailableError().details,
              path: '',
            });
            continue;
          }

          const termOp = operation as TerminalInteractiveOperation;
          if (isDangerousCommand(termOp.command)) {
            errors.push(dangerousCommandError(termOp.command));
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'terminal_interactive',
              status: 'failed',
              message: dangerousCommandError(termOp.command).details,
              path: '',
            });
            continue;
          }
          const cwdValidation = validateTerminalCwd(termOp.cwd, workspaceFolders);
          if (!cwdValidation.valid) {
            errors.push(invalidCwdError(termOp.cwd || ''));
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'terminal_interactive',
              status: 'failed',
message: invalidCwdError(termOp.cwd || '').details,
              path: '',
            });
            continue;
          }
          const termResult = await terminalExecutor.execute(termOp.command, termOp.answers, cwdValidation.resolvedCwd, (termOp.timeout ?? 120) * 1000);
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

        case 'get_tool_info': {
          initializeToolRegistry();
          const toolOp = operation as import('../types/patch.js').GetToolInfoOperation;
          if (!toolOp.toolKind) {
            const allTools = globalToolRegistry.getAllTools();
            const toolList = allTools.map(t => `${t.kind} - ${t.name}: ${t.description}`).join('\n');
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'get_tool_info',
              status: 'success',
              message: `Available tools:\n${toolList}`,
              path: '',
            });
          } else {
            const doc = globalToolRegistry.getTool(toolOp.toolKind);
            if (!doc) {
              errors.push(toolNotFoundError(toolOp.toolKind));
              operationResults.push({
                operationIndex: i,
                operationId: generateOperationId(),
                kind: 'get_tool_info',
                status: 'failed',
                message: toolNotFoundError(toolOp.toolKind).details,
                path: '',
              });
            } else {
              const params = doc.parameters.map(p =>
                `  - ${p.name} (${p.type})${p.required ? ' [required]' : ''}: ${p.description}${p.default ? ` (default: ${p.default})` : ''}`
              ).join('\n');
              const rules = doc.rules.map(r => `  - ${r}`).join('\n');
              operationResults.push({
                operationIndex: i,
                operationId: generateOperationId(),
                kind: 'get_tool_info',
                status: 'success',
                message: `Tool: ${doc.name}\nMarker: ${doc.marker}\nDescription: ${doc.description}\n\nParameters:\n${params}\n\nRules:\n${rules}\n\nExample:\n${doc.example}`,
                path: '',
              });
            }
          }
          break;
        }

        case 'terminal_command': {
          if (!terminalExecutor) {
            errors.push(terminalUnavailableError());
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'terminal_command',
              status: 'failed',
              message: terminalUnavailableError().details,
              path: '',
            });
            continue;
          }

          const termCmdOp = operation as TerminalCommandOperation;

          if (termCmdOp.commands && termCmdOp.commands.length > 0) {
            let hasDangerous = false;
            for (const cmd of termCmdOp.commands) {
              if (isDangerousCommand(cmd)) {
                errors.push(dangerousCommandError(cmd));
                operationResults.push({
                  operationIndex: i,
                  operationId: generateOperationId(),
                  kind: 'terminal_command',
                  status: 'failed',
                  message: dangerousCommandError(cmd).details,
                  path: '',
                });
                hasDangerous = true;
                break;
              }
            }
            if (hasDangerous) {
              continue;
            }
            const cwdValidation = validateTerminalCwd(termCmdOp.cwd, workspaceFolders);
            if (!cwdValidation.valid) {
              errors.push(invalidCwdError(termCmdOp.cwd || ''));
              operationResults.push({
                operationIndex: i,
                operationId: generateOperationId(),
                kind: 'terminal_command',
                status: 'failed',
message: invalidCwdError(termCmdOp.cwd || '').details,
                path: '',
              });
              continue;
            }
            const termCmdTimeout = (termCmdOp.timeout ?? 120) * 1000;
            let groupResult: GroupResult;
            if (termCmdOp.mode === 'parallel') {
              groupResult = await terminalExecutor.executeParallel(termCmdOp.commands, cwdValidation.resolvedCwd, termCmdTimeout, termCmdOp.env);
            } else {
              groupResult = await terminalExecutor.executeSequential(termCmdOp.commands, cwdValidation.resolvedCwd, termCmdTimeout, termCmdOp.env, termCmdOp.stopOnFailure);
            }
            const succeeded = groupResult.results.filter(r => r.success).length;
            const failed = groupResult.results.filter(r => !r.success).length;
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'terminal_command',
              status: groupResult.success ? 'success' : 'failed',
              message: `Executed ${groupResult.results.length} commands. ${succeeded} succeeded, ${failed} failed.`,
              path: '',
              data: groupResult.results.map(r => ({
                command: r.command,
                output: r.output,
                exitCode: r.exitCode,
                duration: r.duration,
                success: r.success,
              })),
            });
            break;
          }

          if (isDangerousCommand(termCmdOp.command)) {
            errors.push(dangerousCommandError(termCmdOp.command));
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'terminal_command',
              status: 'failed',
              message: dangerousCommandError(termCmdOp.command).details,
              path: '',
            });
            continue;
          }
          const cwdValidation = validateTerminalCwd(termCmdOp.cwd, workspaceFolders);
          if (!cwdValidation.valid) {
            errors.push(invalidCwdError(termCmdOp.cwd || ''));
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'terminal_command',
              status: 'failed',
message: invalidCwdError(termCmdOp.cwd || '').details,
              path: '',
            });
            continue;
          }
          const termCmdTimeout = (termCmdOp.timeout ?? 120) * 1000;
          if (termCmdOp.onSuccess || termCmdOp.onFailure) {
            const conditional: ConditionalCommand = {
              command: termCmdOp.command,
              onSuccess: termCmdOp.onSuccess,
              onFailure: termCmdOp.onFailure,
            };
            const groupResult = await terminalExecutor.executeConditional(conditional, cwdValidation.resolvedCwd, termCmdTimeout, termCmdOp.env);
            const succeeded = groupResult.results.filter(r => r.success).length;
            const failed = groupResult.results.filter(r => !r.success).length;
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'terminal_command',
              status: groupResult.success ? 'success' : 'failed',
              message: `Executed conditional command. ${succeeded} succeeded, ${failed} failed.`,
              path: '',
              data: groupResult.results.map(r => ({
                command: r.command,
                output: r.output,
                exitCode: r.exitCode,
                duration: r.duration,
                success: r.success,
              })),
            });
            break;
          }
          const termCmdResult = await terminalExecutor.executeCommand(termCmdOp.command, cwdValidation.resolvedCwd, termCmdTimeout, termCmdOp.env);
          operationResults.push({
            operationIndex: i,
            operationId: generateOperationId(),
            kind: 'terminal_command',
            status: termCmdResult.success ? 'success' : 'failed',
            message: termCmdResult.success
              ? `Terminal command executed successfully.\nOutput:\n${termCmdResult.output}`
              : `Terminal command failed (exit code: ${termCmdResult.exitCode})\nOutput:\n${termCmdResult.output}`,
            path: '',
            data: {
              command: termCmdOp.command,
              output: termCmdResult.output,
              exitCode: termCmdResult.exitCode,
              duration: termCmdResult.duration,
              success: termCmdResult.success,
            },
          });
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error && err.stack ? `\nStack: ${err.stack}` : '';
      errors.push(unexpectedError(operation.kind, message + (operation.kind === 'extract_structure' ? stack : '')));
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

  let result: { success: boolean; message: string; errors: BrudError[]; operationResults: OperationResult[]; sessionId?: string };

  const combined: any = {};

  if (extractionResults.length > 0) {
    combined.extractionResults = extractionResults.map(r => ({
      directoryPath: r.directoryPath,
      depth: r.depth,
      fileCount: r.fileCount,
      directoryCount: r.directoryCount,
      json: r.json,
    }));
  }

  if (readResults.size > 0) {
    combined.readResults = Array.from(readResults.entries()).map(([opIndex, data]) => ({
      operationIndex: opIndex,
      files: data.files,
      totalFiles: data.totalFiles,
      totalSize: data.totalSize,
    }));
  }

  if (metadataResult) {
    combined.codebase_metadata = JSON.parse(metadataResult);
  }

  if (searchResults.size > 0) {
    const searchArray = Array.from(searchResults.entries()).map(([opIndex, json]) => ({
      operationIndex: opIndex,
      results: JSON.parse(json)
    }));
    combined.search_results = searchArray;
  }

  if (Object.keys(combined).length > 0) {
    result = {
      success: true,
      message: JSON.stringify(combined),
      operationResults,
      errors: [],
      sessionId,
    };
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