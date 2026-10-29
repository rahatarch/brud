import type { BrudError as BrudErrorShape } from './types';

type CaptureStackTrace = (target: object, constructor?: new (...args: never[]) => unknown) => void;

export class BrudError extends Error implements BrudErrorShape {
  code: string;
  friendly: string;
  details: string;
  path?: string;
  command?: string;
  operationKind?: string;
  exitCode?: number | null;

  constructor(opts: BrudErrorShape & { message?: string }) {
    super(opts.message ?? opts.details ?? opts.friendly);
    this.name = 'BrudError';
    this.code = opts.code;
    this.friendly = opts.friendly;
    this.details = opts.details;
    this.path = opts.path;
    this.command = opts.command;
    this.operationKind = opts.operationKind;
    this.exitCode = opts.exitCode;

    const errorWithCapture: { captureStackTrace?: CaptureStackTrace } = Error;
    const capture = errorWithCapture.captureStackTrace;
    if (typeof capture === 'function') {
      capture(this, BrudError);
    }
  }
}

function brudError(opts: BrudErrorShape & { message?: string }): BrudError {
  return new BrudError(opts);
}

export function isBrudError(value: unknown): value is BrudErrorShape {
  if (value instanceof BrudError) {
    return true;
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === 'string'
    && typeof candidate.friendly === 'string'
    && typeof candidate.details === 'string';
}

export function noWorkspaceError(): BrudError {
  return brudError({
    code: 'NO_WORKSPACE',
    friendly: 'No workspace is currently open.',
    details: 'Open a folder in VS Code to use file operations.',
  });
}

export function pathOutsideWorkspaceError(path: string): BrudError {
  return brudError({
    code: 'PATH_OUTSIDE_WORKSPACE',
    friendly: 'The path is outside the current workspace.',
    details: `The path "${path}" is outside the current workspace. File operations are restricted to files and folders inside the workspace.`,
    path,
  });
}

export function dangerousCommandError(command: string): BrudError {
  return brudError({
    code: 'DANGEROUS_COMMAND',
    friendly: 'The command is potentially dangerous and has been blocked.',
    details: `The command "${command}" matches a known dangerous pattern and has been blocked for security reasons.`,
    command,
  });
}

export function invalidCwdError(cwd: string): BrudError {
  return brudError({
    code: 'INVALID_CWD',
    friendly: 'The working directory is invalid.',
    details: `The working directory "${cwd}" is outside the workspace or does not exist.`,
    path: cwd,
  });
}

export function fileNotFoundError(path: string): BrudError {
  return brudError({
    code: 'FILE_NOT_FOUND',
    friendly: 'The specified file was not found.',
    details: `No file found at "${path}".`,
    path,
  });
}

export function fileAlreadyExistsError(path: string): BrudError {
  return brudError({
    code: 'FILE_ALREADY_EXISTS',
    friendly: 'The file already exists.',
    details: `A file already exists at "${path}".`,
    path,
  });
}

export function directoryNotFoundError(path: string): BrudError {
  return brudError({
    code: 'DIRECTORY_NOT_FOUND',
    friendly: 'The specified directory was not found.',
    details: `No directory found at "${path}".`,
    path,
  });
}

export function directoryAlreadyExistsError(path: string): BrudError {
  return brudError({
    code: 'DIRECTORY_ALREADY_EXISTS',
    friendly: 'The directory already exists.',
    details: `A directory already exists at "${path}".`,
    path,
  });
}

export function searchNotFoundError(path: string, searchText: string): BrudError {
  return brudError({
    code: 'SEARCH_NOT_FOUND',
    friendly: 'The search text was not found.',
    details: `The text "${searchText}" was not found in "${path}".`,
    path,
  });
}

export function multipleMatchesError(path: string): BrudError {
  return brudError({
    code: 'MULTIPLE_MATCHES',
    friendly: 'Multiple matches found.',
    details: `Multiple matches found in "${path}". Expected a single match.`,
    path,
  });
}

export function fileOpenError(path: string): BrudError {
  return brudError({
    code: 'FILE_OPEN_ERROR',
    friendly: 'Could not open file.',
    details: `Could not open file: ${path}`,
    path,
  });
}

export function previewNotAvailableError(): BrudError {
  return brudError({
    code: 'PREVIEW_NOT_AVAILABLE',
    friendly: 'Preview not available for this operation type.',
    details: 'Preview not available for this operation type.',
  });
}

export function noValidOperationsError(): BrudError {
  return brudError({
    code: 'NO_VALID_OPERATIONS',
    friendly: 'No valid operations found.',
    details: 'No valid operations found.',
  });
}

export function noPreviewError(): BrudError {
  return brudError({
    code: 'NO_PREVIEW',
    friendly: 'No preview could be generated for any file.',
    details: 'No preview could be generated for any file.',
  });
}

export function noExtractOperationsError(): BrudError {
  return brudError({
    code: 'NO_EXTRACT_OPERATIONS',
    friendly: 'No extract_structure operations found.',
    details: 'No extract_structure operations found.',
  });
}

export function missingFieldError(field: string, operation?: string): BrudError {
  return brudError({
    code: 'MISSING_FIELD',
    friendly: `Missing required field: ${field}`,
    details: `The field "${field}" is required${operation ? ` in ${operation} operation` : ''}.`,
  });
}

export function invalidFieldError(field: string, message: string): BrudError {
  return brudError({
    code: 'INVALID_FIELD',
    friendly: `Invalid value for field: ${field}`,
    details: message,
  });
}

export function missingIndexError(): BrudError {
  return brudError({
    code: 'MISSING_INDEX',
    friendly: 'You haven\'t used any index number with your instructions.',
    details: 'Please use index with instructions in this format: TOOL_CALL [INDEX]. Example: READ_FILE [1]',
  });
}

export function parseError(): BrudError {
  return brudError({
    code: 'PARSE_ERROR',
    friendly: 'I couldn\'t understand the format of your message.',
    details: 'Brud Code understands two formats: the legacy block format and YAML. If you are an AI, call GET_TOOL_INFO first to fetch the tool syntax.',
  });
}

export function unknownOperationError(operation: string): BrudError {
  return brudError({
    code: 'UNKNOWN_OPERATION',
    friendly: `Unrecognized operation: ${operation}`,
    details: `The operation "${operation}" is not supported by Brud Code. Use GET_TOOL_INFO to see available tools.`,
  });
}

export function deleteFailedError(path: string): BrudError {
  return brudError({
    code: 'DELETE_FAILED',
    friendly: `Failed to delete: ${path}`,
    details: `The file or directory at "${path}" could not be deleted. Check permissions and try again.`,
    path,
  });
}

export function toolNotFoundError(toolKind: string): BrudError {
  return brudError({
    code: 'TOOL_NOT_FOUND',
    friendly: `Tool not found: ${toolKind}`,
    details: `The tool "${toolKind}" does not exist. Use GET_TOOL_INFO to see available tools.`,
  });
}

export function cwdEscapeError(command: string, target: string): BrudError {
  return brudError({
    code: 'CWD_ESCAPE',
    friendly: 'Command attempts to leave the workspace.',
    details: `The command attempts to cd to "${target}", which is outside the current workspace. Commands can only run inside the workspace.`,
    command,
    path: target,
  });
}

export function dynamicPathError(command: string, target: string): BrudError {
  return brudError({
    code: 'DYNAMIC_PATH',
    friendly: 'Command uses a dynamic path that cannot be verified.',
    details: `The command attempts to cd to "${target}", which contains a variable or expression that cannot be statically resolved. Commands can only use static paths.`,
    command,
  });
}

export function terminalUnavailableError(): BrudError {
  return brudError({
    code: 'TERMINAL_UNAVAILABLE',
    friendly: 'Terminal executor is not available.',
    details: 'The terminal executor could not be initialized. Check the platform adapter configuration.',
  });
}

export function executionFailedError(message: string): BrudError {
  return brudError({
    code: 'EXECUTION_FAILED',
    friendly: 'Execution failed.',
    details: message,
  });
}

export function terminalTimeoutError(command: string, timeoutMs: number): BrudError {
  return brudError({
    code: 'TERMINAL_TIMEOUT',
    friendly: 'Command timed out.',
    details: `The command "${command}" did not finish within ${Math.round(timeoutMs / 1000)} seconds and was terminated.`,
    path: command,
  });
}

export function terminalInterruptedError(command: string): BrudError {
  return brudError({
    code: 'TERMINAL_INTERRUPTED',
    friendly: 'Command was interrupted.',
    details: `The command "${command}" did not complete because the operation was cancelled.`,
    path: command,
  });
}

export function terminalOutputLimitError(command: string): BrudError {
  return brudError({
    code: 'TERMINAL_OUTPUT_LIMIT',
    friendly: 'Command output exceeded the retention ceiling.',
    details: `The command "${command}" produced more output than the terminal retains; the transcript was truncated.`,
    path: command,
  });
}

export function commandFailedError(command: string, exitCode: number, output?: string): BrudError {
  const excerpt = (output ?? '').trim();
  const summary = excerpt.length > 0 ? `\nOutput:\n${excerpt}` : '';
  return brudError({
    code: 'EXECUTION_FAILED',
    friendly: `Command failed (exit code ${exitCode}).`,
    details: `The command "${command}" exited with code ${exitCode}.${summary}`,
    path: command,
  });
}

export function revertFailedError(path: string): BrudError {
  return brudError({
    code: 'REVERT_FAILED',
    friendly: `Failed to revert: ${path}`,
    details: `The revert operation for "${path}" could not be completed. Check the history and try again.`,
    path,
  });
}

export function sessionNotFoundError(sessionId: string): BrudError {
  return brudError({
    code: 'SESSION_NOT_FOUND',
    friendly: `Session not found: ${sessionId}`,
    details: `The session "${sessionId}" does not exist in history. It may have been deleted or expired.`,
  });
}

export function invalidRevertRequestError(): BrudError {
  return brudError({
    code: 'INVALID_REVERT_REQUEST',
    friendly: 'Invalid revert request.',
    details: 'Cannot revert without sessionId and targetState.',
  });
}

export function validationError(errorString: string): BrudError {
  return brudError({
    code: 'VALIDATION_ERROR',
    friendly: errorString,
    details: errorString,
  });
}

export function unexpectedError(operationKind: string, message: string): BrudError {
  return brudError({
    code: 'UNEXPECTED_ERROR',
    friendly: 'An unexpected error occurred.',
    details: `Unexpected error during ${operationKind}: ${message}`,
  });
}

export function metadataWrapperCaseError(wrapper: string): BrudError {
  return brudError({
    code: 'E_METADATA_WRONG_CASE',
    friendly: 'Metadata wrapper must be lowercase.',
    details: `Metadata wrapper '<${wrapper}>' must be lowercase. Found '<${wrapper}>'.`,
  });
}

export function duplicateMetadataError(scope: 'session' | 'operation', index?: string): BrudError {
  if (scope === 'session') {
    return brudError({
      code: 'E_DUPLICATE_SESSION_METADATA',
      friendly: 'Duplicate session metadata block.',
      details: 'Duplicate session metadata block. Only one <session_metadata> block is allowed.',
    });
  }
  return brudError({
    code: 'E_DUPLICATE_OPERATION_METADATA',
    friendly: `Duplicate operation metadata block in operation '${index}'.`,
    details: `Duplicate operation metadata block in operation '${index}'. Only one <operation_metadata> block is allowed per operation.`,
  });
}

export function invalidMetadataFieldError(field: string): BrudError {
  const stripped = field.endsWith(':') ? field.slice(0, -1) : field;
  const lower = stripped.toLowerCase();
  if (lower === 'title' || lower === 'description') {
    return brudError({
      code: 'E_METADATA_FIELD_CASE',
      friendly: `Metadata field '${field}' must be lowercase. Did you mean '${lower}:'?`,
      details: `Metadata field '${field}' must be lowercase. Did you mean '${lower}:'?`,
    });
  }
  return brudError({
    code: 'E_METADATA_UNKNOWN_FIELD',
    friendly: `Unknown metadata field '${field}'. Only 'title:' and 'description:' are allowed.`,
    details: `Unknown metadata field '${field}'. Only 'title:' and 'description:' are allowed.`,
  });
}

export function metadataPositionError(wrapper: string): BrudError {
  if (wrapper === 'session_metadata') {
    return brudError({
      code: 'E_SESSION_METADATA_POSITION',
      friendly: 'Session metadata must be the first element after <BRUD_INSTRUCTIONS>.',
      details: 'Session metadata must be the first element after <BRUD_INSTRUCTIONS>.',
    });
  }
  return brudError({
    code: 'E_OPERATION_METADATA_POSITION',
    friendly: 'Operation metadata must appear before the content separator.',
    details: `Operation metadata must appear before the content separator in operation '%s'.`,
  });
}

export function unterminatedMetadataError(wrapper: string): BrudError {
  return brudError({
    code: 'E_METADATA_UNCLOSED',
    friendly: `Unclosed <${wrapper}> wrapper. Expected </${wrapper}>.`,
    details: `Unclosed <${wrapper}> wrapper. Expected </${wrapper}>.`,
  });
}

export function toolDisabledError(toolKind: string): BrudError {
  return brudError({
    code: 'TOOL_DISABLED',
    friendly: `Tool "${toolKind}" is disabled.`,
    details: `The tool "${toolKind}" has been disabled in .brud/settings.json. Enable it to use this operation.`,
  });
}

export function promptNotFoundError(id: string): BrudError {
  return brudError({
    code: 'PROMPT_NOT_FOUND',
    friendly: `Prompt not found: ${id}`,
    details: `No prompt found with ID "${id}".`,
  });
}

export function promptInvalidFieldError(field: string): BrudError {
  return brudError({
    code: 'PROMPT_INVALID_FIELD',
    friendly: `Invalid prompt field: ${field}`,
    details: `The field "${field}" is not valid in this context.`,
  });
}

export function invalidLineRangeError(
  startLine?: number,
  endLine?: number,
  totalLines?: number,
): BrudError {
  return brudError({
    code: 'INVALID_LINE_RANGE',
    friendly: 'Invalid line range specified for file read.',
    details: `Requested line range ${startLine ?? '?'}-${endLine ?? '?'} is invalid for file with ${totalLines ?? '?'} lines (1-indexed).`,
  });
}

export function batchLimitExceededError(requested: number, limit: number): BrudError {
  return brudError({
    code: 'BATCH_LIMIT_EXCEEDED',
    message: `Batch file count (${requested}) exceeds maximum threshold (${limit}). Narrow the pattern, add excludePatterns, or split the read into sequential batches of ${limit} or fewer.`,
    friendly: 'Read batch too large.',
    details: `Requested ${requested} files; the limit is ${limit} per batch. Narrow the pattern, add excludePatterns, or split the read into sequential batches of ${limit} or fewer.`,
  });
}
