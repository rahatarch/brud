# Gotchas

## `canDelete` File/Directory Heuristic

`BrudAPI.validate.canDelete()` uses a heuristic to distinguish files from directories: a path that contains a `.` is treated as a file, otherwise as a directory.

```typescript
const isFileLike = path.includes('.');
```

This means paths like `src/myapp` (no extension) are treated as directories even if they are files, and `package.json.bak` is treated as a file even if it is a directory.

## `singleMatch` Double-Read

`BrudAPI.validate.singleMatch()` reads the file twice:

1. First read in `searchText()` to find the text.
2. Second read in `singleMatch()` to check for multiple matches.

This is a known inefficiency. The file content is not cached between calls. For large files this results in two sequential `readFile` calls.

## `fail()` Stores Path in `data`

The internal `fail()` function sets `data: error.path` on the `ValidationResult`. This means `data` is a string (the path), not an object.

```typescript
// Inside api/index.ts
function fail(error: { ...; path?: string }): ValidationResult {
  return {
    success: false,
    code: error.code,
    friendly: error.friendly,
    details: error.details,
    data: error.path,   // string | undefined, not an object
  };
}
```

Consumers expecting `data` to always be an object may encounter type confusion on failure results.

## `cwd()` Fallback Without Existence Check

When `cwd` is `undefined` or empty, `BrudAPI.validate.cwd()` falls back to `workspaceFolders[0]` without verifying that the directory actually exists on disk.

```typescript
if (!cwd || cwd.trim() === '') {
  return success({ resolvedCwd: workspaceFolders[0] });
}
```

The returned path is the workspace root, but no filesystem check confirms it exists.

## `path()` Does Not Check Existence

`BrudAPI.validate.path()` only checks whether the path is within workspace boundaries. It does **not** verify that the file or directory exists on disk. Existence checks are delegated to separate methods (`fileExists`, `directoryExists`).

## `validFormat` Only Checks Legacy Format

`BrudAPI.validate.validFormat()` checks for the presence of `<<<<<<<`, `=======`, and `>>>>>>>` block markers. It does not validate YAML format messages. Valid YAML that contains these markers will pass; legacy format messages missing any marker will fail.

## `validPosition` and `validMode` Are Case-Sensitive

```typescript
validPosition('Start');    // fails — must be 'start'
validPosition('START');    // fails — must be 'start'
validPosition('start');    // succeeds
validMode('Sequential');   // fails — must be 'sequential'
```

Both methods perform strict string comparison with no case normalization.

## `canRevert` Delegates to `sessionExists`

`BrudAPI.validate.canRevert()` does not perform any revert-specific checks. It simply delegates to `sessionExists()`:

```typescript
async canRevert(sessionId: string, historyStore: any): Promise<ValidationResult> {
  const sessionResult = await this.sessionExists(sessionId, historyStore);
  if (!sessionResult.success) {
    return sessionResult;
  }
  return success({ sessionId });
}
```

Any session that exists is considered eligible for revert, regardless of its state or whether a revert is actually applicable.

## `KNOWN_OPERATIONS` and `KNOWN_TOOLS` Are Duplicated

The `KNOWN_OPERATIONS` array and `KNOWN_TOOLS` array in `src/api/index.ts` contain identical entries. Any change to one list must be manually mirrored to the other. This duplication is a maintenance risk.

```typescript
const KNOWN_OPERATIONS = ['search_replace', 'create_file', ...];
const KNOWN_TOOLS = ['search_replace', 'create_file', ...];  // identical
```