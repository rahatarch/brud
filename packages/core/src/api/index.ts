import * as pathModule from 'path';
import type { FileSystem } from '../types/filesystem';
import { getWorkspaceRootForPath, validateWorkspacePath } from '../utils/workspacePath';
import { isDangerousCommand, validateTerminalCwd } from '../validation/terminal';
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
} from './errors';

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

    command(command: string): ValidationResult {
      if (isDangerousCommand(command)) {
        return fail(dangerousCommandError(command));
      }
      return success({ command });
    },

    cwd(cwd: string | undefined, workspaceFolders: string[]): ValidationResult {
      const result = validateTerminalCwd(cwd, workspaceFolders);
      if (!result.valid) {
        return fail(invalidCwdError(cwd ?? ''));
      }
      return success({ resolvedCwd: result.resolvedCwd });
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
  },
};