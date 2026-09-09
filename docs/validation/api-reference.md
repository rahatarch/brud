# API Reference

All validation methods are exposed under `BrudAPI.validate`. Every method returns a `ValidationResult`.

## ValidationResult

```typescript
interface ValidationResult {
  success: boolean;
  code?: string;
  friendly?: string;
  details?: string;
  data?: unknown;
}
```

## Synchronous Methods

| # | Method | Signature | Returns | Description |
|---|--------|-----------|---------|-------------|
| 1 | `workspace` | `(workspaceFolders: string[]): ValidationResult` | `success` with folders data, or `NO_WORKSPACE` | Checks that at least one workspace folder is open |
| 2 | `path` | `(path: string, workspaceFolders: string[], options?: { operationKind?: string }): ValidationResult` | `success` with `{ resolvedPath, path, root, operationKind }`, or `PATH_OUTSIDE_WORKSPACE` | Checks that a path is within the workspace and resolves it |
| 3 | `command` | `(command: string): ValidationResult` | `success` with `{ command }`, or `DANGEROUS_COMMAND` | Checks a terminal command against known dangerous patterns |
| 4 | `cwd` | `(cwd: string \| undefined, workspaceFolders: string[]): ValidationResult` | `success` with `{ resolvedCwd }`, or `INVALID_CWD` | Validates a working directory; falls back to workspace root when cwd is empty |
| 5 | `requiredField` | `(field: string, value: any, operation?: string): ValidationResult` | `success` with `{ field, value }`, or `MISSING_FIELD` | Ensures a field is not `undefined`, `null`, or empty string |
| 6 | `validPosition` | `(position: string): ValidationResult` | `success` with `{ position }`, or `INVALID_FIELD` | Validates that position is `'start'` or `'end'` |
| 7 | `validMode` | `(mode: string): ValidationResult` | `success` with `{ mode }`, or `INVALID_FIELD` | Validates that mode is `'sequential'` or `'parallel'` |
| 8 | `hasPatterns` | `(patterns: string[]): ValidationResult` | `success` with `{ patterns }`, or `MISSING_FIELD` | Ensures at least one pattern is provided |
| 9 | `knownOperation` | `(operation: string): ValidationResult` | `success` with `{ operation }`, or `UNKNOWN_OPERATION` | Checks that an operation string is in the known operations list |
| 10 | `hasIndex` | `(index: string \| undefined): ValidationResult` | `success` with `{ index }`, or `MISSING_INDEX` | Ensures an index value is provided and non-empty |
| 11 | `validAnswers` | `(answers: any): ValidationResult` | `success` with `{ answers }`, or `MISSING_FIELD` | Checks that answers is a non-null array |
| 12 | `validCommandOrCommands` | `(command: string \| undefined, commands: string[] \| undefined): ValidationResult` | `success` with `{ command, commands }`, or `MISSING_FIELD` | Ensures at least one of `command` or `commands` is provided |
| 13 | `hasPreview` | `(operationType: string): ValidationResult` | `success` with `{ operationType }`, or `PREVIEW_NOT_AVAILABLE` | Checks that the operation type supports preview (`search_replace`, `create_file`, `append_file`) |
| 14 | `hasValidOperations` | `(operations: FileOperation[]): ValidationResult` | `success` with `{ operations }`, or `NO_VALID_OPERATIONS` | Ensures a non-empty array of operations |
| 15 | `canGeneratePreview` | `(files: any[]): ValidationResult` | `success` with `{ files }`, or `NO_PREVIEW` | Ensures a non-empty files array for preview generation |
| 16 | `hasExtractOperations` | `(operations: FileOperation[]): ValidationResult` | `success` with `{ operations }`, or `NO_EXTRACT_OPERATIONS` | Checks that at least one operation is `extract_structure` |
| 17 | `validFormat` | `(message: string): ValidationResult` | `success` with `{ message }`, or `PARSE_ERROR` | Checks that the message contains legacy block markers (`<<<<<<<`, `=======`, `>>>>>>>`) |
| 18 | `knownTool` | `(toolKind: string): ValidationResult` | `success` with `{ toolKind }`, or `TOOL_NOT_FOUND` | Checks that a tool kind is in the known tools list |
| 19 | `terminalAvailable` | `(config: any): ValidationResult` | `success` with `{ config }`, or `TERMINAL_UNAVAILABLE` | Checks that the config has a `terminalExecutor` |
| 20 | `validRevertRequest` | `(sessionId: string \| undefined, targetState: string \| undefined): ValidationResult` | `success` with `{ sessionId, targetState }`, or `INVALID_REVERT_REQUEST` | Ensures both sessionId and targetState are provided |

## Asynchronous Methods (Filesystem-Dependent)

| # | Method | Signature | Returns | Description |
|---|--------|-----------|---------|-------------|
| 21 | `fileExists` | `(fs: FileSystem, path: string): Promise<ValidationResult>` | `success` with `{ path }`, or `FILE_NOT_FOUND` | Checks that a file exists on disk |
| 22 | `directoryExists` | `(fs: FileSystem, path: string): Promise<ValidationResult>` | `success` with `{ path }`, or `DIRECTORY_NOT_FOUND` | Checks that a directory exists on disk |
| 23 | `fileNotExists` | `(fs: FileSystem, path: string): Promise<ValidationResult>` | `success` with `{ path }`, or `FILE_ALREADY_EXISTS` | Checks that a file does NOT exist on disk |
| 24 | `directoryNotExists` | `(fs: FileSystem, path: string): Promise<ValidationResult>` | `success` with `{ path }`, or `DIRECTORY_ALREADY_EXISTS` | Checks that a directory does NOT exist on disk |
| 25 | `searchText` | `(fs: FileSystem, path: string, searchText: string): Promise<ValidationResult>` | `success` with `{ path, searchText, index }`, or `FILE_NOT_FOUND` / `SEARCH_NOT_FOUND` | Searches for text within a file and returns the first match index |
| 26 | `singleMatch` | `(fs: FileSystem, path: string, searchText: string): Promise<ValidationResult>` | `success` with `{ path, searchText, index }`, or `FILE_NOT_FOUND` / `SEARCH_NOT_FOUND` / `MULTIPLE_MATCHES` | Ensures search text appears exactly once in a file |
| 27 | `canOpenFile` | `(fs: FileSystem, path: string): Promise<ValidationResult>` | `success` with `{ path }`, or `FILE_NOT_FOUND` / `FILE_OPEN_ERROR` | Checks that a file exists and is readable |
| 28 | `canDelete` | `(fs: FileSystem, path: string): Promise<ValidationResult>` | `success` with `{ path }`, or `FILE_NOT_FOUND` / `DIRECTORY_NOT_FOUND` / `DELETE_FAILED` | Checks existence and attempts deletion; uses a heuristic to distinguish files from directories |
| 29 | `canRevert` | `(sessionId: string, historyStore: any): Promise<ValidationResult>` | `success` with `{ sessionId }`, or `SESSION_NOT_FOUND` | Delegates to `sessionExists` to verify the session can be reverted |
| 30 | `sessionExists` | `(sessionId: string, historyStore: any): Promise<ValidationResult>` | `success` with `{ sessionId }`, or `SESSION_NOT_FOUND` | Checks that a session exists in the history store |