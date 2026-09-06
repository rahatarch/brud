import type { BrudError } from './types';

export function noWorkspaceError(): BrudError {
  return {
    code: 'NO_WORKSPACE',
    friendly: 'No workspace is currently open.',
    details: 'Open a folder in VS Code to use file operations.',
  };
}

export function pathOutsideWorkspaceError(path: string): BrudError {
  return {
    code: 'PATH_OUTSIDE_WORKSPACE',
    friendly: 'The path is outside the current workspace.',
    details: `The path "${path}" is outside the current workspace. File operations are restricted to files and folders inside the workspace.`,
    path,
  };
}

export function dangerousCommandError(command: string): BrudError {
  return {
    code: 'DANGEROUS_COMMAND',
    friendly: 'The command is potentially dangerous and has been blocked.',
    details: `The command "${command}" matches a known dangerous pattern and has been blocked for security reasons.`,
    command,
  };
}

export function invalidCwdError(cwd: string): BrudError {
  return {
    code: 'INVALID_CWD',
    friendly: 'The working directory is invalid.',
    details: `The working directory "${cwd}" is outside the workspace or does not exist.`,
    path: cwd,
  };
}

export function fileNotFoundError(path: string): BrudError {
  return {
    code: 'FILE_NOT_FOUND',
    friendly: 'The specified file was not found.',
    details: `No file found at "${path}".`,
    path,
  };
}

export function fileAlreadyExistsError(path: string): BrudError {
  return {
    code: 'FILE_ALREADY_EXISTS',
    friendly: 'The file already exists.',
    details: `A file already exists at "${path}".`,
    path,
  };
}

export function directoryNotFoundError(path: string): BrudError {
  return {
    code: 'DIRECTORY_NOT_FOUND',
    friendly: 'The specified directory was not found.',
    details: `No directory found at "${path}".`,
    path,
  };
}

export function directoryAlreadyExistsError(path: string): BrudError {
  return {
    code: 'DIRECTORY_ALREADY_EXISTS',
    friendly: 'The directory already exists.',
    details: `A directory already exists at "${path}".`,
    path,
  };
}

export function searchNotFoundError(path: string, searchText: string): BrudError {
  return {
    code: 'SEARCH_NOT_FOUND',
    friendly: 'The search text was not found.',
    details: `The text "${searchText}" was not found in "${path}".`,
    path,
  };
}

export function multipleMatchesError(path: string): BrudError {
  return {
    code: 'MULTIPLE_MATCHES',
    friendly: 'Multiple matches found.',
    details: `Multiple matches found in "${path}". Expected a single match.`,
    path,
  };
}