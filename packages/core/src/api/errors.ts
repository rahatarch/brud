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

export function fileOpenError(path: string): BrudError {
  return {
    code: 'FILE_OPEN_ERROR',
    friendly: 'Could not open file.',
    details: `Could not open file: ${path}`,
    path,
  };
}

export function previewNotAvailableError(): BrudError {
  return {
    code: 'PREVIEW_NOT_AVAILABLE',
    friendly: 'Preview not available for this operation type.',
    details: 'Preview not available for this operation type.',
  };
}

export function noValidOperationsError(): BrudError {
  return {
    code: 'NO_VALID_OPERATIONS',
    friendly: 'No valid operations found.',
    details: 'No valid operations found.',
  };
}

export function noPreviewError(): BrudError {
  return {
    code: 'NO_PREVIEW',
    friendly: 'No preview could be generated for any file.',
    details: 'No preview could be generated for any file.',
  };
}

export function noExtractOperationsError(): BrudError {
  return {
    code: 'NO_EXTRACT_OPERATIONS',
    friendly: 'No extract_structure operations found.',
    details: 'No extract_structure operations found.',
  };
}

export function missingFieldError(field: string, operation?: string): BrudError {
  return {
    code: 'MISSING_FIELD',
    friendly: `Missing required field: ${field}`,
    details: `The field "${field}" is required${operation ? ` in ${operation} operation` : ''}.`,
  };
}

export function invalidFieldError(field: string, message: string): BrudError {
  return {
    code: 'INVALID_FIELD',
    friendly: `Invalid value for field: ${field}`,
    details: message,
  };
}

export function missingIndexError(): BrudError {
  return {
    code: 'MISSING_INDEX',
    friendly: 'You haven\'t used any index number with your instructions.',
    details: 'Please use index with instructions in this format: TOOL_CALL [INDEX]. Example: READ_FILE [1]',
  };
}

export function parseError(): BrudError {
  return {
    code: 'PARSE_ERROR',
    friendly: 'I couldn\'t understand the format of your message.',
    details: 'Brud Code understands two formats: the legacy block format and YAML. If you are an AI, call GET_TOOL_INFO first to fetch the tool syntax.',
  };
}

export function unknownOperationError(operation: string): BrudError {
  return {
    code: 'UNKNOWN_OPERATION',
    friendly: `Unrecognized operation: ${operation}`,
    details: `The operation "${operation}" is not supported by Brud Code. Use GET_TOOL_INFO to see available tools.`,
  };
}

export function deleteFailedError(path: string): BrudError {
  return {
    code: 'DELETE_FAILED',
    friendly: `Failed to delete: ${path}`,
    details: `The file or directory at "${path}" could not be deleted. Check permissions and try again.`,
    path,
  };
}

export function toolNotFoundError(toolKind: string): BrudError {
  return {
    code: 'TOOL_NOT_FOUND',
    friendly: `Tool not found: ${toolKind}`,
    details: `The tool "${toolKind}" does not exist. Use GET_TOOL_INFO to see available tools.`,
  };
}

export function cwdEscapeError(command: string, target: string): BrudError {
  return {
    code: 'CWD_ESCAPE',
    friendly: 'Command attempts to leave the workspace.',
    details: `The command attempts to cd to "${target}", which is outside the current workspace. Commands can only run inside the workspace.`,
    command,
    path: target,
  };
}

export function dynamicPathError(command: string, target: string): BrudError {
  return {
    code: 'DYNAMIC_PATH',
    friendly: 'Command uses a dynamic path that cannot be verified.',
    details: `The command attempts to cd to "${target}", which contains a variable or expression that cannot be statically resolved. Commands can only use static paths.`,
    command,
  };
}

export function terminalUnavailableError(): BrudError {
  return {
    code: 'TERMINAL_UNAVAILABLE',
    friendly: 'Terminal executor is not available.',
    details: 'The terminal executor could not be initialized. Check the platform adapter configuration.',
  };
}

export function executionFailedError(message: string): BrudError {
  return {
    code: 'EXECUTION_FAILED',
    friendly: 'Execution failed.',
    details: message,
  };
}

export function revertFailedError(path: string): BrudError {
  return {
    code: 'REVERT_FAILED',
    friendly: `Failed to revert: ${path}`,
    details: `The revert operation for "${path}" could not be completed. Check the history and try again.`,
    path,
  };
}

export function sessionNotFoundError(sessionId: string): BrudError {
  return {
    code: 'SESSION_NOT_FOUND',
    friendly: `Session not found: ${sessionId}`,
    details: `The session "${sessionId}" does not exist in history. It may have been deleted or expired.`,
  };
}

export function invalidRevertRequestError(): BrudError {
  return {
    code: 'INVALID_REVERT_REQUEST',
    friendly: 'Invalid revert request.',
    details: 'Cannot revert without sessionId and targetState.',
  };
}

export function validationError(errorString: string): BrudError {
  return {
    code: 'VALIDATION_ERROR',
    friendly: errorString,
    details: errorString,
  };
}

export function unexpectedError(operationKind: string, message: string): BrudError {
  return {
    code: 'UNEXPECTED_ERROR',
    friendly: 'An unexpected error occurred.',
    details: `Unexpected error during ${operationKind}: ${message}`,
  };
}

export function metadataWrapperCaseError(wrapper: string): BrudError {
  return {
    code: 'E_METADATA_WRONG_CASE',
    friendly: 'Metadata wrapper must be lowercase.',
    details: `Metadata wrapper '<${wrapper}>' must be lowercase. Found '<${wrapper}>'.`,
  };
}

export function duplicateMetadataError(scope: 'session' | 'operation', index?: string): BrudError {
  if (scope === 'session') {
    return {
      code: 'E_DUPLICATE_SESSION_METADATA',
      friendly: 'Duplicate session metadata block.',
      details: 'Duplicate session metadata block. Only one <session_metadata> block is allowed.',
    };
  }
  return {
    code: 'E_DUPLICATE_OPERATION_METADATA',
    friendly: `Duplicate operation metadata block in operation '${index}'.`,
    details: `Duplicate operation metadata block in operation '${index}'. Only one <operation_metadata> block is allowed per operation.`,
  };
}

export function invalidMetadataFieldError(field: string): BrudError {
  const stripped = field.endsWith(':') ? field.slice(0, -1) : field;
  const lower = stripped.toLowerCase();
  if (lower === 'title' || lower === 'description') {
    return {
      code: 'E_METADATA_FIELD_CASE',
      friendly: `Metadata field '${field}' must be lowercase. Did you mean '${lower}:'?`,
      details: `Metadata field '${field}' must be lowercase. Did you mean '${lower}:'?`,
    };
  }
  return {
    code: 'E_METADATA_UNKNOWN_FIELD',
    friendly: `Unknown metadata field '${field}'. Only 'title:' and 'description:' are allowed.`,
    details: `Unknown metadata field '${field}'. Only 'title:' and 'description:' are allowed.`,
  };
}

export function metadataPositionError(wrapper: string): BrudError {
  if (wrapper === 'session_metadata') {
    return {
      code: 'E_SESSION_METADATA_POSITION',
      friendly: 'Session metadata must be the first element after <BRUD_INSTRUCTIONS>.',
      details: 'Session metadata must be the first element after <BRUD_INSTRUCTIONS>.',
    };
  }
  return {
    code: 'E_OPERATION_METADATA_POSITION',
    friendly: 'Operation metadata must appear before the content separator.',
    details: `Operation metadata must appear before the content separator in operation '%s'.`,
  };
}

export function unterminatedMetadataError(wrapper: string): BrudError {
  return {
    code: 'E_METADATA_UNCLOSED',
    friendly: `Unclosed <${wrapper}> wrapper. Expected </${wrapper}>.`,
    details: `Unclosed <${wrapper}> wrapper. Expected </${wrapper}>.`,
  };
}