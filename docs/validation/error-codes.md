# Error Codes

All error codes are constructed by factory functions in `src/api/errors.ts`. Each factory returns a `BrudError` object.

## BrudError Structure

```typescript
class BrudError extends Error {
  code: string;       // Machine-readable error code
  friendly: string;   // User-facing message
  details: string;    // Technical details
  path?: string;      // Related file/directory path (when applicable)
  command?: string;   // Related terminal command (when applicable)
}
```

## Error Factory Functions

| # | Function | Code | Friendly Message | Details | Path/Command |
|---|----------|------|------------------|---------|--------------|
| 1 | `noWorkspaceError()` | `NO_WORKSPACE` | No workspace is currently open. | Open a folder in VS Code to use file operations. | — |
| 2 | `pathOutsideWorkspaceError(path)` | `PATH_OUTSIDE_WORKSPACE` | The path is outside the current workspace. | The path `"${path}"` is outside the current workspace. | `path` |
| 3 | `dangerousCommandError(command)` | `DANGEROUS_COMMAND` | The command is potentially dangerous and has been blocked. | The command `"${command}"` matches a known dangerous pattern. | `command` |
| 4 | `invalidCwdError(cwd)` | `INVALID_CWD` | The working directory is invalid. | The working directory `"${cwd}"` is outside the workspace or does not exist. | `path: cwd` |
| 5 | `fileNotFoundError(path)` | `FILE_NOT_FOUND` | The specified file was not found. | No file found at `"${path}"`. | `path` |
| 6 | `fileAlreadyExistsError(path)` | `FILE_ALREADY_EXISTS` | The file already exists. | A file already exists at `"${path}"`. | `path` |
| 7 | `directoryNotFoundError(path)` | `DIRECTORY_NOT_FOUND` | The specified directory was not found. | No directory found at `"${path}"`. | `path` |
| 8 | `directoryAlreadyExistsError(path)` | `DIRECTORY_ALREADY_EXISTS` | The directory already exists. | A directory already exists at `"${path}"`. | `path` |
| 9 | `searchNotFoundError(path, searchText)` | `SEARCH_NOT_FOUND` | The search text was not found. | The text `"${searchText}"` was not found in `"${path}"`. | `path` |
| 10 | `multipleMatchesError(path)` | `MULTIPLE_MATCHES` | Multiple matches found. | Multiple matches found in `"${path}"`. Expected a single match. | `path` |
| 11 | `fileOpenError(path)` | `FILE_OPEN_ERROR` | Could not open file. | Could not open file: `${path}` | `path` |
| 12 | `previewNotAvailableError()` | `PREVIEW_NOT_AVAILABLE` | Preview not available for this operation type. | Preview not available for this operation type. | — |
| 13 | `noValidOperationsError()` | `NO_VALID_OPERATIONS` | No valid operations found. | No valid operations found. | — |
| 14 | `noPreviewError()` | `NO_PREVIEW` | No preview could be generated for any file. | No preview could be generated for any file. | — |
| 15 | `noExtractOperationsError()` | `NO_EXTRACT_OPERATIONS` | No extract_structure operations found. | No extract_structure operations found. | — |
| 16 | `missingFieldError(field, operation?)` | `MISSING_FIELD` | Missing required field: `${field}` | The field `"${field}"` is required`${operation ? " in " + operation + " operation" : ""}`. | — |
| 17 | `invalidFieldError(field, message)` | `INVALID_FIELD` | Invalid value for field: `${field}` | `${message}` | — |
| 18 | `missingIndexError()` | `MISSING_INDEX` | You haven't used any index number with your instructions. | Please use index with instructions in this format: TOOL_CALL [INDEX]. | — |
| 19 | `parseError()` | `PARSE_ERROR` | I couldn't understand the format of your message. | Brud Code understands two formats: the legacy block format and YAML. | — |
| 20 | `unknownOperationError(operation)` | `UNKNOWN_OPERATION` | Unrecognized operation: `${operation}` | The operation `"${operation}"` is not supported by Brud Code. | — |
| 21 | `deleteFailedError(path)` | `DELETE_FAILED` | Failed to delete: `${path}` | The file or directory at `"${path}"` could not be deleted. | `path` |
| 22 | `toolNotFoundError(toolKind)` | `TOOL_NOT_FOUND` | Tool not found: `${toolKind}` | The tool `"${toolKind}"` does not exist. | — |
| 23 | `terminalUnavailableError()` | `TERMINAL_UNAVAILABLE` | Terminal executor is not available. | The terminal executor could not be initialized. Check the platform adapter configuration. | — |
| 24 | `executionFailedError(message)` | `EXECUTION_FAILED` | Execution failed. | `${message}` | — |
| 25 | `revertFailedError(path)` | `REVERT_FAILED` | Failed to revert: `${path}` | The revert operation for `"${path}"` could not be completed. | `path` |
| 26 | `sessionNotFoundError(sessionId)` | `SESSION_NOT_FOUND` | Session not found: `${sessionId}` | The session `"${sessionId}"` does not exist in history. | — |
| 27 | `invalidRevertRequestError()` | `INVALID_REVERT_REQUEST` | Invalid revert request. | Cannot revert without sessionId and targetState. | — |
| 28 | `validationError(errorString)` | `VALIDATION_ERROR` | `${errorString}` | `${errorString}` | — |
| 29 | `unexpectedError(operationKind, message)` | `UNEXPECTED_ERROR` | An unexpected error occurred. | Unexpected error during `${operationKind}`: `${message}` | — |
| 30 | `batchLimitExceededError(requested, limit)` | `BATCH_LIMIT_EXCEEDED` | Read batch too large. | `Requested ${requested} files; the limit is ${limit} per batch. Narrow the pattern, add excludePatterns, or split the read into sequential batches of ${limit} or fewer.` | — |

## BATCH_LIMIT_EXCEEDED

- **Code:** `BATCH_LIMIT_EXCEEDED`
- **Factory:** `batchLimitExceededError(requested, limit)` in `packages/core/src/api/errors.ts`, re-exported from `@brud/core` and reachable as `BrudAPI.errors.batchLimitExceededError`.
- **Friendly message:** `Read batch too large.`
- **Trigger:** a direct `read_file` / `read_files` / `read_directory` expansion asks for more files than the resolved batch ceiling. The default ceiling is `MAX_BATCH_FILES` (100). `readMaxBatchFiles` may lower that ceiling but the core clamp keeps it at or below 100, so the refusal also applies when a settings override is configured.
- **When it fires:** before any file body is read. The refusal is atomic — no file is opened and no partial content is returned. The offending operation is recorded as `failed` with this error in `errors[]`; sibling operations in the same paste block still run.
- **Recovery:** narrow the pattern, add `excludePatterns`, or split the read into sequential batches of `limit` files or fewer. `details` reports both the requested count and the effective limit.