import type { FileSystem } from '../types/filesystem';
import type { FileOperation } from '../types/patch';
import { getWorkspaceRootForPath } from '../utils/workspacePath';
import {
  boundaryPolicy,
  validateBatchDecision,
  validateCommand,
  validateCommandDecision,
  validateCwd,
  validateExtractOperations,
  validateFormat,
  validateKnownOperation,
  validateKnownTool,
  validateLineRange,
  validateOperations,
  validatePath,
  validatePreview,
  validateReadOnlyProjectionDecision,
  validateRevertRequest,
} from './validationFacade';
import type { PathCache } from '../utils/workspacePath';
import type { ValidationResult } from './types';
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
  promptNotFoundError,
  promptInvalidFieldError,
  invalidLineRangeError,
  batchLimitExceededError,
  commandFailedError,
  BrudError,
  isBrudError,
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
  promptNotFoundError,
  promptInvalidFieldError,
  invalidLineRangeError,
  batchLimitExceededError,
  commandFailedError,
  BrudError,
  isBrudError,
};

export type { ValidationResult } from './types';

export interface SessionLookupStore {
  getSession(sessionId: string): Promise<unknown>;
}

export interface TerminalAvailabilityConfig {
  terminalExecutor?: unknown;
}

// Dangerous-command patterns moved to the kernel `ValidationService`; the
// legacy scanner is reached through `validationFacade` so there is exactly one
// copy of the rule set.

// Operation-kind and dangerous-command vocabularies live in the kernel
// `ValidationService` (`engine/kindMatrix.ts`, `engine/commandPatterns.ts`);
// the legacy boundary reaches them through `validationFacade`.

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

export const BrudAPI = {
  errors: {
    batchLimitExceededError,
  },

  validate: {
    workspace(workspaceFolders: string[]): ValidationResult {
      if (!workspaceFolders || workspaceFolders.length === 0) {
        return fail(noWorkspaceError());
      }
      return success(workspaceFolders);
    },

    path(path: string, workspaceFolders: string[], options?: { operationKind?: string; cache?: PathCache }): ValidationResult {
      const wsResult = this.workspace(workspaceFolders);
      if (!wsResult.success) {
        return wsResult;
      }

      // `boundaryPolicy()` is the frozen policy of the execution boundary; the
      // per-call `options` shape predates Phase 3 and cannot carry policy.
      return validatePath(path, workspaceFolders, boundaryPolicy(), options);
    },

    command(command: string, cwd?: string, workspaceFolders?: string[]): ValidationResult {
      // No per-call policy flags: command safety and the workspace boundary are
      // frozen at the execution boundary (see `validation/terminal.ts`).
      return validateCommand(command, cwd, workspaceFolders);
    },

    /**
     * Structured command decision, exposing the violated rule.
     *
     * `command` flattens the kernel decision to legacy codes; callers that
     * must tell a dangerous-command verdict apart from a containment failure
     * read the `rule` here.
     */
    commandDecision(command: string, cwd?: string, workspaceFolders?: string[]) {
      return validateCommandDecision(command, cwd, workspaceFolders);
    },

    /**
     * Structured batch decision used by the pre-execution read pipeline.
     *
     * Rejects a batch that exceeds the frozen file ceiling through
     * `INPUT.BATCH_LIMIT` or the frozen aggregate budget through
     * `POLICY.AGGREGATE_BYTES`.
     */
    batch(fileCount: number, totalBytes: number, isImportRead = false) {
      return validateBatchDecision(fileCount, totalBytes, isImportRead);
    },

    /**
     * Structured read-only projection decision used by the write router.
     */
    readOnlyProjection(operationKind: string, projectionPath?: string) {
      return validateReadOnlyProjectionDecision(operationKind, projectionPath);
    },

    cwd(cwd: string | undefined, workspaceFolders: string[]): ValidationResult {
      return validateCwd(cwd, workspaceFolders);
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

    requiredField(field: string, value: unknown, operation?: string): ValidationResult {
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
      return validateKnownOperation(operation);
    },

    hasIndex(index: string | undefined): ValidationResult {
      if (!index || index.trim() === '') {
        return fail(missingIndexError());
      }
      return success({ index });
    },

    validAnswers(answers: unknown): ValidationResult {
      if (!Array.isArray(answers)) {
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
      return validatePreview(operationType);
    },

    hasValidOperations(operations: FileOperation[]): ValidationResult {
      const result = validateOperations(operations);

      return result.success ? success({ operations }) : result;
    },

    canGeneratePreview(files: unknown[]): ValidationResult {
      if (!files || files.length === 0) {
        return fail(noPreviewError());
      }
      return success({ files });
    },

    hasExtractOperations(operations: FileOperation[]): ValidationResult {
      const result = validateExtractOperations(operations);

      return result.success ? success({ operations }) : result;
    },

    validFormat(message: string): ValidationResult {
      const result = validateFormat(message);

      return result.success ? success({ message }) : result;
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
      return validateKnownTool(toolKind);
    },

    terminalAvailable(config: TerminalAvailabilityConfig | null | undefined): ValidationResult {
      if (!config?.terminalExecutor) {
        return fail(terminalUnavailableError());
      }
      return success({ config });
    },

    async canRevert(sessionId: string, historyStore?: SessionLookupStore): Promise<ValidationResult> {
      const sessionResult = await this.sessionExists(sessionId, historyStore);
      if (!sessionResult.success) {
        return sessionResult;
      }
      return success({ sessionId });
    },

    async sessionExists(sessionId: string, historyStore?: SessionLookupStore): Promise<ValidationResult> {
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
      return validateRevertRequest(sessionId, targetState);
    },

    lineRange(
      startLine: number | undefined,
      endLine: number | undefined,
      totalLines: number,
      operation?: string,
    ): ValidationResult {
      void operation;

      return validateLineRange(startLine, endLine, totalLines);
    },
  },
} as const;
