import path from 'path';
import { FileOperation, SessionMetadata, TerminalInteractiveOperation, TerminalCommandOperation } from '../types/patch';
import { FileSystem } from '../types/filesystem';
import { createPathCache, isWithinWorkspaceFolder } from '../utils/workspacePath';
import { isDangerousCommand, validateTerminalCommand, validateTerminalCwd } from '../validation/terminal';
import { BrudAPI, BrudError as BrudErrorClass } from '../api/index';
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
  cwdEscapeError,
  dynamicPathError,
  toolNotFoundError,
  unexpectedError,
  noValidOperationsError,
  validationError,
  toolDisabledError,
  executionFailedError,
  commandFailedError,
  isBrudError,
} from '../api/errors';
import type { BrudSettings } from '../settings/types';
import { DEFAULT_SETTINGS } from '../settings/types';
import { extractDirectoryStructure } from '../structure-extractor';
import { extractCodebaseMetadata } from '../metadata-extractor';
import { searchFiles } from '../search/fileSearch';
import { isGlobPattern } from '../search/globMatcher.js';
import { readFiles, readDirectoryFiles } from '../read-engine/index.js';
import type { ReadResult } from '../read-engine/index.js';
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
  status: 'success' | 'aborted' | 'failed' | 'interrupted';
  message: string;
  code?: string;
  details?: string;
  path: string;
  from?: string;
  to?: string;
  directoryPath?: string;
  files?: string[];
  title?: string;
  description?: string;
  fileResults?: {
    modified: string[];
    skipped: string[];
    failed: string[];
    fileErrors?: Array<{ path: string; code?: string; details?: string }>;
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

function summarizeReadResult(operationIndex: number, data: ReadResult): string {
  const skipped = data.skips?.length ?? 0;
  const truncated = data.truncated ? 'yes' : 'no';
  const limitHit = data.limitHit ? `, limit=${data.limitHit}` : '';
  return `Read summary [operation ${operationIndex}]: delivered=${data.totalFiles} file(s), bytes=${data.totalSize}, skipped=${skipped}, truncated=${truncated}${limitHit}`;
}



function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getOperationTargetPath(operation: FileOperation): string {
  if ('directoryPath' in operation && typeof operation.directoryPath === 'string') {
    return operation.directoryPath;
  }
  if ('path' in operation && typeof operation.path === 'string') {
    return operation.path;
  }
  if ('from' in operation && typeof operation.from === 'string') {
    return operation.from;
  }
  if ('directory' in operation && typeof operation.directory === 'string' && operation.directory.length > 0) {
    return operation.directory;
  }
  if ('command' in operation && typeof operation.command === 'string') {
    return operation.command;
  }
  if ('commands' in operation) {
    const commands = (operation as { commands?: unknown }).commands;
    if (Array.isArray(commands) && typeof commands[0] === 'string') {
      return commands[0];
    }
  }
  if ('toolKind' in operation && typeof operation.toolKind === 'string') {
    return operation.toolKind;
  }
  if ('patterns' in operation) {
    const patterns = (operation as { patterns?: unknown }).patterns;
    if (Array.isArray(patterns)) {
      const joined = patterns.filter((pattern): pattern is string => typeof pattern === 'string').join(', ');
      if (joined.length > 0) {
        return joined;
      }
    }
  }
  return '';
}

function getOperationSecondaryTargetPath(operation: FileOperation): string | undefined {
  if ('to' in operation && typeof operation.to === 'string') {
    return operation.to;
  }
  return undefined;
}

interface OperationFailureOptions {
  status?: 'failed' | 'aborted';
  message?: string;
  path?: string;
  to?: string;
  data?: OperationResult['data'];
}

function recordOperationFailure(
  operationResults: OperationResult[],
  errors: BrudError[],
  operationIndex: number,
  operation: FileOperation,
  error: BrudError,
  options: OperationFailureOptions = {},
): void {
  errors.push(error);

  const targetPath = options.path ?? getOperationTargetPath(operation);
  const secondaryPath = options.to ?? getOperationSecondaryTargetPath(operation);

  operationResults.push({
    operationIndex,
    operationId: generateOperationId(),
    kind: operation.kind,
    status: options.status ?? 'failed',
    message: options.message ?? error.details,
    ...(error.code ? { code: error.code } : {}),
    ...(error.details ? { details: error.details } : {}),
    path: targetPath,
    ...(secondaryPath ? { to: secondaryPath } : {}),
    ...(options.data !== undefined ? { data: options.data } : {}),
  });
}

export async function executeFileOperations(
  operations: FileOperation[],
  fs: FileSystem,
  workspaceFolders: string[],
  historyStore?: HistoryStore,
  originalPrompt?: string,
  terminalExecutor?: TerminalExecutor,
  sessionIdOverride?: string,
  sessionMetadata?: SessionMetadata,
  settings: BrudSettings = DEFAULT_SETTINGS,
  signal?: AbortSignal,
): Promise<FileOperationResult> {
  if (operations.length === 0) {
    return { success: false, message: 'No operations to execute.', errors: [noValidOperationsError()], operationResults: [], sessionId: undefined };
  }

  const errors: BrudError[] = [];
  const pathCache = createPathCache();

  function validatePath(
    inputPath: string,
    folders: string[],
  ): { valid: true; resolvedPath: string } | { valid: false; error: string; brudError: BrudError } {
    if (!settings.workspaceBoundaryEnabled) {
      const base = folders.length > 0 ? path.resolve(folders[0]) : process.cwd();
      return { valid: true, resolvedPath: path.resolve(base, inputPath) };
    }
    const result = BrudAPI.validate.path(inputPath, folders, { cache: pathCache });
    if (!result.success) {
      const brudError = new BrudErrorClass({
        code: result.code ?? 'VALIDATION_ERROR',
        friendly: result.friendly ?? 'Validation failed.',
        details: result.details ?? result.friendly ?? 'Validation failed.',
        path: inputPath,
      });
      return { valid: false, error: brudError.friendly, brudError };
    }
    const data = result.data as { resolvedPath?: string } | undefined;
    return { valid: true, resolvedPath: data?.resolvedPath ?? path.resolve(inputPath) };
  }
  const operationResults: OperationResult[] = [];
  const extractionResults: { directoryPath: string; depth: number; json: string; fileCount: number; directoryCount: number }[] = [];

  let filesAffected: string[] = [];
  let sessionId: string | undefined;
  let preSnapshot: SnapshotData | undefined;
  const preResolvedMultiFiles: Map<number, string[]> = new Map();
  const readResults: Map<number, ReadResult> = new Map();
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
          const result = validatePath(operation.path, workspaceFolders);
          if (result.valid && !filesAffected.includes(result.resolvedPath)) {
            filesAffected.push(result.resolvedPath);
          }
          break;
        }
        case 'rename_file':
        case 'move_file':
        case 'copy_file': {
          const fromResult = validatePath(operation.from, workspaceFolders);
          if (fromResult.valid && !filesAffected.includes(fromResult.resolvedPath)) {
            filesAffected.push(fromResult.resolvedPath);
          }
          const toResult = validatePath(operation.to, workspaceFolders);
          if (toResult.valid && !filesAffected.includes(toResult.resolvedPath)) {
            filesAffected.push(toResult.resolvedPath);
          }
          break;
        }
        case 'append_file_multi':
        case 'search_replace_multi': {
          if (settings.workspaceBoundaryEnabled) {
            const wsResult = BrudAPI.validate.workspace(workspaceFolders);
            if (!wsResult.success) {
              break;
            }
          }
          const workspaceRoot = workspaceFolders[0];
          const searchDirectory = operation.directory
            ? path.resolve(workspaceRoot, operation.directory)
            : path.resolve(workspaceRoot);
          if (settings.workspaceBoundaryEnabled && !isWithinWorkspaceFolder(searchDirectory, workspaceRoot)) {
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

    if (signal?.aborted) {
      for (let j = i; j < operations.length; j++) {
        const pending = operations[j];
        const pendingPath = getOperationTargetPath(pending);
        operationResults.push({
          operationIndex: j,
          operationId: generateOperationId(),
          kind: pending.kind,
          status: 'interrupted',
          message: 'Operation was interrupted before it started.',
          path: pendingPath || '',
        });
      }
      break;
    }

    const toolEnabled = settings.toolAllowList[operation.kind];
    if (toolEnabled === false) {
      const disabledError = toolDisabledError(operation.kind);
      recordOperationFailure(operationResults, errors, i, operation, disabledError, {
        message: disabledError.friendly,
      });
      continue;
    }

    try {
      switch (operation.kind) {
        case 'search_replace': {
          const result = validatePath(operation.path, workspaceFolders);
          if (!result.valid) {
            recordOperationFailure(operationResults, errors, i, operation, result.brudError, {
              message: result.error,
              path: operation.path,
            });
            continue;
          }

          const filePath = result.resolvedPath;

          const cleanSearch = operation.search.replace(/^\s*\d+\s*\|\s?/gm, '');
          const matchResult = await BrudAPI.validate.singleMatch(fs, filePath, cleanSearch);
          if (!matchResult.success) {
            if (matchResult.code === 'SEARCH_NOT_FOUND') {
              recordOperationFailure(operationResults, errors, i, operation, searchNotFoundError(operation.path, operation.search), {
                status: 'aborted',
                path: operation.path,
              });
            } else {
              recordOperationFailure(operationResults, errors, i, operation, multipleMatchesError(operation.path), {
                status: 'aborted',
                path: operation.path,
              });
            }
            continue;
          }

          const content = await fs.readFile(filePath);

          const matchIndex = content.indexOf(cleanSearch);
          const updatedContent = content.substring(0, matchIndex) + operation.replace + content.substring(matchIndex + cleanSearch.length);
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
          const result = validatePath(operation.path, workspaceFolders);
          if (!result.valid) {
            recordOperationFailure(operationResults, errors, i, operation, result.brudError, {
              message: result.error,
              path: operation.path,
            });
            continue;
          }

          const filePath = result.resolvedPath;

          const fileNotExistsResult = await BrudAPI.validate.fileNotExists(fs, filePath);
          if (!fileNotExistsResult.success) {
            recordOperationFailure(operationResults, errors, i, operation, fileAlreadyExistsError(operation.path), {
              status: 'aborted',
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
          const result = validatePath(operation.path, workspaceFolders);
          if (!result.valid) {
            recordOperationFailure(operationResults, errors, i, operation, result.brudError, {
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
            recordOperationFailure(operationResults, errors, i, operation, deleteFailedError(operation.path), {
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
          const fromResult = validatePath(operation.from, workspaceFolders);
          if (!fromResult.valid) {
            recordOperationFailure(operationResults, errors, i, operation, fromResult.brudError, {
              message: fromResult.error,
              path: operation.from,
            });
            continue;
          }

          const toResult = validatePath(operation.to, workspaceFolders);
          if (!toResult.valid) {
            recordOperationFailure(operationResults, errors, i, operation, toResult.brudError, {
              message: toResult.error,
              path: operation.to,
            });
            continue;
          }

          const sourcePath = fromResult.resolvedPath;
          const targetPath = toResult.resolvedPath;

          const sourceExistsResult = await BrudAPI.validate.fileExists(fs, sourcePath);
          if (!sourceExistsResult.success) {
            recordOperationFailure(operationResults, errors, i, operation, fileNotFoundError(operation.from), {
              status: 'aborted',
              path: operation.from,
            });
            continue;
          }

          const targetNotExistsResult = await BrudAPI.validate.fileNotExists(fs, targetPath);
          if (!targetNotExistsResult.success) {
            recordOperationFailure(operationResults, errors, i, operation, fileAlreadyExistsError(operation.to), {
              status: 'aborted',
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
          const fromResult = validatePath(operation.from, workspaceFolders);
          if (!fromResult.valid) {
            recordOperationFailure(operationResults, errors, i, operation, fromResult.brudError, {
              message: fromResult.error,
              path: operation.from,
            });
            continue;
          }

          const toResult = validatePath(operation.to, workspaceFolders);
          if (!toResult.valid) {
            recordOperationFailure(operationResults, errors, i, operation, toResult.brudError, {
              message: toResult.error,
              path: operation.to,
            });
            continue;
          }

          const sourcePath = fromResult.resolvedPath;
          const targetPath = toResult.resolvedPath;

          const sourceExistsResult = await BrudAPI.validate.fileExists(fs, sourcePath);
          if (!sourceExistsResult.success) {
            recordOperationFailure(operationResults, errors, i, operation, fileNotFoundError(operation.from), {
              status: 'aborted',
              path: operation.from,
            });
            continue;
          }

          const targetNotExistsResult = await BrudAPI.validate.fileNotExists(fs, targetPath);
          if (!targetNotExistsResult.success) {
            recordOperationFailure(operationResults, errors, i, operation, fileAlreadyExistsError(operation.to), {
              status: 'aborted',
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
          const fromResult = validatePath(operation.from, workspaceFolders);
          if (!fromResult.valid) {
            recordOperationFailure(operationResults, errors, i, operation, fromResult.brudError, {
              message: fromResult.error,
              path: operation.from,
            });
            continue;
          }

          const toResult = validatePath(operation.to, workspaceFolders);
          if (!toResult.valid) {
            recordOperationFailure(operationResults, errors, i, operation, toResult.brudError, {
              message: toResult.error,
              path: operation.to,
            });
            continue;
          }

          const sourcePath = fromResult.resolvedPath;
          const targetPath = toResult.resolvedPath;

          const sourceExistsResult = await BrudAPI.validate.fileExists(fs, sourcePath);
          if (!sourceExistsResult.success) {
            recordOperationFailure(operationResults, errors, i, operation, fileNotFoundError(operation.from), {
              status: 'aborted',
              path: operation.from,
            });
            continue;
          }

          const targetNotExistsResult = await BrudAPI.validate.fileNotExists(fs, targetPath);
          if (!targetNotExistsResult.success) {
            recordOperationFailure(operationResults, errors, i, operation, fileAlreadyExistsError(operation.to), {
              status: 'aborted',
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
          const result = validatePath(operation.path, workspaceFolders);
          if (!result.valid) {
            recordOperationFailure(operationResults, errors, i, operation, result.brudError, {
              message: result.error,
              path: operation.path,
            });
            continue;
          }

          const filePath = result.resolvedPath;

          let existingContent = '';
          const fileExistsResult = await BrudAPI.validate.fileExists(fs, filePath);
          if (!fileExistsResult.success) {
            recordOperationFailure(operationResults, errors, i, operation, fileNotFoundError(operation.path), {
              status: 'aborted',
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
          const result = validatePath(operation.directoryPath, workspaceFolders);
          if (!result.valid) {
            recordOperationFailure(operationResults, errors, i, operation, result.brudError, {
              message: result.error,
              path: operation.directoryPath,
            });
            continue;
          }

          const directoryPath = result.resolvedPath;
          await fs.createDirectory(directoryPath);

          for (const file of operation.files) {
            const fileResult = validatePath(path.join(operation.directoryPath, file), workspaceFolders);
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
          const result = validatePath(operation.directoryPath, workspaceFolders);
          if (!result.valid) {
            recordOperationFailure(operationResults, errors, i, operation, result.brudError, {
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
            recordOperationFailure(operationResults, errors, i, operation, deleteFailedError(operation.directoryPath), {
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
          const fromResult = validatePath(operation.from, workspaceFolders);
          if (!fromResult.valid) {
            recordOperationFailure(operationResults, errors, i, operation, fromResult.brudError, {
              message: fromResult.error,
              path: operation.from,
            });
            continue;
          }

          const toResult = validatePath(operation.to, workspaceFolders);
          if (!toResult.valid) {
            recordOperationFailure(operationResults, errors, i, operation, toResult.brudError, {
              message: toResult.error,
              path: operation.to,
            });
            continue;
          }

          const sourcePath = fromResult.resolvedPath;
          const targetPath = toResult.resolvedPath;

          const sourceExistsResult = await BrudAPI.validate.directoryExists(fs, sourcePath);
          if (!sourceExistsResult.success) {
            recordOperationFailure(operationResults, errors, i, operation, directoryNotFoundError(operation.from), {
              status: 'aborted',
              path: operation.from,
            });
            continue;
          }

          const targetNotExistsResult = await BrudAPI.validate.directoryNotExists(fs, targetPath);
          if (!targetNotExistsResult.success) {
            recordOperationFailure(operationResults, errors, i, operation, directoryAlreadyExistsError(operation.to), {
              status: 'aborted',
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
          const result = validatePath(operation.directoryPath, workspaceFolders);
          console.error('DEBUG extract_structure: validateWorkspacePath result=' + JSON.stringify(result));
          if (!result.valid) {
            recordOperationFailure(operationResults, errors, i, operation, result.brudError, {
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
            recordOperationFailure(operationResults, errors, i, operation, directoryNotFoundError(operation.directoryPath), {
              status: 'aborted',
              path: operation.directoryPath,
            });
            continue;
          }

          const json = await extractDirectoryStructure(fs, directoryPath, operation.depth);
          let parsed: Record<string, unknown> = {};
          try {
            const value: unknown = JSON.parse(json);
            if (isRecord(value)) {
              parsed = value;
            }
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
          if (settings.workspaceBoundaryEnabled) {
            const wsResult = BrudAPI.validate.workspace(workspaceFolders);
            if (!wsResult.success) {
              recordOperationFailure(operationResults, errors, i, operation, noWorkspaceError(), {
                status: 'aborted',
                path: workspaceFolders[0] ?? '',
              });
              continue;
            }
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
          if (settings.workspaceBoundaryEnabled) {
            const wsResult = BrudAPI.validate.workspace(workspaceFolders);
            if (!wsResult.success) {
              recordOperationFailure(operationResults, errors, i, operation, noWorkspaceError(), {
                status: 'aborted',
              });
              continue;
            }
          }

          const workspaceRoot = workspaceFolders[0];
          const searchDirectory = operation.directory
            ? path.resolve(workspaceRoot, operation.directory)
            : path.resolve(workspaceRoot);

          if (settings.workspaceBoundaryEnabled && !isWithinWorkspaceFolder(searchDirectory, workspaceRoot)) {
            recordOperationFailure(operationResults, errors, i, operation, pathOutsideWorkspaceError(operation.directory || ''), {
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
          if (settings.workspaceBoundaryEnabled) {
            const wsResult = BrudAPI.validate.workspace(workspaceFolders);
            if (!wsResult.success) {
              recordOperationFailure(operationResults, errors, i, operation, noWorkspaceError(), {
                status: 'aborted',
              });
              continue;
            }
          }

          const workspaceRoot = workspaceFolders[0];
          const searchDirectory = operation.directory
            ? path.resolve(workspaceRoot, operation.directory)
            : path.resolve(workspaceRoot);

          if (settings.workspaceBoundaryEnabled && !isWithinWorkspaceFolder(searchDirectory, workspaceRoot)) {
            recordOperationFailure(operationResults, errors, i, operation, pathOutsideWorkspaceError(operation.directory || ''), {
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
          const fileErrors: Array<{ path: string; code?: string; details?: string }> = [];

          for (const filePath of matchedFiles) {
            try {
              let existingContent = '';
              if (!(await fs.exists(filePath))) {
                failedFiles.push(filePath);
                fileErrors.push({
                  path: path.relative(searchDirectory, filePath),
                  code: 'FILE_NOT_FOUND',
                  details: `File not found: ${path.relative(searchDirectory, filePath)}`,
                });
                continue;
              }
              existingContent = await fs.readFile(filePath);

              const updatedContent = operation.position === 'end'
                ? existingContent + '\n\n' + operation.content
                : operation.content + '\n\n' + existingContent;

              await fs.writeFile(filePath, updatedContent);
              modifiedFiles.push(filePath);
            } catch (error) {
              failedFiles.push(filePath);
              fileErrors.push({
                path: path.relative(searchDirectory, filePath),
                ...(isBrudError(error) ? { code: error.code } : {}),
                details: error instanceof Error ? error.message : String(error),
              });
            }
          }

          if (modifiedFiles.length > 0) {
            for (const f of modifiedFiles) {
              if (!filesAffected.includes(f)) {
                filesAffected.push(f);
              }
            }
          }

          const appendFailure = failedFiles.length > 0
            ? executionFailedError(`${failedFiles.length} file(s) failed: ${failedFiles.map(f => path.relative(searchDirectory, f)).join(', ')}`)
            : undefined;
          if (appendFailure) {
            errors.push(appendFailure);
          }
          operationResults.push({
            operationIndex: i,
            operationId: generateOperationId(),
            kind: 'append_file_multi',
            status: failedFiles.length === 0 ? 'success' : 'failed',
            message: `Appended content to ${modifiedFiles.length} files.`,
            ...(appendFailure ? { code: appendFailure.code, details: appendFailure.details } : {}),
            path: operation.directory || '',
            fileResults: {
              modified: modifiedFiles,
              skipped: skippedFiles,
              failed: failedFiles,
              ...(fileErrors.length > 0 ? { fileErrors } : {}),
            },
          });
          break;
        }

        case 'search_replace_multi': {
          if (settings.workspaceBoundaryEnabled) {
            const wsResult = BrudAPI.validate.workspace(workspaceFolders);
            if (!wsResult.success) {
              recordOperationFailure(operationResults, errors, i, operation, noWorkspaceError(), {
                status: 'aborted',
              });
              continue;
            }
          }

          const workspaceRoot = workspaceFolders[0];
          const searchDirectory = operation.directory
            ? path.resolve(workspaceRoot, operation.directory)
            : path.resolve(workspaceRoot);

          if (settings.workspaceBoundaryEnabled && !isWithinWorkspaceFolder(searchDirectory, workspaceRoot)) {
            recordOperationFailure(operationResults, errors, i, operation, pathOutsideWorkspaceError(operation.directory || ''), {
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
          const fileErrors: Array<{ path: string; code?: string; details?: string }> = [];

          for (const filePath of matchedFiles) {
            try {
              const content = await fs.readFile(filePath);

              const cleanSearch = operation.search.replace(/^\s*\d+\s*\|\s?/gm, '');
              const matchResult = await BrudAPI.validate.singleMatch(fs, filePath, cleanSearch);
              if (!matchResult.success) {
                skippedFiles.push(filePath);
                continue;
              }

              const matchIndex = content.indexOf(cleanSearch);
              const updatedContent = content.substring(0, matchIndex) + operation.replace + content.substring(matchIndex + cleanSearch.length);
              await fs.writeFile(filePath, updatedContent);
              modifiedFiles.push(filePath);
            } catch (error) {
              failedFiles.push(filePath);
              fileErrors.push({
                path: path.relative(searchDirectory, filePath),
                ...(isBrudError(error) ? { code: error.code } : {}),
                details: error instanceof Error ? error.message : String(error),
              });
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
          const replaceFailure = failedFiles.length > 0
            ? executionFailedError(`${failedFiles.length} file(s) failed: ${failedFiles.map(f => path.relative(searchDirectory, f)).join(', ')}`)
            : undefined;
          if (replaceFailure) {
            errors.push(replaceFailure);
          }
          operationResults.push({
            operationIndex: i,
            operationId: generateOperationId(),
            kind: 'search_replace_multi',
            status: failedFiles.length === 0 ? 'success' : 'failed',
            message: `Patched ${modifiedFiles.length} files.${skipMsg}`,
            ...(replaceFailure ? { code: replaceFailure.code, details: replaceFailure.details } : {}),
            path: operation.directory || '',
            fileResults: {
              modified: modifiedFiles,
              skipped: skippedFiles,
              failed: failedFiles,
              ...(fileErrors.length > 0 ? { fileErrors } : {}),
            },
          });
          break;
        }

        case 'read_file': {
          const result = validatePath(operation.path, workspaceFolders);
          if (!result.valid) {
            recordOperationFailure(operationResults, errors, i, operation, result.brudError, {
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
            operation.start_line,
            operation.end_line,
            { settings, pathCache, signal },
          );
          readResults.set(i, resultData);
          operationResults.push({
            operationIndex: i,
            operationId: generateOperationId(),
            kind: 'read_file',
            status: 'success',
            message: summarizeReadResult(i, resultData),
            path: operation.path,
          });
          break;
        }

        case 'read_files': {
          if (settings.workspaceBoundaryEnabled) {
            const wsResult = BrudAPI.validate.workspace(workspaceFolders);
            if (!wsResult.success) {
              recordOperationFailure(operationResults, errors, i, operation, noWorkspaceError(), {
                status: 'aborted',
              });
              continue;
            }
          }

          const workspaceRoot = workspaceFolders[0];
          const searchDirectory = operation.directory
            ? path.resolve(workspaceRoot, operation.directory)
            : path.resolve(workspaceRoot);

          if (settings.workspaceBoundaryEnabled && !isWithinWorkspaceFolder(searchDirectory, workspaceRoot)) {
            recordOperationFailure(operationResults, errors, i, operation, pathOutsideWorkspaceError(operation.directory || ''), {
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
            operation.start_line,
            operation.end_line,
            { settings, pathCache, signal },
          );
          readResults.set(i, resultData);
          operationResults.push({
            operationIndex: i,
            operationId: generateOperationId(),
            kind: 'read_files',
            status: 'success',
            message: summarizeReadResult(i, resultData),
            path: operation.directory || '',
          });
          break;
        }

        case 'read_directory': {
          const dirResult = validatePath(operation.directoryPath, workspaceFolders);
          if (!dirResult.valid) {
            recordOperationFailure(operationResults, errors, i, operation, dirResult.brudError, {
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
            operation.start_line,
            operation.end_line,
            { settings, pathCache, signal },
          );
          readResults.set(i, resultData);
          operationResults.push({
            operationIndex: i,
            operationId: generateOperationId(),
            kind: 'read_directory',
            status: 'success',
            message: summarizeReadResult(i, resultData),
            path: operation.directoryPath,
          });
          break;
        }

        case 'terminal_interactive': {
          if (!terminalExecutor) {
            recordOperationFailure(operationResults, errors, i, operation, terminalUnavailableError());
            continue;
          }

          const termOp = operation as TerminalInteractiveOperation;
          const cmdValidation = validateTerminalCommand(termOp.command, termOp.cwd, workspaceFolders, settings.workspaceBoundaryEnabled, settings.commandValidationEnabled);
          if (!cmdValidation.success) {
            const code = cmdValidation.code;
            const target = typeof cmdValidation.data === 'string' ? cmdValidation.data : termOp.command;
            const error = code === 'CWD_ESCAPE'
              ? cwdEscapeError(termOp.command, target)
              : code === 'DYNAMIC_PATH'
                ? dynamicPathError(termOp.command, termOp.command)
                : dangerousCommandError(termOp.command);
            recordOperationFailure(operationResults, errors, i, operation, error);
            continue;
          }
          const cwdValidation = validateTerminalCwd(termOp.cwd, workspaceFolders);
          if (!cwdValidation.valid) {
            recordOperationFailure(operationResults, errors, i, operation, invalidCwdError(termOp.cwd || ''));
            continue;
          }
          const termResult = await terminalExecutor.execute(termOp.command, termOp.answers, cwdValidation.resolvedCwd, (termOp.timeout ?? 120) * 1000);
          const interactiveError = !termResult.success && termResult.status !== 'interrupted'
            ? commandFailedError(termOp.command, termResult.exitCode ?? -1, termResult.output)
            : undefined;
          if (interactiveError) {
            errors.push(interactiveError);
          }
          operationResults.push({
            operationIndex: i,
            operationId: generateOperationId(),
            kind: 'terminal_interactive',
            status: termResult.status === 'interrupted' ? 'interrupted' : (termResult.success ? 'success' : 'failed'),
            message: termResult.success
              ? `Terminal command executed successfully.\nOutput:\n${termResult.output}`
              : `Terminal command failed (exit code: ${termResult.exitCode})\nOutput:\n${termResult.output}`,
            ...(interactiveError ? { code: interactiveError.code, details: interactiveError.details } : {}),
            path: termOp.command,
          });
          break;
        }

        case 'get_tool_info': {
          initializeToolRegistry();
          const toolOp = operation as import('../types/patch.js').GetToolInfoOperation;
          if (!toolOp.toolKind) {
            const allTools = globalToolRegistry.getAllTools();
            const toolList = allTools.map(t => `${t.kind} - ${t.name}: ${t.description}`).join('\n');
            const mandate = '\n\n**CRITICAL MANDATE:**\nDo NOT attempt to invoke, execute, or guess the syntax of any tool above based on its name or description alone. You have NOT been provided with their parameter schemas or block syntax. You MUST call `GET_TOOL_INFO` with `Tool: <kind>` (e.g. `Tool: [tool_name]`) to retrieve the exact required fields, behavioral rules, and copy-paste template BEFORE generating any execution instructions.';
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'get_tool_info',
              status: 'success',
              message: `Available tools:\n${toolList}${mandate}`,
              path: '',
            });
          } else {
            const doc = globalToolRegistry.getTool(toolOp.toolKind);
            if (!doc) {
              recordOperationFailure(operationResults, errors, i, operation, toolNotFoundError(toolOp.toolKind));
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
            recordOperationFailure(operationResults, errors, i, operation, terminalUnavailableError());
            continue;
          }

          const termCmdOp = operation as TerminalCommandOperation;

          if (termCmdOp.commands && termCmdOp.commands.length > 0) {
            let hasDangerous = false;
            for (const cmd of termCmdOp.commands) {
              const cmdValidation = validateTerminalCommand(cmd, termCmdOp.cwd, workspaceFolders, settings.workspaceBoundaryEnabled, settings.commandValidationEnabled);
              if (!cmdValidation.success) {
                const code = cmdValidation.code;
                const target = typeof cmdValidation.data === 'string' ? cmdValidation.data : cmd;
                const error = code === 'CWD_ESCAPE'
                  ? cwdEscapeError(cmd, target)
                  : code === 'DYNAMIC_PATH'
                    ? dynamicPathError(cmd, cmd)
                    : dangerousCommandError(cmd);
                recordOperationFailure(operationResults, errors, i, operation, error);
                hasDangerous = true;
                break;
              }
            }
            if (hasDangerous) {
              continue;
            }
            const cwdValidation = validateTerminalCwd(termCmdOp.cwd, workspaceFolders);
            if (!cwdValidation.valid) {
              recordOperationFailure(operationResults, errors, i, operation, invalidCwdError(termCmdOp.cwd || ''));
              continue;
            }
            const termCmdTimeout = (termCmdOp.timeout ?? 120) * 1000;
            let groupResult: GroupResult;
            if (termCmdOp.mode === 'parallel') {
              groupResult = await terminalExecutor.executeParallel(termCmdOp.commands, cwdValidation.resolvedCwd, termCmdTimeout, termCmdOp.env, undefined, signal);
            } else {
              groupResult = await terminalExecutor.executeSequential(termCmdOp.commands, cwdValidation.resolvedCwd, termCmdTimeout, termCmdOp.env, termCmdOp.stopOnFailure, undefined, signal);
            }
            const succeeded = groupResult.results.filter(r => r.success).length;
            const failed = groupResult.results.filter(r => !r.success).length;
            const failedGroupResult = groupResult.results.find(r => !r.success && r.status !== 'interrupted');
            const groupError = !groupResult.success && failedGroupResult
              ? commandFailedError(failedGroupResult.command, failedGroupResult.exitCode ?? -1, failedGroupResult.output)
              : undefined;
            if (groupError) {
              errors.push(groupError);
            }
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'terminal_command',
              status: groupResult.results.some(r => r.status === 'interrupted') ? 'interrupted' : (groupResult.success ? 'success' : 'failed'),
              message: `Executed ${groupResult.results.length} commands. ${succeeded} succeeded, ${failed} failed.`,
              ...(groupError ? { code: groupError.code, details: groupError.details } : {}),
              path: termCmdOp.commands[0],
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

          const singleCmdValidation = validateTerminalCommand(termCmdOp.command, termCmdOp.cwd, workspaceFolders, settings.workspaceBoundaryEnabled, settings.commandValidationEnabled);
          if (!singleCmdValidation.success) {
            const code = singleCmdValidation.code;
            const target = typeof singleCmdValidation.data === 'string' ? singleCmdValidation.data : termCmdOp.command;
            const error = code === 'CWD_ESCAPE'
              ? cwdEscapeError(termCmdOp.command, target)
              : code === 'DYNAMIC_PATH'
                ? dynamicPathError(termCmdOp.command, termCmdOp.command)
                : dangerousCommandError(termCmdOp.command);
            recordOperationFailure(operationResults, errors, i, operation, error);
            continue;
          }
          const cwdValidation = validateTerminalCwd(termCmdOp.cwd, workspaceFolders);
          if (!cwdValidation.valid) {
            recordOperationFailure(operationResults, errors, i, operation, invalidCwdError(termCmdOp.cwd || ''));
            continue;
          }
          const termCmdTimeout = (termCmdOp.timeout ?? 120) * 1000;
          if (termCmdOp.onSuccess || termCmdOp.onFailure) {
            const conditional: ConditionalCommand = {
              command: termCmdOp.command,
              onSuccess: termCmdOp.onSuccess,
              onFailure: termCmdOp.onFailure,
            };
            const groupResult = await terminalExecutor.executeConditional(conditional, cwdValidation.resolvedCwd, termCmdTimeout, termCmdOp.env, undefined, signal);
            const succeeded = groupResult.results.filter(r => r.success).length;
            const failed = groupResult.results.filter(r => !r.success).length;
            const failedConditionalResult = groupResult.results.find(r => !r.success && r.status !== 'interrupted');
            const conditionalError = !groupResult.success && failedConditionalResult
              ? commandFailedError(failedConditionalResult.command, failedConditionalResult.exitCode ?? -1, failedConditionalResult.output)
              : undefined;
            if (conditionalError) {
              errors.push(conditionalError);
            }
            operationResults.push({
              operationIndex: i,
              operationId: generateOperationId(),
              kind: 'terminal_command',
              status: groupResult.results.some(r => r.status === 'interrupted') ? 'interrupted' : (groupResult.success ? 'success' : 'failed'),
              message: `Executed conditional command. ${succeeded} succeeded, ${failed} failed.`,
              ...(conditionalError ? { code: conditionalError.code, details: conditionalError.details } : {}),
              path: termCmdOp.command,
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
          const termCmdResult = await terminalExecutor.executeCommand(termCmdOp.command, cwdValidation.resolvedCwd, termCmdTimeout, termCmdOp.env, undefined, signal);
          const termCmdError = !termCmdResult.success && termCmdResult.status !== 'interrupted'
            ? commandFailedError(termCmdOp.command, termCmdResult.exitCode ?? -1, termCmdResult.output)
            : undefined;
          if (termCmdError) {
            errors.push(termCmdError);
          }
          operationResults.push({
            operationIndex: i,
            operationId: generateOperationId(),
            kind: 'terminal_command',
            status: termCmdResult.status === 'interrupted' ? 'interrupted' : (termCmdResult.success ? 'success' : 'failed'),
            message: termCmdResult.success
              ? `Terminal command executed successfully.\nOutput:\n${termCmdResult.output}`
              : `Terminal command failed (exit code: ${termCmdResult.exitCode})\nOutput:\n${termCmdResult.output}`,
            ...(termCmdError ? { code: termCmdError.code, details: termCmdError.details } : {}),
            path: termCmdOp.command,
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
      const targetPath = getOperationTargetPath(operation);

      if (isBrudError(err)) {
        errors.push(err);
        operationResults.push({
          operationIndex: i,
          operationId: generateOperationId(),
          kind: operation.kind,
          status: 'failed',
          message: err.friendly || err.message || err.details,
          ...(err.code ? { code: err.code } : {}),
          ...(err.details ? { details: err.details } : {}),
          path: targetPath,
        });
        continue;
      }

      const message = err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null
          ? JSON.stringify(err)
          : String(err);
      const stack = err instanceof Error && err.stack ? `\nStack: ${err.stack}` : '';
      const unexpected = unexpectedError(operation.kind, message + (operation.kind === 'extract_structure' ? stack : ''));
      errors.push(unexpected);
      operationResults.push({
        operationIndex: i,
        operationId: generateOperationId(),
        kind: operation.kind,
        status: 'failed',
        message: `Unexpected error: ${message}`,
        ...(unexpected.code ? { code: unexpected.code } : {}),
        ...(unexpected.details ? { details: unexpected.details } : {}),
        path: targetPath,
      });
    }
  }

  for (let i = 0; i < operations.length && i < operationResults.length; i++) {
    const op = operations[i];
    const res = operationResults[i];
    if (op.title !== undefined) {
      res.title = op.title;
    }
    if (op.description !== undefined) {
      res.description = op.description;
    }
  }

  let result: { success: boolean; message: string; errors: BrudError[]; operationResults: OperationResult[]; sessionId?: string };

  const combined: Record<string, unknown> = {};

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
      skips: data.skips,
      truncated: data.truncated,
      limitHit: data.limitHit,
    }));
  }

  if (metadataResult) {
    const parsedMetadata: unknown = JSON.parse(metadataResult);
    combined.codebase_metadata = parsedMetadata;
  }

  if (searchResults.size > 0) {
    const searchArray = Array.from(searchResults.entries()).map(([opIndex, json]) => {
      const parsedResults: unknown = JSON.parse(json);
      return {
        operationIndex: opIndex,
        results: parsedResults,
      };
    });
    combined.search_results = searchArray;
  }

  if (Object.keys(combined).length > 0) {
    result = {
      success: errors.length === 0,
      message: JSON.stringify(combined),
      operationResults,
      errors,
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
      const interruptedCount = operationResults.filter(r => r.status === 'interrupted').length;

      let prefix: string;
      if (interruptedCount > 0 && successCount === 0 && failedCount === 0 && abortedCount === 0) {
        prefix = 'All operations were interrupted.';
      } else if (interruptedCount > 0) {
        prefix = 'Some operations were interrupted.';
      } else if (failedCount === 0 && abortedCount === 0) {
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

      result = { success: failedCount === 0 && interruptedCount === 0, message: prefix, errors, operationResults };
    }
  }

  if (historyStore && sessionId && preSnapshot) {
    if (existingSessionData) {
      // Invariant: pre-snapshot is immutable.
      // Once a file's original state is captured in a session,
      // it must never be overwritten by a later intermediate state.
      // The session's pre-state represents the workspace BEFORE the session began.
      for (const [filePath, content] of existingSessionData.preSnapshot.files) {
        preSnapshot.files.set(filePath, content);
      }
      // Invariant: files absent from the existing pre-snapshot but present in the
      // existing filesAffected were created DURING the session and must remain
      // absent from the merged pre-snapshot. A fresh capture reads them from disk
      // after creation, which would shadow their non-existence during revert.
      for (const filePath of existingSessionData.filesAffected) {
        if (!existingSessionData.preSnapshot.files.has(filePath)) {
          preSnapshot.files.delete(filePath);
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
      sessionMetadata,
    );
  }

  return { ...result, sessionId };
}