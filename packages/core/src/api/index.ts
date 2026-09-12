import * as pathModule from 'path';
import type { FileSystem } from '../types/filesystem';
import type { FileOperation } from '../types/patch';
import { getWorkspaceRootForPath } from '../utils/workspacePath';
import type { BrudError as BrudErrorType, ValidationResult } from './types';
import {
  noWorkspaceError,
  pathOutsideWorkspaceError,
  dangerousCommandError,
  invalidCwdError,
  fileNotFoundError,
  fileAlreadyExistsError,
  directoryNotFoundError,
  directoryAlreadyExistsError,
  searchNotFoundError,
  multipleMatchesError,
  fileOpenError,
  previewNotAvailableError,
  noValidOperationsError,
  noPreviewError,
  noExtractOperationsError,
  missingFieldError,
  invalidFieldError,
  missingIndexError,
  unknownOperationError,
  parseError,
  deleteFailedError,
  toolNotFoundError,
  terminalUnavailableError,
  cwdEscapeError,
  dynamicPathError,
  executionFailedError,
  sessionNotFoundError,
  invalidRevertRequestError,
  unexpectedError,
  metadataWrapperCaseError,
  duplicateMetadataError,
  invalidMetadataFieldError,
  metadataPositionError,
  unterminatedMetadataError,
} from './errors';

export {
  noWorkspaceError,
  pathOutsideWorkspaceError,
  dangerousCommandError,
  invalidCwdError,
  fileNotFoundError,
  fileAlreadyExistsError,
  directoryNotFoundError,
  directoryAlreadyExistsError,
  searchNotFoundError,
  multipleMatchesError,
  fileOpenError,
  previewNotAvailableError,
  noValidOperationsError,
  noPreviewError,
  noExtractOperationsError,
  missingFieldError,
  invalidFieldError,
  missingIndexError,
  unknownOperationError,
  parseError,
  deleteFailedError,
  toolNotFoundError,
  terminalUnavailableError,
  cwdEscapeError,
  dynamicPathError,
  executionFailedError,
  sessionNotFoundError,
  invalidRevertRequestError,
  unexpectedError,
  metadataWrapperCaseError,
  duplicateMetadataError,
  invalidMetadataFieldError,
  metadataPositionError,
  unterminatedMetadataError,
};

export type { ValidationResult } from './types';

export class BrudError extends Error {
  code: string;
  friendly: string;
  details: string;
  path?: string;
  command?: string;

  constructor(opts: BrudErrorType) {
    super(opts.details);
    this.name = 'BrudError';
    this.code = opts.code;
    this.friendly = opts.friendly;
    this.details = opts.details;
    this.path = opts.path;
    this.command = opts.command;
  }
}

const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+-(?:rf|fr)\s+(\/|\/\*|~|\.)(?:$|\s)/,
  /\brm\s+-(?:rf|fr)\s+\*\s*$/,
  /\bsudo\b/,
  /\bsu\b/,
  /\bpkexec\b/,
  /\bmkfs\b/,
  /\bfdisk\b/,
  /\bdd\s+if=/,
  /curl\s+.*\|\s*(bash|sh)\b/,
  /wget\s+.*\|\s*(bash|sh)\b/,
  /\bchmod\s+-R\s+777\b/,
  /\bchown\s+-R\b/,
  />\s+\/dev\/sd/,
  />\s+\/dev\/nvme/,
  /:\s*\(\)\s*\{[^}]*:\s*:\s*\(\)\s*\|/,
  /\bapt-get\s+--force-yes\b/,
  /\bnpm\s+--unsafe-perm\b/,
];

const KNOWN_OPERATIONS = [
  'search_replace',
  'create_file',
  'delete_file',
  'rename_file',
  'move_file',
  'copy_file',
  'append_file',
  'append_file_multi',
  'search_replace_multi',
  'create_directory',
  'delete_directory',
  'move_directory',
  'extract_structure',
  'codebase_metadata',
  'search_files',
  'read_file',
  'read_files',
  'read_directory',
  'terminal_interactive',
  'terminal_command',
  'get_tool_info',
] as const;

const KNOWN_TOOLS = [
  'search_replace',
  'create_file',
  'delete_file',
  'rename_file',
  'move_file',
  'copy_file',
  'append_file',
  'append_file_multi',
  'search_replace_multi',
  'create_directory',
  'delete_directory',
  'move_directory',
  'extract_structure',
  'codebase_metadata',
  'search_files',
  'read_file',
  'read_files',
  'read_directory',
  'terminal_interactive',
  'terminal_command',
  'get_tool_info',
] as const;

function success(data?: unknown): ValidationResult {
  return { success: true, data };
}

function fail(error: { code: string; friendly: string; details: string; path?: string }): ValidationResult {
  return {
    success: false,
    code: error.code,
    friendly: error.friendly,
    details: error.details,
    data: error.path,
  };
}

function validateCdInCommand(command: string, cwd?: string, workspaceFolders?: string[]): ValidationResult {
  const initialCwd = cwd || (workspaceFolders?.[0] ?? '');
  const cdCommands = ['cd', 'pushd', 'chdir'];
  const parts = command.split(/\s*(?:&&|\|\||;|\||\(|\))\s*/);

  let currentCwd = initialCwd;

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    for (const cmd of cdCommands) {
      const cmdPattern = new RegExp(`^${cmd}(?:\\s+(.+))?$`);
      const match = trimmed.match(cmdPattern);
      if (match) {
        const target = match[1]?.trim();
        if (!target || target === '') continue;

        if (/\$\{?\w+\}?/.test(target)) {
          if (/^\$HOME(?:\/|$)/.test(target) || /^\$\{HOME\}(?:\/|$)/.test(target)) {
            const relativePart = target.replace(/^\$HOME/, '').replace(/^\$\{HOME\}/, '');
            const expandedPath = '~' + relativePart;
            const cdResult = validateCdTarget(command, expandedPath, currentCwd, workspaceFolders);
            if (!cdResult.success) return cdResult;
            currentCwd = pathModule.resolve(currentCwd, target);
          } else {
            return fail(dynamicPathError(command, target));
          }
        } else {
          const cdResult = validateCdTarget(command, target, currentCwd, workspaceFolders);
          if (!cdResult.success) return cdResult;
          currentCwd = pathModule.resolve(currentCwd, target);
        }
        continue;
      }
    }
  }

  return success(null);
}

function validateCdTarget(command: string, target: string, currentCwd: string, workspaceFolders?: string[]): ValidationResult {
  let resolvedTarget: string;

  if (target.startsWith('~')) {
    const homedir = process.env.HOME || '/home';
    const relativePart = target.slice(1);
    resolvedTarget = pathModule.resolve(homedir + relativePart);
  } else {
    resolvedTarget = pathModule.resolve(currentCwd, target);
  }

  const root = getWorkspaceRootForPath(resolvedTarget, workspaceFolders!);
  if (!root) {
    return fail(cwdEscapeError(command, resolvedTarget));
  }
  return success(null);
}

export const BrudAPI = {
  validate: {
    workspace(workspaceFolders: string[]): ValidationResult {
      if (!workspaceFolders || workspaceFolders.length === 0) {
        return fail(noWorkspaceError());
      }
      return success(workspaceFolders);
    },

    path(path: string, workspaceFolders: string[], options?: { operationKind?: string }): ValidationResult {
      const wsResult = this.workspace(workspaceFolders);
      if (!wsResult.success) {
        return wsResult;
      }

      const root = getWorkspaceRootForPath(path, workspaceFolders);
      if (!root) {
        return fail(pathOutsideWorkspaceError(path));
      }

      const resolvedPath = pathModule.isAbsolute(path)
        ? pathModule.resolve(path)
        : pathModule.resolve(root, path);

      return success({ resolvedPath, path, root, operationKind: options?.operationKind });
    },

    command(command: string, cwd?: string, workspaceFolders?: string[]): ValidationResult {
      if (DANGEROUS_PATTERNS.some((pattern) => pattern.test(command))) {
        return fail(dangerousCommandError(command));
      }

      if (workspaceFolders && workspaceFolders.length > 0) {
        const cdResult = validateCdInCommand(command, cwd, workspaceFolders);
        if (!cdResult.success) {
          return cdResult;
        }
      }

      return success({ command });
    },

    cwd(cwd: string | undefined, workspaceFolders: string[]): ValidationResult {
      if (!cwd || cwd.trim() === '') {
        const wsResult = this.workspace(workspaceFolders);
        if (!wsResult.success) {
          return wsResult;
        }
        return success({ resolvedCwd: workspaceFolders[0] });
      }
      const pathResult = this.path(cwd, workspaceFolders);
      if (!pathResult.success) {
        return fail(invalidCwdError(cwd));
      }
      const data = pathResult.data as { resolvedPath?: string } | undefined;
      return success({ resolvedCwd: data?.resolvedPath });
    },

    async fileExists(fs: FileSystem, path: string): Promise<ValidationResult> {
      const exists = await fs.exists(path);
      if (!exists) {
        return fail(fileNotFoundError(path));
      }
      return success({ path });
    },

    async directoryExists(fs: FileSystem, path: string): Promise<ValidationResult> {
      const exists = await fs.exists(path);
      if (!exists) {
        return fail(directoryNotFoundError(path));
      }
      return success({ path });
    },

    async fileNotExists(fs: FileSystem, path: string): Promise<ValidationResult> {
      const exists = await fs.exists(path);
      if (exists) {
        return fail(fileAlreadyExistsError(path));
      }
      return success({ path });
    },

    async directoryNotExists(fs: FileSystem, path: string): Promise<ValidationResult> {
      const exists = await fs.exists(path);
      if (exists) {
        return fail(directoryAlreadyExistsError(path));
      }
      return success({ path });
    },

    async searchText(fs: FileSystem, path: string, searchText: string): Promise<ValidationResult> {
      let content: string;
      try {
        content = await fs.readFile(path);
      } catch {
        return fail(fileNotFoundError(path));
      }

      const index = content.indexOf(searchText);
      if (index === -1) {
        return fail(searchNotFoundError(path, searchText));
      }

      return success({ path, searchText, index });
    },

    async singleMatch(fs: FileSystem, path: string, searchText: string): Promise<ValidationResult> {
      const searchResult = await this.searchText(fs, path, searchText);
      if (!searchResult.success) {
        return searchResult;
      }

      let content: string;
      try {
        content = await fs.readFile(path);
      } catch {
        return fail(fileNotFoundError(path));
      }

      const firstIndex = content.indexOf(searchText);
      const lastIndex = content.lastIndexOf(searchText);

      if (firstIndex !== lastIndex) {
        return fail(multipleMatchesError(path));
      }

      return success({ path, searchText, index: firstIndex });
    },

    requiredField(field: string, value: any, operation?: string): ValidationResult {
      if (value === undefined || value === null || value === '') {
        return fail(missingFieldError(field, operation));
      }
      return success({ field, value });
    },

    validPosition(position: string): ValidationResult {
      if (position !== 'start' && position !== 'end') {
        return fail(invalidFieldError('position', `Position must be 'start' or 'end', got '${position}'`));
      }
      return success({ position });
    },

    validMode(mode: string): ValidationResult {
      if (mode !== 'sequential' && mode !== 'parallel') {
        return fail(invalidFieldError('mode', `Mode must be 'sequential' or 'parallel', got '${mode}'`));
      }
      return success({ mode });
    },

    hasPatterns(patterns: string[]): ValidationResult {
      if (!patterns || patterns.length === 0) {
        return fail(missingFieldError('patterns'));
      }
      return success({ patterns });
    },

    knownOperation(operation: string): ValidationResult {
      if (!KNOWN_OPERATIONS.includes(operation as typeof KNOWN_OPERATIONS[number])) {
        return fail(unknownOperationError(operation));
      }
      return success({ operation });
    },

    hasIndex(index: string | undefined): ValidationResult {
      if (!index || index.trim() === '') {
        return fail(missingIndexError());
      }
      return success({ index });
    },

    validAnswers(answers: any): ValidationResult {
      if (!answers || !Array.isArray(answers)) {
        return fail(missingFieldError('answers'));
      }
      return success({ answers });
    },

    validCommandOrCommands(command: string | undefined, commands: string[] | undefined): ValidationResult {
      if (!command && (!commands || commands.length === 0)) {
        return fail(missingFieldError('command or commands'));
      }
      return success({ command, commands });
    },

    async canOpenFile(fs: FileSystem, path: string): Promise<ValidationResult> {
      const existsResult = await this.fileExists(fs, path);
      if (!existsResult.success) {
        return fail(fileNotFoundError(path));
      }
      try {
        await fs.readFile(path);
      } catch {
        return fail(fileOpenError(path));
      }
      return success({ path });
    },

    hasPreview(operationType: string): ValidationResult {
      const previewOps = ['search_replace', 'create_file', 'append_file'];
      if (!previewOps.includes(operationType)) {
        return fail(previewNotAvailableError());
      }
      return success({ operationType });
    },

    hasValidOperations(operations: FileOperation[]): ValidationResult {
      if (!operations || operations.length === 0) {
        return fail(noValidOperationsError());
      }
      return success({ operations });
    },

    canGeneratePreview(files: any[]): ValidationResult {
      if (!files || files.length === 0) {
        return fail(noPreviewError());
      }
      return success({ files });
    },

    hasExtractOperations(operations: FileOperation[]): ValidationResult {
      const hasExtract = operations?.some((op) => op.kind === 'extract_structure');
      if (!hasExtract) {
        return fail(noExtractOperationsError());
      }
      return success({ operations });
    },

    validFormat(message: string): ValidationResult {
      const hasBlockMarkers = message.includes('<<<<<<<') && message.includes('=======') && message.includes('>>>>>>>');
      if (!hasBlockMarkers) {
        return fail(parseError());
      }
      return success({ message });
    },

    async canDelete(fs: FileSystem, path: string): Promise<ValidationResult> {
      const exists = await fs.exists(path);
      if (!exists) {
        const isFileLike = path.includes('.');
        if (isFileLike) {
          return fail(fileNotFoundError(path));
        }
        return fail(directoryNotFoundError(path));
      }
      try {
        const isDir = !path.includes('.');
        if (isDir) {
          await fs.deleteDirectoryRecursive(path);
        } else {
          await fs.deleteFile(path);
        }
      } catch {
        return fail(deleteFailedError(path));
      }
      return success({ path });
    },

    knownTool(toolKind: string): ValidationResult {
      if (!KNOWN_TOOLS.includes(toolKind as typeof KNOWN_TOOLS[number])) {
        return fail(toolNotFoundError(toolKind));
      }
      return success({ toolKind });
    },

    terminalAvailable(config: any): ValidationResult {
      if (!config?.terminalExecutor) {
        return fail(terminalUnavailableError());
      }
      return success({ config });
    },

    async canRevert(sessionId: string, historyStore: any): Promise<ValidationResult> {
      const sessionResult = await this.sessionExists(sessionId, historyStore);
      if (!sessionResult.success) {
        return sessionResult;
      }
      return success({ sessionId });
    },

    async sessionExists(sessionId: string, historyStore: any): Promise<ValidationResult> {
      if (!historyStore?.getSession) {
        return fail(sessionNotFoundError(sessionId));
      }
      const session = await historyStore.getSession(sessionId);
      if (!session) {
        return fail(sessionNotFoundError(sessionId));
      }
      return success({ sessionId });
    },

    validRevertRequest(sessionId: string | undefined, targetState: string | undefined): ValidationResult {
      if (!sessionId || !targetState) {
        return fail(invalidRevertRequestError());
      }
      return success({ sessionId, targetState });
    },
  },
};